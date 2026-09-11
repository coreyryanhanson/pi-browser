/**
 * schemaVersion — the hard parse gate.
 *
 * Proves the fail-loudly policy: a guide whose `schemaVersion` is `< current`
 * FAILS TO PARSE and routes to malformed (no deprecated reading code). The
 * gate is the enforcement of the v1 `GUIDE_SCHEMA_VERSION` 0 → 1 bump:
 *
 *  - absent-on-read defaults to 0 (the floor) — an unversioned guide is
 *    treated as pre-v1 and is refused by the same gate (one code path, one
 *    message).
 *  - a malformed (non-integer/negative) value also falls to the floor and is
 *    caught by the same gate.
 *  - a current (`schemaVersion: 1`) or forward-stamped (`999`) guide parses
 *    normally and surfaces its vintage on the parsed guide.
 *
 * The gate's `fix` message is the load-bearing migration UX: it names the
 * guide file (or "this guide" for bare inline parses with no on-disk path),
 * the current version, the shipped migration doc, and the agent hand-fix
 * loop. It deliberately never routes through api-learn — a stale on-disk
 * guide cannot be re-saved over (the overwrite guard parses it first).
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseApiGuide,
	isStaleSchema,
} from "../core/parse-api-guide.js";
import { loadApiGuidesFromDir } from "../core/guide-catalog.js";
import { GUIDE_SCHEMA_VERSION } from "../core/api-guide-types.js";
import type { ApiGuide, LoadedApiGuides } from "../core/api-guide-types.js";

/** The stale fixture — authored against schema 0 (pre-v1). Refused. */
const STALE = `---
kind: api
schemaVersion: 0
domains:
  - example.com
apiHost: https://api.example.com
auth:
  kind: none
responseShape:
  format: json
operations:
  - name: items
    via: restGet
    path: /items
  - name: all
    via: paginate
    path: /all
    pagination:
      style: offset-limit
      itemsPath: items
      pageParam: page
      pageSizeParam: pageSize
---
Body
`;

/** The current-schema twin — parses normally. */
const CURRENT = STALE.replace("schemaVersion: 0", "schemaVersion: 1");

/** The unversioned twin — absent → floor 0 → refused by the same gate. */
const UNVERSIONED = STALE.replace("schemaVersion: 0\n", "");

function expectOk(
	raw: string,
	opts?: Parameters<typeof parseApiGuide>[1],
): ApiGuide {
	const res = parseApiGuide(raw, opts);
	if (!res.ok) {
		throw new Error(
			`expected ok, got error: ${res.error.field} — ${res.error.expected} (found: ${res.error.found})`,
		);
	}
	return res.guide;
}

describe("GUIDE_SCHEMA_VERSION constant", () => {
	it("is 1 and exported", () => {
		expect(GUIDE_SCHEMA_VERSION).toBe(1);
	});
});

