/**
 * Shared path-templating utilities.
 *
 * Owned as a single module (not duplicated across helpers.ts, api-probe.ts,
 * and parse-api-guide.ts) so the executor (`restGet`/`paginate`), the
 * authoring tool (`api-probe`), and the parser share one implementation.
 *
 * - `tokenizeJsonPath` — tokenize a JSON path into key/index segments.
 *   Shared by the executor (`helpers.ts`) and the parser
 *   (`parse-api-guide.ts`, which must not import the executor module) so
 *   the path grammar exists exactly once.
 * - `extractPathTokens` — pull `{token}` names out of a templated path.
 * - `fillPathTemplate` — substitute `{token}` placeholders from params.
 * - `joinUrl` — join a base host + path + query string into a full URL.
 * - `assertSafeDomain` — reject a domain that could escape the guides dir.
 */

/**
 * Tokenize a JSON path into key/index segments in a single pass.
 *
 * - Dot segments split on `.` as before (unquoted legacy paths parse
 *   identically to the old regex-rewrite tokenizer).
 * - Numeric brackets `[3]` become index segments.
 * - Quoted brackets `['@odata.nextLink']` / `["@odata.nextLink"]` become
 *   ATOMIC key segments — the dot inside is part of the key name, not a
 *   separator. The old rewrite turned the quoted segment into `.nextLink`
 *   and silently missed the literal key.
 *
 * Syntax limits (documented, not handled): a quoted segment's content may
 * not contain `]` or a quote character — either ends the capture. So
 * `['a]b']` does NOT resolve (it accidentally resolved under the legacy
 * regex; a miss is the acceptable outcome for a pathological key).
 *
 * Returns null for a malformed path (unterminated bracket, non-numeric
 * unquoted bracket, `[-0]`) — the caller resolves that to `undefined`, never
 * a silent wrong match. Returns [] for the root path (`"$"`, `"."`) —
 * callers that need a data-bearing path must reject the empty tokenization
 * themselves (a root `errorPath` would resolve the whole parsed body).
 */
export function tokenizeJsonPath(path: string): string[] | null {
	const s = path.replace(/^\$\.?/, "");
	const parts: string[] = [];
	let buf = "";
	let i = 0;
	const flush = () => {
		if (buf.length > 0) parts.push(buf);
		buf = "";
	};
	while (i < s.length) {
		const ch = s[i]!;
		if (ch === ".") {
			flush();
			i++;
		} else if (ch === "[") {
			flush();
			i++;
			const q = s[i];
			if (q === "'" || q === '"') {
				// Quoted segment: atomic key, dots included. Content ends at the
				// closing quote (which must be followed by `]`); `]` or a quote
				// inside the content is a syntax limit → malformed.
				i++;
				let content = "";
				while (i < s.length && s[i] !== q && s[i] !== "]") {
					content += s[i];
					i++;
				}
				if (i >= s.length || s[i] !== q || s[i + 1] !== "]") return null;
				parts.push(content);
				i += 2;
			} else {
				// Unquoted bracket: numeric index, optionally negative (`[3]`, `[-1]`).
				let neg = false;
				if (s[i] === "-") {
					neg = true;
					i++;
				}
				let digits = "";
				while (i < s.length && s[i]! >= "0" && s[i]! <= "9") {
					digits += s[i];
					i++;
				}
				if (digits.length === 0 || s[i] !== "]") return null;
				// Reject `[-0]`/`[-00]`: parseInt yields -0 and `-0 < 0` is false in
				// JS, so the resolver's negative guard would never fire and `[-0]`
				// would silently match element 0.
				if (neg && /^0+$/.test(digits)) return null;
				parts.push((neg ? "-" : "") + digits);
				i++;
			}
		} else {
			buf += ch;
			i++;
		}
	}
	flush();
	return parts;
}

/** Extract `{token}` names from a templated path, in order, deduplicated. */
export function extractPathTokens(path: string): string[] {
	const out: string[] = [];
	for (const m of path.matchAll(/\{(\w+)\}/g)) {
		const token = m[1];
		if (token && !out.includes(token)) out.push(token);
	}
	return out;
}

