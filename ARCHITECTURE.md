# Looksy — Architecture

## Overview

```
                                         ┌──────────────┐
                                    ┌───>│  PNG / JPEG  │  AI reads via Read tool
┌─────────────┐   ┌──────────────┐  │    │  /tmp/looksy │  (~1,000-3,000 tokens)
│  CLI (args)  │──>│  Screenshot  │──┤    └──────────────┘
│  looksy URL  │   │   Engine     │  │    ┌──────────────┐
└─────────────┘   └──────┬───────┘  ├───>│  .meta.md    │  (~1,500-2,500 tokens)
       │                 │          │    └──────────────┘
   ┌───┴────┐     ┌──────┴──────┐  │    ┌──────────────┐
   │ Server │<───>│  Playwright  │  ├───>│  .meta.json  │  (--json mode)
   │  (opt) │     │  (Chromium)  │  │    └──────────────┘
   └────────┘     └─────────────┘  │    ┌──────────────┐
                                   ├───>│  .pdf / .har │  (export modes)
                                   │    └──────────────┘
                                   │    ┌──────────────┐
                                   └───>│  .webm       │  (--record mode)
                                        └──────────────┘
```

## Project Structure

```
looksy/
├── src/
│   ├── cli.ts              # CLI entry point — arg parsing, subcommands, routing
│   ├── screenshot.ts       # Core orchestrator — browser, capture, analysis assembly
│   ├── server.ts           # Persistent Chromium server (--serve/--serve-stop)
│   ├── metadata.ts         # Page metadata extraction + markdown formatting
│   ├── annotate.ts         # Numbered bounding box overlay on elements
│   ├── diff.ts             # Baseline save/load + pixel-level visual diff
│   ├── diff-inline.ts      # Side-by-side before/after comparison PNG
│   ├── fingerprint.ts      # Structural fingerprint collect/compare/scoring
│   ├── perf.ts             # Core Web Vitals (FCP, LCP, CLS, TTFB)
│   ├── a11y.ts             # Accessibility audit (landmarks, headings, ARIA)
│   ├── contrast.ts         # WCAG color contrast checker (AA/AAA) with semantic grouping
│   ├── network.ts          # Network waterfall (top 15 slowest resources)
│   ├── css-vars.ts         # CSS custom property extraction from :root
│   ├── fonts.ts            # Font loading verification (document.fonts API)
│   ├── lighthouse.ts       # Extended perf (memory, long tasks, INP)
│   ├── dom-stats.ts        # DOM complexity stats (elements, depth, inline styles)
│   ├── links.ts            # Dead link checker (HEAD request all hrefs)
│   ├── coverage.ts         # CSS/JS code coverage via CDP
│   ├── class-audit.ts      # CSS class extraction + fingerprint detection
│   ├── font-sources.ts     # Font file URL + CDN domain extraction
│   ├── asset-hashes.ts     # Hashed asset filename detection (build fingerprints)
│   ├── seo.ts              # SEO audit (robots, sitemap, OG, canonical, schema types)
│   ├── schema.ts           # JSON-LD structured data extraction + validation
│   ├── report.ts           # Text-only page summary (~100 tokens, no PNG)
│   ├── check.ts            # AI-defined pass/fail assertions (~50 tokens); CHECK_ASSERTIONS vocabulary
│   ├── page-prep.ts        # Pre-capture prep: --cookie / --local-storage seeding, --dismiss-consent
│   ├── audit.ts            # Design token audit (class/style/computed search)
│   ├── consistency.ts      # Cross-page divergence detection (--consistency)
│   ├── i18n-check.ts       # Locale structural comparison (--i18n-check)
│   ├── compare.ts          # Visual comparison between two URLs
│   ├── record.ts           # Video recording via Playwright recordVideo
│   ├── sweep.ts            # Responsive breakpoint sweep (parallel)
│   ├── sections.ts         # Per-section individual screenshots
│   ├── filmstrip.ts        # Multi-frame capture stitched horizontally
│   ├── watch.ts            # File watcher — auto re-screenshot with diff %
│   ├── interact.ts         # Page interactions (click/scroll/scroll-to/type/hover/wait)
│   ├── html-pipe.ts        # Stdin HTML reading + temp file management
│   ├── static-server.ts    # HTTP server for local dirs + glob file matching
│   ├── mcp.ts              # MCP tool server (screenshot, diff, baselines)
│   ├── utils.ts            # Shared utilities (formatBytes, validation, escaping)
│   ├── validate-theme.ts   # Theme color pair WCAG validation (no browser)
│   ├── design-spec.ts     # Design spec validation (--design-spec)
│   ├── diff-report.ts     # Semantic diff against saved baseline (--diff-report)
│   ├── delta.ts           # Incremental diff vs previous capture (--delta)
│   ├── suggest.ts         # Actionable fix recommendations (--suggest)
│   ├── layout.ts          # Flex/grid container visual overlay (--layout)
│   ├── responsive-check.ts # Responsive audit at 3 breakpoints (--responsive-check)
│   ├── components.ts      # Multi-selector element capture + grid composite (--components)
│   ├── history.ts         # Timestamped capture timeline (--history)
│   ├── bundles.ts         # JS bundle analysis (--bundles)
│   ├── images.ts          # Image audit: oversized, lazy/eager, format (--images)
│   ├── compression.ts     # Compression check: gzip/brotli/none (--compression)
│   ├── third-party.ts     # Third-party resource impact by origin (--third-party)
│   ├── cache-audit.ts     # Cache policy audit (--cache-audit)
│   ├── critical-path.ts   # Critical rendering path analysis (--critical-path)
│   ├── resource-hints.ts  # Resource hints audit: preload/preconnect (--resource-hints)
│   ├── server-timing.ts   # Server timing + TTFB breakdown (--server-timing)
│   ├── budget.ts          # Performance budget gate (--budget)
│   └── viewports.ts        # Viewport presets (desktop, mobile, tablet)
├── tests/
│   ├── unit/               # Fast unit tests (no browser)
│   └── integration/        # Browser-based smoke tests
├── bin/
│   └── looksy.js           # Executable shim (#!/usr/bin/env node)
├── package.json
├── tsconfig.json
├── LICENSE
├── CLAUDE.md               # AI assistant project instructions
├── ARCHITECTURE.md         # This file
└── README.md
```

