# pi-lean-search User Guide

> SearXNG search tool for Pi. Pairs with [pi-lean-portal](https://www.npmjs.com/package/pi-lean-portal)'s
> `/web` toggle — search-only installs are valid, or add it to a portal install
> for the full web-tools suite. Part of the
> [pi-lean-dimension](https://github.com/coreyryanhanson/pi-lean-dimension)
> web-tools suite.

## Quick start

`web-search` needs a SearXNG instance to talk to. If you don't have one,
the fastest route is the official Docker image:

```bash
docker run -d --name searxng -p 8888:8080 searxng/searxng
```

Any reachable SearXNG instance works — self-hosted or public. See the
[SearXNG docs](https://docs.searxng.org/) for other install methods and
instance administration.

Then install the tool:

```bash
pi install npm:pi-lean-search
```

Pair with [pi-lean-portal](https://www.npmjs.com/package/pi-lean-portal) for
browser tools + the `/web` toggle, or install
[pi-lean-dimension](https://www.npmjs.com/package/pi-lean-dimension) to get
both in one command.

Finally, point the tool at your instance — [Configuration](#configuration)
below.

## Usage

| Command / Tool | Description |
|---|---|
| `web-search` tool | Search the web via your SearXNG instance. Supports `count` (1–100) and `pageno` (1-indexed) for deeper result pagination. Agents use this automatically. |
| `/searxng-status` | Test and diagnose the SearXNG connection. |

The `web-search` tool is automatically included in `/web on` / `/web off` toggling
when `pi-lean-portal` is also installed. The status bar shows a `● searxng` glyph
(colored accent/blue when healthy, yellow when degraded, red when unreachable).

## Configuration

Set the URL of your SearXNG instance in your Pi settings file:

**`~/.pi/agent/settings.json`** (global) or **`.pi/settings.json`** (project-local):

```json
{
  "searxng": {
    "url": "http://localhost:8888"
  }
}
```

- **Self-hosted SearXNG:** Run your own instance ([docs](https://docs.searxng.org/)).
- **Public instance:** Any SearXNG instance you can reach works — set its URL here. Check the instance's terms or rate limits before pointing an automated tool at it.
- No URL configured? The tool returns a setup message on its first call — no errors, no broken prompts.

### Example output

A `web-search` call renders as a numbered list the agent reads:

```text
1. Example result title
   https://example.com/page — one-line snippet from the page
2. …
```

SearXNG instant answers (calculator, weather, translations) are passed
through when the query triggers them.

## Graceful degradation

If SearXNG is unreachable or unconfigured, the `web-search` tool returns a clear
message pointing you toward setup instructions. It never throws or breaks the agent.

## Tests

From the [monorepo root](https://github.com/coreyryanhanson/pi-lean-dimension):

```bash
npx vitest run packages/pi-lean-search/
```
