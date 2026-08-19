# Looksy — Claude Code Project Config

## What This Is

A standalone CLI screenshot tool for AI-driven visual QA. Point it at any URL or HTML file, it screenshots it, AI reads the image, and iterates on design. Closes the visual feedback loop.

**Project-agnostic.** Works with Astro, Next.js, plain HTML, deployed sites, local dev servers — anything with a URL.

## Tech Stack

- **Runtime:** Node.js (ES modules, TypeScript)
- **Screenshot engine:** Playwright (Chromium only)
- **Diff engine:** pngjs (pixel-level comparison)
- **Output:** PNG to `/tmp/looksy/` (configurable via `LOOKSY_DIR` env var)
- **Testing:** Vitest (540 tests)
- **Distribution:** npm package + global CLI binary (`looksy`)
- **Config:** CLI flags only, no config files

## AI Iteration Workflow

See the **Workflows** section of [README.md](README.md) for the full screenshot → AI review → iterate loop, token costs, and common workflows.

## Session Types

- **Visual QA / design work:** read the Workflows section of `README.md`
- **CLI behavior / flag reference:** `.claude/rules/flag-behavior.md` auto-loads in `src/`
- **Pure refactor/test:** neither needed

## Core Commands

```bash
looksy <url>                    # Screenshot → /tmp/looksy/preview.png
looksy <url> --design           # Full design review (meta + fonts + contrast + suggest)
looksy <url> --design-audit     # Pre-launch QA gate
looksy <url> --speed            # Performance audit

looksy --serve                  # Start persistent Chromium
looksy save <url> <name>        # Save visual baseline
looksy diff <url> <name>        # Visual regression (pixel diff)
looksy <url> --pages "/,/about" --design --batch-report  # Multi-page review
```

For complete flag reference, device options (mobile/tablet/sweep), analysis modes (contrast/a11y/perf), and assertion grammar, see **[.claude/rules/flag-behavior.md](.claude/rules/flag-behavior.md)**.

## Key Rules

- ~17,000 lines across 76 source files, 540 tests
- Strict flag parsing (unknown flags error; catches typos like `--contrast-aa`)
- Default viewport: 1280x800 (desktop)
- Exit code 0 on success, 1 on failure (budget fail, check fail, --fail-on-aa, guard fail)
- No interactive prompts — pure CLI, batch-friendly
- `connectOrLaunch()` transparently uses persistent --serve server if available
- `pMap()` concurrency-limited Promise.all for parallel captures
- `safeRun()` wraps each analysis module (failures reported, don't crash)
- Security: CSS selector injection prevention, path traversal guards, TOCTOU race fixes, LOOKSY_DIR mode 0o700

## Development

```bash
npm install && npm run build && npm link    # Build + global install
npm test                                     # tsc + vitest
npx vitest run                               # Tests only
npx vitest                                   # Watch mode
```