**58 source files, ~10,800 lines.**

## Data Flow

```
CLI parseArgs()
 │
 ├─ Subcommands: list, save, diff, guard, batch, history, fingerprint, validate-theme, --serve, --serve-stop, --mcp, --record, --compare
 │
 └─ Main flow:
     │
     ├─ --html → readStdin() → htmlToTempUrl()
     ├─ --watch → startWatch(config, callback)
     ├─ --sweep → responsiveSweep(config, breakpoints)  [parallel via shared browser]
     ├─ --multi → 2x screenshot() in parallel           [shared browser]
     ├─ --serve-dir → startStaticServer(dir) → base URL
     ├─ batch <dir> → findFiles(dir, glob) → group by parent → auto-serve each
     ├─ local file → auto-serve via startStaticServer()  [file:// → http://]
     ├─ --pages → N× screenshot() in parallel           [shared browser]
     │   ├─ --locales → cross-product expansion
     │   ├─ --consistency → extractPageSnapshot() per page → compareSnapshots()
     │   └─ --contrast → consolidated summary
     ├─ fingerprint collect → screenshot() → reuses classAudit, fontSources, assetHashes, seo
     ├─ fingerprint compare → load saved fingerprints → score structural similarity
     ├─ --responsive-check → runResponsiveCheck(url)  [3 breakpoints, parallel]
     ├─ --components → captureComponents(page, selectors) → grid composite
     ├─ guard <name> → save-or-diff baseline + threshold check → exit code
     ├─ history [slug] → listHistory() → formatHistory()
     │
     └─ screenshot(config):
          │
          ├─ connectOrLaunch() → Browser (owned or from --serve)
          ├─ browser.newContext() ← viewport, colorScheme, cookies, auth, HAR
          ├─ page.goto() ← error-resilient (networkidle → domcontentloaded fallback)
          ├─ HTTP status check (warn on 4xx/5xx)
          ├─ interactions (click/scroll/scroll-to/type/hover/wait)
          ├─ page dimensions → ScreenshotResult.pageInfo
          ├─ annotate (DOM injection)
          ├─ layout overlay (DOM injection, like annotate)
          ├─ capture: PNG/JPEG/PDF
          ├─ filmstrip / sections (parallel outputs)
          │
          ├─ Analysis modules (parallel via Promise.all, each wrapped in safeRun):
          │   ├─ report → text-only summary
          │   ├─ check → pass/fail assertions
          │   ├─ audit → design token search
          │   ├─ metadata → headings, colors, fonts, elements, image hints
          │   ├─ perf → Core Web Vitals
          │   ├─ a11y → landmarks, headings, issues
          │   ├─ contrast → WCAG AA/AAA ratios + semantic failure grouping
          │   ├─ network → resource waterfall
          │   ├─ domStats → element count, depth, inline styles
          │   ├─ cssVars → :root custom properties
          │   ├─ fonts → font face loading status
          │   ├─ lighthouse → memory, long tasks, INP
          │   ├─ links → HEAD-request all hrefs
          │   ├─ coverage → CSS/JS used vs total bytes
          │   ├─ classAudit → CSS class extraction + fingerprint detection
          │   ├─ fontSources → font file URLs + CDN domains
          │   ├─ assetHashes → hashed asset filenames (build fingerprints)
          │   ├─ seo → robots, sitemap, OG, canonical, generator
          │   ├─ schema → JSON-LD structured data extraction
          │   ├─ bundles → JS chunk categorization + large chunk detection
          │   ├─ imageAudit → oversized images, lazy/eager, format, above/below fold
          │   ├─ compression → gzip/brotli/none per text resource
          │   ├─ thirdParty → third-party resources by origin (categorized)
          │   ├─ cacheAudit → cache status, TTL, hashed asset issues
          │   ├─ criticalPath → render-blocking resources, LCP, TTFB breakdown
          │   ├─ resourceHints → preload/preconnect suggestions
          │   ├─ serverTiming → TTFB phases + Server-Timing header
          │   ├─ delta → snapshot capture + compare vs previous + save
          │   ├─ suggest → prioritized fix recommendations (uses contrast results)
          │   ├─ designSpec → validate against JSON spec file
          │   ├─ diffReport → semantic diff against saved baseline
          │   └─ budget → check actuals vs limits, exit code 1 on failure
          │
          ├─ Assemble sidecar: .meta.md (markdown) or .meta.json (--json)
          ├─ consistency snapshot → ScreenshotResult.pageSnapshot (single-pass)
          ├─ history save → /tmp/looksy/history/<slug>/<timestamp>.png
          ├─ context.close() (saves HAR automatically)
          └─ browser.close() (always — disconnects without killing persistent server)
```

