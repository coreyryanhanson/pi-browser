/**
 * Contract tests pinning load-bearing parsing idioms (de-facto schema):
 *
 *  - XML contracts: `@_` attribute prefix, `#text` text-node name, and
 *    namespace-prefix stripping are load-bearing — every XML guide's
 *    paths encode them. Pinned against a canonical Atom sample (namespaced,
 *    arXiv-shaped) so a parser "cleanup" that changes the parsed shape
 *    fails here before it retro-breaks published guides.
 *
 *  - Top-level-array idiom: `itemsPath: "$"` is the documented way to say
 *    "the body IS the array" (empty-part resolution returns the body).
 *
 * Behavior pinned as-is: single-entry boxing is asymmetric (`paginate`
 * boxes a lone record; `restGet` returns the raw object), and
 * attribute-value coercion can mangle zero-padded numeric IDs — flip those
 * only if a real recipe hits corruption, note in CHANGELOG.
 */

import { describe, it, expect } from "vitest";
import { parseResponse, resolveJsonPath } from "../core/helpers.js";

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" type="application/atom+xml" href="https://example.test/feed"/>
  <title>Example Feed</title>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">42</opensearch:totalResults>
  <entry>
    <id>tag:example.test,2024:one</id>
    <title>First</title>
    <link rel="alternate" href="https://example.test/one"/>
    <updated>2024-01-01T00:00:00Z</updated>
  </entry>
</feed>`;

describe("XML parsing contracts (pinned)", () => {
	const parsed = parseResponse(ATOM, { format: "xml", charset: "utf-8" });

	it("strips namespace prefixes so paths use local element names", () => {
		expect(resolveJsonPath(parsed, "feed.entry")).toBeDefined();
		expect(resolveJsonPath(parsed, "feed.totalResults")).toBeDefined();
		// No prefixed variant survived.
		expect(resolveJsonPath(parsed, "atom:feed")).toBeUndefined();
	});

	it("resolves attribute paths via the @_ prefix", () => {
		const link = resolveJsonPath(parsed, "feed.link") as Record<string, unknown>;
		expect(link["@_rel"]).toBe("self");
		expect(link["@_href"]).toBe("https://example.test/feed");
	});

	it("resolves text-node paths via the #text name", () => {
		// Text-only elements resolve as the bare string...
		expect(resolveJsonPath(parsed, "feed.title")).toBe("Example Feed");
		const entry = resolveJsonPath(parsed, "feed.entry") as Record<
			string,
			unknown
		>;
		expect(entry["updated"]).toBe("2024-01-01T00:00:00Z");
		// ...#text appears only when an element mixes attributes with text.
		const mixedRoot = parseResponse(
			`<meta xmlns="https://example.test/ns" count="3">ok</meta>`,
			{ format: "xml", charset: "utf-8" },
		) as Record<string, Record<string, unknown> | undefined>;
		const mixed = mixedRoot["meta"];
		expect(mixed).toBeDefined();
		expect(mixed?.["#text"]).toBe("ok");
		expect(mixed?.["@_count"]).toBe(3);
	});

	it("resolves an arXiv-shaped guide's itemsPath + totalCountPath", () => {
		// The exact idiom the backlog verified live against arXiv.
		expect(resolveJsonPath(parsed, "feed.totalResults")).toBe(42);
		const entries = resolveJsonPath(parsed, "feed.entry");
		expect(entries).toBeTypeOf("object");
		expect((entries as Record<string, unknown>)["title"]).toBeDefined();
	});
});

describe("Top-level-array idiom (pinned)", () => {
	it("itemsPath: '$' resolves to the body itself when the body IS the array", () => {
		const body = JSON.stringify([{ id: 1 }, { id: 2 }]);
		const parsed = parseResponse(body, { format: "json", charset: "utf-8" });
		const items = resolveJsonPath(parsed, "$");
		expect(Array.isArray(items)).toBe(true);
		expect(items).toHaveLength(2);
	});

	it("empty/missing itemsPath also returns the body (root resolution)", () => {
		const body = JSON.stringify([{ id: 1 }]);
		const parsed = parseResponse(body, { format: "json", charset: "utf-8" });
		expect(resolveJsonPath(parsed, "")).toEqual(parsed);
	});
});
