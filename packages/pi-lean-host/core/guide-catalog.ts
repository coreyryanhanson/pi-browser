/**
 * Directory loader + guide catalog / disambiguation rendering — split out of
 * parse-api-guide.ts (pure code motion). The dependency is one-directional:
 * this module imports the parser; the parser never imports this module.
 *
 * `isStaleSchema` deliberately stays in parse-api-guide.ts — it is the
 * parse-time schema gate's predicate, used inside `parseApiGuide()` itself.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Guide } from "./guide-loader.js";
import { slug } from "./path-template.js";
import {
	type ApiGuide,
	type LoadedApiGuides,
	type NotifyFn,
	type ParseError,
} from "./api-guide-types.js";
import { parseApiGuide } from "./parse-api-guide.js";

// ═══════════════════════════════════════════════════════════════════
// projectToGuide — strips recipe fields, keeps presentation + kind
// ═══════════════════════════════════════════════════════════════════

export function projectToGuide(guide: ApiGuide): Guide {
	const projection: Guide = {
		content: guide.content,
		updated: guide.updated,
		category: guide.category,
		source: guide.source,
		icon: guide.icon,
		shortName: guide.shortName,
		kind: guide.kind,
		...(guide.domains ? { domains: guide.domains } : {}),
	};
	return projection;
}

// ═══════════════════════════════════════════════════════════════════
// Directory loader — one malformed guide doesn't block the store.
//
// Loads from per-guide subdirectories: <dir>/<slug(shortName)>/guide.md.
// The folder name must equal slug(shortName) — a divergent folder routes to
// malformed (enforced), so the active set holds at most one guide per
// shortName. Flat top-level .md files are not loaded.
// ═══════════════════════════════════════════════════════════════════

/**
 * Push a malformed guide and warn about it. One helper owns both the catalog
 * entry and the load-time warn, so every malformed guide — parse
 * failure, illegal shortName, divergent folder — surfaces the same signal
 * (and its actionable `fix` when present) instead of being silently
 * quarantined. Fires once per cached scan.
 */
function pushMalformed(
	result: LoadedApiGuides,
	file: string,
	filename: string,
	error: ParseError,
	warn: (msg: string) => void,
): void {
	result.malformed.push({ file, filename, error });
	warn(
		`⚠ Malformed guide '${filename}': ${error.field} — expected ${error.expected}; found ${error.found}.` +
			(error.fix ? ` ${error.fix}` : ""),
	);
}

export function loadApiGuidesFromDir(
	dir: string,
	notify?: NotifyFn,
): LoadedApiGuides {
	const result: LoadedApiGuides = { guides: {}, malformed: [] };
	if (!existsSync(dir)) return result;
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return result;
	}
	// Every load-time diagnostic routes through one channel: ctx.ui.notify
	// when the caller has a UI context (renders via the Text component —
	// wraps long lines, honors newlines), else console.warn. One fallback
	// here, not one repeated per call site.
	const warn = (msg: string) => {
		if (notify) notify(msg, "warning");
		else console.warn(msg);
	};

	// One-time schema-gate banner: sets the "pass these to your agent" frame before the first
	// stale-schema malformed warning. Fired only when the parse failure is a
	// schemaVersion gate refusal, so ordinary malformed guides don't drag it
	// in. The per-guide failure already names the file + migration doc in its
	// fix; the banner only sets the frame once per scan.
	let schemaBannerEmitted = false;
	const emitSchemaGateBanner = () => {
		if (schemaBannerEmitted) return;
		schemaBannerEmitted = true;
		warn(
			`\n⚠ One or more guides were authored against an older guide schema and failed to load. ` +
				`Pass the warnings below to the agent to fix them ` +
				`(re-stamp schemaVersion + apply the breaking changes in the migration doc), then /reload.\n`,
		);
	};
	for (const entry of entries) {
		const entryPath = join(dir, entry);
		try {
			if (!statSync(entryPath).isDirectory()) continue;
		} catch {
			continue;
		}
		const guidePath = join(entryPath, "guide.md");
		try {
			if (!statSync(guidePath).isFile()) continue;
		} catch {
			continue;
		}
		const name = entry; // folder name = slug(shortName) in steady state
		let raw: string;
		try {
			raw = readFileSync(guidePath, "utf-8");
		} catch {
			continue;
		}
		const parsed = parseApiGuide(raw, {
			file: guidePath,
			filename: name,
		});
		if (parsed.ok) {
			const guide = parsed.guide;
			// Illegal-shortName + divergence checks (permanent). One try/catch
			// owns the slug() call: a throw (empty or all-symbol shortName) is
			// routed to malformed, never escaped.
			let slugged: string;
			try {
				slugged = slug(guide.shortName);
			} catch {
				pushMalformed(
					result,
					guidePath,
					name,
					{
						field: "shortName",
						expected: "a shortName that slugs to a non-empty safe directory name",
						found: `"${guide.shortName}"`,
						fix: "Set a valid shortName (lowercase letters, digits, and '-') in the guide's frontmatter.",
					},
					warn,
				);
				continue;
			}
			// Divergence check (permanent) — ENFORCED, not advisory: the folder
			// name must equal slug(shortName); the coupling IS the identity. A
			// divergent guide routes to malformed (never loads), so the active
			// set structurally holds at most one guide per shortName.
			if (entry !== slugged) {
				pushMalformed(
					result,
					guidePath,
					name,
					{
						field: "shortName",
						expected: `a folder named slug(shortName) ('${slugged}')`,
						found: `folder '${entry}'`,
						fix: `Rename the folder to '${slugged}': mv ${entryPath} ${join(dir, slugged)}`,
					},
					warn,
				);
				continue;
			}
			result.guides[entry] = guide;
		} else {
			if (parsed.error.field === "schemaVersion") emitSchemaGateBanner();
			pushMalformed(result, guidePath, name, parsed.error, warn);
		}
	}
	return result;
}

