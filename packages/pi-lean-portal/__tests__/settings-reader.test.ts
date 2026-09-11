/**
 * Tests for the shared settings reader's global path resolution.
 *
 * Covers the `PI_CODING_AGENT_DIR` override (matching pi-tool-masking's
 * `settingsPath()`) and the `~/.pi/agent` fallback.
 */

import { join } from "node:path";
import { homedir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFs = vi.hoisted(() => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

vi.mock("node:fs", () => mockFs);

import { readMergedSettings } from "../core/shared/settings-reader.js";

describe("readMergedSettings global path", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFs.existsSync.mockReturnValue(true);
		delete process.env.PI_CODING_AGENT_DIR;
	});

	afterEach(() => {
		delete process.env.PI_CODING_AGENT_DIR;
	});

	it("honors PI_CODING_AGENT_DIR for the global settings path", () => {
		process.env.PI_CODING_AGENT_DIR = "/custom/agent/dir";
		mockFs.readFileSync.mockImplementation((path: string) => {
			if (path === "/custom/agent/dir/settings.json") {
				return JSON.stringify({ theme: "custom" });
			}
			return "{}";
		});
		expect(readMergedSettings().theme).toBe("custom");
	});

	it("falls back to ~/.pi/agent when PI_CODING_AGENT_DIR is unset", () => {
		mockFs.readFileSync.mockImplementation((path: string) => {
			if (path === join(homedir(), ".pi", "agent", "settings.json")) {
				return JSON.stringify({ theme: "default" });
			}
			return "{}";
		});
		expect(readMergedSettings().theme).toBe("default");
	});
});