describe("schemaVersion — hard gate", () => {
	it("a stale guide (schemaVersion: 0) fails to parse", () => {
		const result = parseApiGuide(STALE, { filename: "example.com" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.field).toBe("schemaVersion");
	});

	it("an absent schemaVersion fails to parse (the floor default is caught by the gate)", () => {
		const result = parseApiGuide(UNVERSIONED, { filename: "example.com" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.field).toBe("schemaVersion");
		// The fix teaches the re-stamp even though the author wrote nothing —
		// an unversioned guide is treated as pre-v1.
		expect(result.error.fix).toContain(`schemaVersion: ${GUIDE_SCHEMA_VERSION}`);
		expect(result.error.fix).toContain("docs/migration-v1.md");
	});

	it("a malformed schemaVersion fails to parse (the old never-a-gate fallback is gone)", () => {
		for (const bad of [
			"schemaVersion: notanumber",
			"schemaVersion: 1.5",
			"schemaVersion: -3",
		]) {
			const raw = STALE.replace("schemaVersion: 0", bad);
			const result = parseApiGuide(raw, { filename: "example.com" });
			expect(result.ok, `should refuse with ${JSON.stringify(bad)}`).toBe(false);
			if (!result.ok) {
				expect(result.error.field).toBe("schemaVersion");
			}
		}
	});

	it("a current guide (schemaVersion: 1) parses and surfaces its vintage", () => {
		const guide = expectOk(CURRENT, { filename: "example.com" });
		expect(guide.schemaVersion).toBe(1);
	});

	it("a forward value (999) parses identically and is surfaced", () => {
		const forward = STALE.replace("schemaVersion: 0", "schemaVersion: 999");
		const guide = expectOk(forward, { filename: "example.com" });
		expect(guide.schemaVersion).toBe(999);

		// Same operations + auth as the current case — the gate never changes
		// output for non-stale guides.
		const base = expectOk(CURRENT, { filename: "example.com" });
		expect(guide.operations).toEqual(base.operations);
		expect(guide.auth).toEqual(base.auth);
	});

	it("the fix names the re-stamp, the migration doc, and the agent hand-fix loop (bare-parse arm: 'this guide' fallback)", () => {
		const result = parseApiGuide(STALE, { filename: "example.com" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.fix).toContain("schemaVersion: 1");
		expect(result.error.fix).toContain("docs/migration-v1.md");
		expect(result.error.fix).toContain("Ask your agent to make this fix");
		// The fix never routes through api-learn — a stale on-disk guide
		// cannot be re-saved over (the overwrite guard parses it first).
		expect(result.error.fix).not.toContain("api-learn");
		// Bare inline parse has no on-disk path: the "this guide" fallback
		// renders (never the literal string "undefined").
		expect(result.error.fix).toContain("this guide");
		expect(result.error.fix).not.toContain("undefined");
	});
});

describe("isStaleSchema — pure staleness predicate", () => {
	it("truth table: stale, current, and forward-stamped", () => {
		expect(isStaleSchema(0, 1)).toBe(true);
		expect(isStaleSchema(1, 1)).toBe(false);
		// A guide stamped ahead of current is not stale — it was authored
		// against a newer schema than the running host.
		expect(isStaleSchema(2, 1)).toBe(false);
	});
});

describe("schemaVersion — loader arm (loadApiGuidesFromDir)", () => {
	function withGuidesDir(
		guides: Record<string, string>,
		fn: (dir: string, loaded: LoadedApiGuides, warns: string[]) => void,
	): void {
		const dir = mkdtempSync(join(tmpdir(), "host-schema-gate-"));
		try {
			for (const [name, raw] of Object.entries(guides)) {
				mkdirSync(join(dir, name), { recursive: true });
				writeFileSync(join(dir, name, "guide.md"), raw, "utf-8");
			}
			const warns: string[] = [];
			const loaded = loadApiGuidesFromDir(dir, (msg) => warns.push(msg));
			fn(dir, loaded, warns);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	it("a stale guide routes to malformed and the fix names the on-disk path (loader arm)", () => {
		withGuidesDir({ "stale-example": STALE }, (dir, loaded, _warns) => {
			expect(Object.keys(loaded.guides)).toEqual([]);
			expect(loaded.malformed).toHaveLength(1);
			const m = loaded.malformed[0]!;
			expect(m.error.field).toBe("schemaVersion");
			const guidePath = join(dir, "stale-example", "guide.md");
			expect(m.file).toBe(guidePath);
			expect(m.error.fix).toContain(guidePath);
			// The loader names the real path — not the bare-parse fallback.
			expect(m.error.fix).not.toContain("this guide");
		});
	});

	it("emits the one-time schema-gate banner exactly once before the first stale-schema warning", () => {
		withGuidesDir(
			{
				"stale-a": STALE.replace("example.com", "a.example"),
				"stale-b": STALE.replace("example.com", "b.example"),
			},
			(_dir, loaded, warns) => {
				expect(loaded.malformed).toHaveLength(2);
				// Exactly one banner, and it precedes the first per-guide
				// malformed warning.
				const bannerIdx = warns.findIndex((w) =>
					w.includes("authored against an older guide schema"),
				);
				expect(bannerIdx).toBeGreaterThanOrEqual(0);
				expect(
					warns.filter((w) => w.includes("authored against an older guide schema")),
				).toHaveLength(1);
				expect(bannerIdx).toBeLessThan(
					warns.findIndex((w) => w.includes("Malformed guide")),
				);
			},
		);
	});

	it("ordinary malformed guides do not trigger the schema-gate banner", () => {
		// A guide broken for a non-schema reason (restPost is not a `via`
		// value) must load-warn without the schema frame.
		const broken = CURRENT.replace("via: restGet", "via: restPost");
		withGuidesDir({ "broken-example": broken }, (_dir, loaded, warns) => {
			expect(loaded.malformed).toHaveLength(1);
			expect(loaded.malformed[0]!.error.field).not.toBe("schemaVersion");
			expect(
				warns.some((w) => w.includes("authored against an older guide schema")),
			).toBe(false);
		});
	});
});