// ════════════════════════════════════════════════════════════════════
// Disambiguation helpers — shared by the api-guide menu and the
// api-fetch ambiguous-operation error. One rendering of the per-guide
// listing so the two surfaces stay visually consistent.
// ════════════════════════════════════════════════════════════════════

/**
 * Truncated op-name summary for disambiguation surfaces:
 * "N ops: a, b, c, d, e, +K more" (first 5 names, then the remaining count).
 * A 50-op guide must not dump 50 names into context — the menu exists to
 * help pick a guide cheaply; the full op list is one api-guide call away.
 */
function formatOpSummary(ops: { name: string }[]): string {
	const names = ops.map((o) => o.name);
	const count = names.length;
	const head = names.slice(0, 5);
	const remaining = count - head.length;
	const tail = remaining > 0 ? `, +${remaining} more` : "";
	return `${count} ops: ${head.join(", ")}${tail}`;
}

/**
 * Per-guide listing lines for a disambiguation surface (the api-guide
 * multi-guide menu and the api-fetch ambiguous-op error). Each entry:
 * `icon shortName` [+ ` — description` when present] then the truncated
 * op-name list. When `description:` is absent the line falls back to
 * shortName + op names only (the status-quo shape), so un-backfilled
 * guides render consistently with those that have a one-line summary.
 */
export function formatGuideListings(entries: { guide: ApiGuide }[]): string {
	const lines: string[] = [];
	for (const { guide } of entries) {
		lines.push(
			`  ${guide.icon} ${guide.shortName}` +
				(guide.description ? ` — ${guide.description}` : ""),
		);
		lines.push(`    ${formatOpSummary(guide.operations)}`);
	}
	return lines.join("\n");
}

/**
 * Resolve a guide by shortName across a domain's matches (exact,
 * case-insensitive). Shared by api-guide, api-learn's fetch-recipe, and
 * /api verify — three call sites, one resolution rule (a drifted copy would
 * ship a known second bug). Returns a structured outcome; each caller renders
 * its own message (tool result vs command notify).
 */
export function selectGuideByShortName(
	matches: { guide: ApiGuide; dirName: string }[],
	selector: string,
):
	| { ok: true; guide: ApiGuide; dirName: string }
	| { ok: false; reason: "no_match"; valid: string[] }
	| { ok: false; reason: "ambiguous"; directories: string[] } {
	const lc = selector.toLowerCase();
	const sel = matches.filter((m) => m.guide.shortName.toLowerCase() === lc);
	if (sel.length === 0) {
		return {
			ok: false,
			reason: "no_match",
			valid: matches.map((m) => m.guide.shortName),
		};
	}
	if (sel.length > 1) {
		return {
			ok: false,
			reason: "ambiguous",
			directories: sel.map((s) => s.dirName),
		};
	}
	return { ok: true, guide: sel[0]!.guide, dirName: sel[0]!.dirName };
}

