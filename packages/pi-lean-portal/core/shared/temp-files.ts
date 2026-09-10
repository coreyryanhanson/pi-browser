/**
 * Shared temp-file helpers — hash prefix, newline-aware cut, and the
 * per-task tracked temp-file lifecycle (write → track → cleanup) used by
 * snapshot-cache.ts and fetch-backend.ts.
 *
 * @module temp-files
 */

import { rmSync } from "node:fs";
import { createHash } from "node:crypto";

/** Compute an 8-char hex prefix of a string's sha256 digest. */
export function sha256Prefix(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 8);
}

/**
 * Pick a cut point at or before `limit`, preferring the last newline so
 * content breaks at a line boundary. Falls back to a hard cut at `limit`
 * when the first half has no newline.
 */
export function cutAtNewline(content: string, limit: number): number {
	let cut = content.lastIndexOf("\n", limit);
	if (cut < limit / 2) cut = limit;
	return cut;
}

/**
 * Track a temp file per task. Insertion order is age order (files are
 * written and tracked in creation order), so the oldest entry is always
 * first — callers can evict by splicing from the front.
 */
export function trackTempFile(
	map: Map<string, string[]>,
	taskId: string,
	filePath: string,
): void {
	const existing = map.get(taskId) ?? [];
	if (!existing.includes(filePath)) existing.push(filePath);
	map.set(taskId, existing);
}

/**
 * Remove tracked temp files (best-effort) — for one task, or all tasks.
 * Shared implementation of the per-task cleanup both cache modules need.
 */
export function cleanupTrackedTempFiles(
	map: Map<string, string[]>,
	taskId?: string,
): void {
	if (taskId) {
		const paths = map.get(taskId) ?? [];
		for (const p of paths) {
			try {
				rmSync(p, { force: true });
			} catch {
				/* best-effort */
			}
		}
		map.delete(taskId);
	} else {
		for (const [, paths] of map) {
			for (const p of paths) {
				try {
					rmSync(p, { force: true });
				} catch {
					/* best-effort */
				}
			}
		}
		map.clear();
	}
}
