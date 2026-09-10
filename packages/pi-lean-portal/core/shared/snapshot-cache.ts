/**
 * Snapshot Disk Cache — disk-backed snapshot caching.
 *
 * When compactSnapshot() truncates a page's accessibility tree, the full
 * tree is written to /tmp/pi-lean-portal/snapshot-*.txt so the agent can read
 * elements past the truncation boundary with the read tool.
 *
 * Temp-file lifecycle (tracking, cleanup, hash prefix) lives in
 * temp-files.ts, shared with fetch-backend.ts:
 * - Pure utility functions, no class or global state beyond a tracking Map
 * - Caches ONLY when truncation occurred (snapshot > 2800 chars)
 * - Graceful I/O degradation (try-catch, no crash on disk errors)
 * - Max 2 files per task (oldest evicted)
 *
 * @module snapshot-cache
 */

import { writeFileSync, rmSync } from "node:fs";
import { BROWSER_TEMP_DIR, safeTaskId, ensureBrowserTempDir } from "./paths.js";
import {
	sha256Prefix,
	trackTempFile,
	cleanupTrackedTempFiles,
} from "./temp-files.js";

// ─── Constants ──────────────────────────────────────────────────────────

/**
 * Snapshot truncation threshold.
 * Snapshots shorter than this are returned as-is (no truncation).
 * Shared with router.ts — both must agree on the cut-off.
 */
export const SNAPSHOT_TRUNCATE_THRESHOLD = 2800;

/** Maximum cached snapshot files per task. */
const MAX_FILES_PER_TASK = 2;

// ─── Types ──────────────────────────────────────────────────────────────

/** Result of a cache attempt (null = not cached for any reason). */
export interface CacheResult {
	/** Absolute path to the cached snapshot file. */
	path: string;
	/** Snapshot fingerprint (for staleness detection). */
	fingerprint: string;
}

// ─── Internal state ────────────────────────────────────────────────────

/**
 * Tracks active snapshot temp files per task.
 * For each task, entries are kept in insertion order (oldest first),
 * so eviction can splice from the front.
 */
const activeSnapshotFiles = new Map<string, string[]>();

/** Monotonic file-index counter — guarantees unique filenames across writes. */
let _snapshotIndexCounter = 0;

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a snapshot cache file path.
 */
function buildCacheFilePath(
	taskId: string,
	digest: string,
	index: number,
): string {
	const tid = safeTaskId(taskId);
	return `${BROWSER_TEMP_DIR}/snapshot-${tid}-${digest}-${index}.txt`;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Cache a snapshot's full text to a temp file.
 *
 * Only caches when the snapshot is longer than CACHE_TRUNCATE_THRESHOLD
 * (truncation occurred). Gracefully degrades to a no-op on any
 * filesystem error. Evicts the oldest file per task when the count
 * exceeds MAX_FILES_PER_TASK.
 *
 * @param taskId - The task ID (used for file naming and tracking)
 * @param snapshot - The full snapshot text to cache
 * @param fingerprint - A stable hash/fingerprint for the snapshot
 * @returns A CacheResult with path and fingerprint, or null if not cached
 */
export function cacheSnapshot(
	taskId: string,
	snapshot: string,
	fingerprint: string,
): CacheResult | null {
	// Only cache when truncation occurred
	if (snapshot.length <= SNAPSHOT_TRUNCATE_THRESHOLD) {
		return null;
	}

	try {
		ensureBrowserTempDir();

		const digest = sha256Prefix(snapshot);

		// Monotonic index — avoids filename collisions with currently-tracked
		// entries (length would collide with surviving higher-index files
		// after eviction; Date.now() can collide within the same ms).
		const nextIndex = _snapshotIndexCounter++;

		const filePath = buildCacheFilePath(taskId, digest, nextIndex);
		writeFileSync(filePath, snapshot, "utf-8");

		trackTempFile(activeSnapshotFiles, taskId, filePath);

		// Evict oldest if over limit (insertion order = age order)
		const entries = activeSnapshotFiles.get(taskId);
		if (entries && entries.length > MAX_FILES_PER_TASK) {
			const toRemove = entries.splice(0, entries.length - MAX_FILES_PER_TASK);
			for (const path of toRemove) {
				try {
					rmSync(path, { force: true });
				} catch {
					/* best-effort */
				}
			}
		}

		return { path: filePath, fingerprint };
	} catch {
		// Graceful degradation: any I/O error → no cache
		return null;
	}
}

/**
 * Remove all cached snapshot files for a specific task.
 *
 * @param taskId - The task ID whose cached files should be removed.
 */
export function removeSnapshotFiles(taskId: string): void {
	cleanupTrackedTempFiles(activeSnapshotFiles, taskId);
}

/**
 * Remove ALL cached snapshot files across all tasks.
 * Called during session_shutdown.
 */
export function removeAllSnapshotFiles(): void {
	cleanupTrackedTempFiles(activeSnapshotFiles);
	// ponytail: no orphan sweep — stale files live until /tmp cleanup;
	// BROWSER_TEMP_DIR is shared with fetch spill files and screenshots, so
	// a dir-wide rm here deleted other sessions' files. Add an owned-prefix
	// mtime sweep if /tmp leaks ever matter.
}

/**
 * Build the hint appended to compacted snapshot output.
 *
 * When the snapshot was cached, returns the cache path + action guidance
 * pointing to browser-inspect as a cheaper alternative to loading the full
 * file. When the snapshot was truncated but NOT cached, returns a fallback
 * hint pointing to browser-inspect or full=true. Returns empty string when
 * the snapshot was not truncated.
 *
 * @param cacheResult - The result from cacheSnapshot() (null if not cached)
 * @param snapshotLength - The length of the original (uncached) snapshot
 * @param truncated - Whether the snapshot was truncated by compactSnapshot()
 * @param elementCount - Optional number of interactive elements on the page
 * @returns A hint string (cache notice, fallback hint, or empty string)
 */
export function formatCacheNotice(
	cacheResult: CacheResult | null,
	snapshotLength: number,
	truncated: boolean,
	elementCount?: number,
): string {
	if (truncated && snapshotLength > SNAPSHOT_TRUNCATE_THRESHOLD) {
		if (cacheResult) {
			// Cache was written — show cache path + action guidance
			const guidance =
				elementCount != null && elementCount > 0
					? `   ${elementCount} elements total — read the cache file for the exact ARIA tree, or use browser-inspect for quick targeted element discovery`
					: `   read the cache file for the exact ARIA tree, or use browser-inspect for quick targeted element discovery`;
			return `\n📄 Full snapshot cached at ${cacheResult.path}\n${guidance}`;
		}
		// Truncated but not cached — fallback hint
		// (replaces old "(use full=true for complete tree)" that was embedded in compactSnapshot())
		return `\n(use browser-inspect role=... name=... to find specific elements, or use browser-snapshot full=true for the complete tree)`;
	}
	return "";
}
