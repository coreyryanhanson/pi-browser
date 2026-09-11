/**
 * Config reader for pi-lean-search.
 *
 * Reads `searxng.url` from Pi's merged settings.json files
 * (global settings.json + project-local .pi/settings.json).
 *
 * The global path honors `PI_CODING_AGENT_DIR`, matching pi-tool-masking's
 * `settingsPath()` — otherwise a relocated agent dir would read its toolset
 * defaults from one file and `searxng.url` from another.
 *
 * The expected shape in settings.json:
 * ```json
 * { "searxng": { "url": "http://localhost:8888" } }
 * ```
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Config paths ─────────────────────────────────────────────────

/** Global pi settings dir (`$PI_CODING_AGENT_DIR` or `~/.pi/agent`). */
function globalSettingsDir(): string {
 return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/** Project-local pi settings path (relative to cwd). */
const PROJECT_SETTINGS_PATH = ".pi/settings.json";

// ─── Reader ───────────────────────────────────────────────────────

function readSettingsFile(path: string): Record<string, unknown> {
 try {
  // Missing/invalid files throw and fall through to the catch → {}.
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
   return parsed as Record<string, unknown>;
  }
  return {};
 } catch {
  return {};
 }
}

/**
 * Read the configured SearXNG URL from merged Pi settings.
 *
 * Looks up `searxng.url` in:
 *   1. `<agent dir>/settings.json` (global; `PI_CODING_AGENT_DIR` or `~/.pi/agent`)
 *   2. `.pi/settings.json` (project-local, overrides global)
 *
 * Returns the URL string if configured, or `undefined` if absent
 * (caller should degrade gracefully — the tool returns a setup
 * message when no URL is configured).
 */
export function readSearxngUrl(): string | undefined {
 const global = readSettingsFile(join(globalSettingsDir(), "settings.json"));
 const project = readSettingsFile(PROJECT_SETTINGS_PATH);
 const merged = { ...global, ...project };

 const searxng = merged.searxng;
 if (searxng && typeof searxng === "object" && !Array.isArray(searxng)) {
  const url = (searxng as Record<string, unknown>).url;
  if (typeof url === "string" && url.length > 0) return url;
 }
 return undefined;
}