/**
 * Render the no-match / ambiguous error text for a failed
 * `selectGuideByShortName` result. `callToAction` is the trailing
 * "how to see the menu" sentence — it differs per surface (tool vs
 * command), so callers pass their own.
 */
export function shortNameErrorText(
	sel: Extract<ReturnType<typeof selectGuideByShortName>, { ok: false }>,
	domain: string,
	selector: string,
	callToAction: string,
): string {
	if (sel.reason === "no_match") {
		return (
			`No guide named '${selector}' for '${domain}'. ` +
			`Available guides: ${sel.valid.join(", ")}. ` +
			callToAction
		);
	}
	return (
		`Ambiguous guide '${selector}' for '${domain}' — ` +
		`${sel.directories.length} guides share shortName '${selector}' ` +
		`(directories: ${sel.directories.join(", ")}). Rename one guide's shortName to ` +
		`disambiguate. ` +
		callToAction
	);
}

// ════════════════════════════════════════════════════════════════════
// Catalog rendering — healthy + ⚠ malformed together
//
// Base catalog is collapsed by `organization:`: one line per org with its
// guide count and domain set. Guides without `organization:` fall back to
// the per-guide line, so the un-backfilled corpus renders unchanged (no
// forced migration). Op counts live on the per-domain disambiguation menu
// (api-guide {domain}), where they're useful for picking a guide — not
// here, where they'd bloat context for orgs with many guides.
// ════════════════════════════════════════════════════════════════════

export function formatApiGuideCatalog(loaded: LoadedApiGuides): string {
	const lines: string[] = ["API guides:"];

	// Org-grouped rows preserve first-appearance order; guides without
	// organization fall back to the per-guide line (no forced migration).
	const orgRows: { org: string; guides: ApiGuide[] }[] = [];
	const orgIndex = new Map<string, number>();
	const orgless: { name: string; guide: ApiGuide }[] = [];
	for (const [name, guide] of Object.entries(loaded.guides)) {
		if (guide.organization) {
			const idx = orgIndex.get(guide.organization);
			if (idx === undefined) {
				orgIndex.set(guide.organization, orgRows.length);
				orgRows.push({ org: guide.organization, guides: [guide] });
			} else {
				orgRows[idx]!.guides.push(guide);
			}
		} else {
			orgless.push({ name, guide });
		}
	}

	for (const row of orgRows) {
		const domains = new Set<string>();
		for (const g of row.guides) {
			for (const d of g.domains ?? []) domains.add(d);
		}
		const domList = domains.size > 0 ? [...domains].join(", ") : "—";
		const n = row.guides.length;
		lines.push(`  🏛️ ${row.org} — ${n} guide${n > 1 ? "s" : ""} (${domList})`);
	}
	for (const { name, guide } of orgless) {
		const domains =
			guide.domains && guide.domains.length > 0 ? guide.domains.join(", ") : name;
		lines.push(
			`  ${guide.icon} ${guide.shortName} — ${domains} (verified ${guide.verified}, ${guide.operations.length} ops)`,
		);
	}
	for (const mal of loaded.malformed) {
		lines.push(
			`  ⚠ malformed — ${mal.filename}: ${mal.error.field} — expected ${mal.error.expected}; found ${mal.error.found}`,
		);
		// Actionable advice on its own line, matching api-fetch/api-learn's
		// `Fix:` convention — multi-line fixes (e.g. the frontmatter template)
		// render naturally instead of being inlined into the summary line.
		if (mal.error.fix) lines.push(`    fix: ${mal.error.fix}`);
	}
	if (Object.keys(loaded.guides).length === 0 && loaded.malformed.length === 0) {
		lines.push("  (no guides — call api-learn({domain, dir}) to author one)");
	}
	lines.push("");
	lines.push(
		'Call api-guide({domain: "<name>"}) for detail. Multiple guides for a domain show a disambiguation menu.',
	);
	return lines.join("\n");
}