## Key Design Decisions

1. **Playwright over Puppeteer** — Better API, more reliable. Chromium-only install to minimize size (~170MB vs ~400MB).

2. **No config file** — CLI flags only. Zero-friction, project-agnostic.

3. **Overwrite by default** — `/tmp/looksy/preview.png` always overwritten. AI reads from predictable path.

4. **`connectOrLaunch()` pattern** — Transparently uses persistent server if available, falls back to per-invocation browser launch. No flag needed to benefit.

5. **`safeRun()` error resilience** — Each analysis module wrapped in try/catch. Failures reported in metadata instead of crashing the entire capture.

6. **Error-resilient navigation** — `networkidle` timeout → retry with `domcontentloaded` → capture partial render. Missing selector → viewport fallback.

7. **Markdown sidecar by default** — AI reads `.meta.md` directly. Costs fewer tokens than JSON. `--json` available for CI/CD.

8. **Three tiers of output cost:**
   - Full (`--meta`, ~2,500 tokens) — exploration
   - Compact (`--compact`, ~1,000 tokens) — iteration
   - Text-only (`--report`/`--check`, ~50-100 tokens) — verification

9. **Parallel execution** — `--sweep`, `--multi`, `--pages`, `--responsive-check`, and analysis modules all use `Promise.all()` with shared browser contexts.

10. **Static imports for core, dynamic for optional** — MCP SDK loaded dynamically to keep it optional (in `optionalDependencies`).

11. **Input validation at boundaries** — Baseline names validated for safe characters (path traversal prevention), CSS attribute selector values escaped in `check.ts` (injection prevention), numeric flags range-checked. Static server path traversal guard: resolved file path must remain within the root directory (prevents `/../` escapes). Server socket directory created with mode `0o700` (owner-only access).

## Token Cost Reference

| Asset | Tokens |
|-------|--------|
| Desktop viewport PNG (1280x800) | ~1,400 |
| Full page PNG (1280x3600) | ~3,000 |
| Metadata sidecar (.meta.md, full) | ~2,500 |
| Metadata sidecar (--compact) | ~1,000-1,200 |
| --report text-only | ~100 |
| --check pass/fail | ~50 |

**Full iteration session (4 rounds):** ~15,800 tokens (~4-5% of a conversation)

**With --compact:** ~10,000-12,000 tokens (~2-3%)

**With --report + --check:** ~2,000-3,000 tokens (~0.5-1%)

## Dependencies

| Package | Purpose |
|---------|---------|
| playwright | Browser automation + screenshot (Chromium only) |
| pngjs | PNG read/write for pixel-level diff, filmstrip stitching |
| @modelcontextprotocol/sdk | MCP server (optional — only loaded with `--mcp`) |

## Build & Distribution

- TypeScript compiled to `dist/` (ES2022, Node16 modules)
- `bin/looksy.js` points to `dist/cli.js`
- `npm link` for local global install
- `npm install -g looksy` for global install from npm
- Chromium-only Playwright install via postinstall
- Node.js 18.3+ required (`parseArgs` from `node:util`)
