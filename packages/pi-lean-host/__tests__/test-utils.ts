/**
 * Shared test scaffolding — only helpers duplicated across 3+ test files
 * belong here; single-file fixtures stay in their own test file.
 */

import { vi } from "vitest";

/** Stub global fetch as a token-endpoint mock; returns the underlying vi.fn. */
export function stubTokenEndpoint(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn((url: unknown, init?: RequestInit) =>
		Promise.resolve(handler(String(url), init ?? {})),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

/** JSON token-endpoint response. */
export function tokenResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Passthrough theme: fg returns its text argument unstyled. */
export const mockTheme = {
	fg: (_style: string, text: string) => text,
	bold: (s: string) => s,
} as any;