/**
 * Replace `{token}` placeholders in `path` with `encodeURIComponent`'d
 * values from `params`. Tokens absent from `params` fall through to
 * `onMissing` (default: keep the `{token}` literal — useful for probing a
 * not-yet-filled path). Execution callers pass an `onMissing` that throws.
 */
export function fillPathTemplate(
	path: string,
	params: Record<string, unknown>,
	onMissing: (token: string) => string = (token) => `{${token}}`,
): string {
	return path.replace(/\{(\w+)\}/g, (_, token) => {
		const val = params[token];
		if (val === undefined) return onMissing(token);
		return encodeURIComponent(String(val));
	});
}

/**
 * Join a base host, a (possibly leading-`/`) path, and an already-built
 * query string into a full absolute URL.
 */
export function joinUrl(baseHost: string, path: string, query: string): string {
	const base = baseHost.endsWith("/") ? baseHost : `${baseHost}/`;
	const rel = path.startsWith("/") ? path.slice(1) : path;
	const url = new URL(rel, base).toString();
	if (!query) return url;
	const sep = url.includes("?") ? "&" : "?";
	return `${url}${sep}${query}`;
}

/**
 * Reject a `domain` that could escape the guides dir via path traversal.
 *
 * Domains are used in `join(guidesDir, domain, ...)` for helper lookups
 * and guide writes. A user-typed `/api helpers ../../foo` or an agent
 * `api-learn({domain: "../x"})` must not read or write outside the
 * guides dir. Returns the domain if safe, throws otherwise.
 */
export function assertSafeDomain(domain: string): string {
	// A safe domain is a single path segment: no separators, no NUL,
	// and not "."/".." (self/parent). Anything else is a literal dir name.
	if (
		domain.length === 0 ||
		domain.includes("/") ||
		domain.includes("\\") ||
		domain.includes("\0") ||
		domain === "." ||
		domain === ".."
	) {
		throw new Error(
			`Invalid domain '${domain}': must be a single path segment with no '/', '\\', or '..'.`,
		);
	}
	return domain;
}

/**
 * Wire param name for a dotted/bracketed JSON path: the last dot segment
 * with any quoted-bracket dress stripped ("continue.rccontinue" →
 * "rccontinue", "['next']" → "next"). Shared by `advancePagination`
 * (runtime tokenBag wire keys) and the parser's `listStyle` collision guard
 * so the derivation exists exactly once and can't drift.
 */
export function wireParamName(key: string): string {
	return key
		.split(".")
		.pop()!
		.replace(/^\[['"]?/, "")
		.replace(/['"]?\]$/, "");
}

/**
 * Non-decomposable Latin letters NFD can't split (single codepoints with no
 * canonical decomposition: ø ß æ œ ð þ ł). NFD handles the rest of the Latin
 * diacritic set (é ü å ñ ç …) via combining-mark strip. Non-Latin scripts
 * (Cyrillic/CJK) still collapse to '-'; add a transliteration lib if a real
 * guide ever needs them.
 */
const NON_DECOMPOSABLE: Record<string, string> = {
	ø: "o",
	ß: "ss",
	æ: "ae",
	œ: "oe",
	ð: "d",
	þ: "th",
	ł: "l",
};

/**
 * Slugify a guide `shortName` into the safe single path segment that names
 * its identity folder (`<guidesDir>/<slug(shortName)>/guide.md`). Lowercase;
 * replace every run of non-`[a-z0-9-]` chars with `-`; collapse repeated `-`;
 * strip leading/trailing `-`. The result is passed through `assertSafeDomain`
 * as the single safety guard (it already rejects `/`, `\`, `\0`, `.`, `..`,
 * and empty), so domains and slugs share one safety surface. After the
 * transform the only reachable failure is empty (an empty or all-symbol
 * `shortName`), so the throw is wrapped with a prescriptive message that
 * names `shortName` rather than `domain`.
 */
export function slug(shortName: string): string {
	const s = shortName
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[øßæœðþł]/g, (c) => NON_DECOMPOSABLE[c]!)
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	try {
		return assertSafeDomain(s);
	} catch {
		throw new Error(
			`Invalid shortName '${shortName}': must slug to a non-empty directory name (lowercase letters, digits, and '-').`,
		);
	}
}
