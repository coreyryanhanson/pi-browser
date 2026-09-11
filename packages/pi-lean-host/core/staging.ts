/**
 * Shared /tmp staging root for api-learn + api-scaffold staged drafts.
 * Both tools must agree on this root at runtime — scaffold stages drafts
 * that learn's save reads.
 */

import { tmpdir } from "node:os";
import { join, sep } from "node:path";

let _stagingRoot = join(tmpdir(), "pi-lean-host");

/** Test override — mirrors `setUserGuidesDir` so tests keep drafts out of
 * the real /tmp root. */
export function setStagingRoot(dir: string): void {
 _stagingRoot = dir;
}

/** Deterministic staged dir: `<root>/<key>/`. The key is the requested
 * `domain` for templates (placeholder shortName) and `slug(shortName)` for
 * fetched recipes (which is the on-disk dirName). */
export function stagingDirFor(key: string): string {
 return join(_stagingRoot, key);
}

/** True when `p` is a staged dir under the staging root (the root itself
 * excluded — save must never try to rename the whole root). */
export function isUnderStagingRoot(p: string): boolean {
 return p !== _stagingRoot && p.startsWith(`${_stagingRoot}${sep}`);
}
