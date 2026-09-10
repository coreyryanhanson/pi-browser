import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifyShipManifest } from "./verify-ship-manifest.js";

// Point verifyShipManifest at the package root, not __tests__/
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("publish manifest", () => {
	it("`package.json` `files` array covers every production .ts module across the tree", () => {
		expect(verifyShipManifest(PACKAGE_ROOT).missing).toEqual([]);
	});

	it("every `files` entry points at something on disk — a stale entry ships nothing", () => {
		expect(verifyShipManifest(PACKAGE_ROOT).stale).toEqual([]);
	});
});
