---
paths:
  - "src/**"
---

<!-- Applies to: src/ -->

# Looksy CLI Flag Behavior Reference

Complete specification of all CLI flag behaviors, assertion grammars, and output behaviors.

## Flag Categories & Interactions

### Viewports & Capture Modes

**--mobile | --tablet | --multi**
- Mobile: 390x844
- Tablet: 768x1024
- Multi: captures both desktop and mobile with separate outputs

**--full [--max-height N]**
- Full page scroll capture (all content)
- Optional cap at N pixels

**--fold**
- Above-fold only (viewport height, no scroll)

**--micro**
- Thumbnail (640px, JPEG q40)

**--width W --height H**
- Custom viewport dimensions

**--dark**
- Set prefers-color-scheme: dark

**--selector ".css" [--all]**
- Element screenshot via CSS selector
- `--all`: capture every match individually

**--sweep [--sweep-widths 375,768]**
- Responsive breakpoints (default: 5 standard widths)
- Custom widths via --sweep-widths
- stdout: one line per breakpoint — `320px (iPhone SE): page 358x4936px ⚠ hscroll +38px wider than 320px viewport | contrast 0 AA fail` — the horizontal-overflow amount is the single most useful number a sweep produces, so it's explicit

**--sections**
- Per-section screenshots (identified by headings/landmarks)

**--filmstrip N**
- N-frame filmstrip over N milliseconds

**--filmstrip-scroll PX**
- Scroll distance (px) to travel across the filmstrip capture (pairs with --filmstrip)

### Output Control

**-o path**
- Custom output path (any location, no suffix logic)
- `-o dir/` (trailing slash, or an existing directory) in batch mode (`fleet` / `--urls` / `--pages`): switches from "last URL wins one file" to one `preview-<slug>.png` + sidecar per URL inside that dir (created if missing); `batch-report.md` lands there too. Same effect as `--output-dir`

**--name SUFFIX** (alias: --suffix)
- Suffix output: preview-SUFFIX.png
- Idempotent with --multi, --multi outputs preview-SUFFIX-desktop.png / preview-SUFFIX-mobile.png
- Forces a screenshot even in --report/--check/--audit "text-only" mode: an explicit -o/--name/--suffix means the caller wants a PNG at that path, so it's captured despite the text-only fast path that would otherwise skip it

**--format jpeg --quality N**
- JPEG output at quality N (default: PNG)

**--json**
- Output .meta.json instead of .meta.md
- `--batch-report` / `fleet` force JSON internally; when you did not pass `--json` yourself they write **both** sidecars (`.meta.json` for CI, `.meta.md` for agents) and print both paths
- The sidecar's `findings` array is a fleet-shaped join for other tools (snuff `--profile prod`, pulse, brief) to read instead of each parsing a different shape: `{id: 'visual:<url>/<check>', scope: 'site', severity: 'crit'|'warn', title, hint?}` (mirrors pulse's Finding) — `crit` for a failed `--check` assertion, `warn` for audit-only red not covered by an explicit check (contrast AA fail, hscroll, touch-targets); `title` is `<check>: <short reason>` (`no-hscroll: +174px at 375px`, `contrast: 2 AA fail`; `<check> failed` when no detail), `hint` is the flag to dig in (`--design`, `--sweep`, …). Per-URL sidecars only — no fleet-level JSON object exists

**-q, --quiet**
- Suppress output-path lines (PNG, sidecar) and the `Tip: looksy --serve …` stderr hint. Keeps the `Page:` line, per-analyzer summaries, `--check` results, responsive findings, suggestions — the agent/CI signal without the path noise
- Combined with `--check`: checks-only mode. Once `--check` ran, quiet drops the report/responsive/suggest/audit bodies too — only `Page:`, `consent:` and the `--check` results print
- Applies to single, `--multi`, `--sweep`, `--pages`/`--urls`/`fleet` output

**--brief**
- Implies `-q`. Replaces all normal stdout reporting (single/`--multi`/`--pages`/`--urls`/`fleet`) with a ≤10-line red-only summary for gate/hook use
- One line per red target: `✗ <url> — HTTP 404, hscroll +21px, 1 invisible, 2 AA fail, 1 check fail` (only the signals that are actually red: main-document HTTP ≥ 400, hscroll overflow, invisible contrast (< 1.5:1, counted separately from and ahead of AA fail), AA contrast failures, `--check` failures, or an outright batch-capture failure — AAA and suggestions never count)
- Clean targets print nothing per-URL; if nothing anywhere is red, prints one line: `✓ N URLs clean` (`✓ 1 URL clean`)
- Nothing else prints: no `Warning: HTTP …` stderr line (folded into the ✗ line), no `--- N of M targets failed ---` block, no blank lines, no `Batch report: …` path (the file is still written)
- Hard-capped at 10 lines: beyond 9 red lines, the rest collapse into ` … and K more`
- Exit code: any printed ✗ line (HTTP ≥ 400, hscroll, AA/check fail, error) sets exit 1 — gates/hooks rely on the code, not the text; `✓ … clean` exits 0

**--fail-only**
- `--pages`/`--urls`/`--url-file`/fleet only: skips the full per-page `printResult` body (Page line, analyzer summaries, checks, suggestions, …) for clean targets — red targets (same redness definition as `--brief`: HTTP ≥ 400, hscroll, AA contrast fail, `--check` fail, or capture error) print in full, exactly as today
- The closing `--- Batch: N … ---` table follows the same rule: only red entries' two-line blocks print, plus a trailing `  N clean` line — always present, even when every entry is clean (`N clean` with nothing above it) or every entry is red (`0 clean`), so the run's completion is never ambiguous
- `--brief` takes precedence when both are passed: `--brief` already replaces all normal output with its own red-only summary, so `--fail-only` has no additional effect in that mode

**--limit N|all**
- Max offenders listed per section (default 10; 5 in compact touch-target lists): responsive touch targets, uncompressed resources, no-cache resources, large bundles, image-issue files
- Distinct from `--contrast-limit` (which is a *sampling* cap, not a *display* cap)

**--output-dir path**
- Directory for batch output (all files go here)

**LOOKSY_DIR=./custom looksy <url>**
- Custom base directory (default: /tmp/looksy)
- Security: created with mode 0o700

### Interactions & Injection

**--interact "cmd1,cmd2,..."**
Grammar: `click:.sel | wait:ms | scroll:px | scroll-to:.sel | type:.sel=text | hover:.sel`
- Multiple commands chained with commas
- All selectors are CSS selectors
- `type` requires `.sel=text` (selector=value)
- Executed in order before capture

**--inject "css"**
- Inject CSS string before capture
- Example: `--inject "body { background: red }"`

**--wait MS**
- Fixed delay (ms) after load settles, before capture (for late animations/hydration)

**--no-stabilize**
- Capture stabilization is ON by default: waits for `document.fonts.ready` (3s cap), pauses CSS animations/transitions, hides the caret, then waits one rAF — kills FOUT and mid-transition frames that poison contrast results and baselines
- Auto-disabled for `--filmstrip` (needs motion); `--record` never stabilizes (separate pipeline)
- This flag opts out entirely (e.g. to capture a page mid-animation on purpose)

**--timeout N**
- Navigation timeout in milliseconds (default: 30000)
- The initial `networkidle` wait is separately capped at 30s (`NETWORK_IDLE_TIMEOUT_MS` in `navigate.ts`) regardless of a longer `--timeout` — a page embedding a third-party widget (chat, ads, analytics beacon) that keeps the network busy forever would otherwise block for the full `--timeout` before falling back. On hitting that cap, navigation falls back to `domcontentloaded` (as it always does on any networkidle failure) and stdout prints `(timed out waiting for network idle)`

**--host-resolver domain:ip**
- Forces one hostname to resolve to one IP for this run, via Chromium's `--host-resolver-rules`
- Bypasses the OS resolver entirely (which Chromium otherwise always uses) — for a freshly cut-over domain where the local resolver still has a stale NXDOMAIN/old IP cached but public DNS already has the record
- Always launches a dedicated, fresh Chromium process: the rule only applies at process start, so it can't reuse a `--serve` session or an existing connection (those would silently keep using the OS resolver)
- On name-not-resolved navigation failures, looksy auto-checks the hostname against 1.1.1.1 and — if that mismatches the OS resolver — prints a hint suggesting this flag (or flushing the DNS cache) instead of just failing

### Batch & Multi-Page

**--pages "/path1,/path2,..."**
- Batch capture multiple paths on same domain
- Shared browser, parallel with concurrency limit
- Works with --design and analysis flags
- `--pages @sitemap` (exact literal, case-sensitive): reads `<origin>/sitemap.xml` instead of a manual list — a `<urlset>` yields pages directly, a `<sitemapindex>` fetches each nested sitemap (capped at 20) and concatenates their pages; same-origin `<loc>` entries collapse to `pathname+search`, cross-origin entries stay absolute
- `--pages-limit N`: caps the final expanded page list to N entries — applies after `@sitemap` expansion and after `--locales` cross-product, regardless of source (a plain `--pages "/,/a,/b" --pages-limit 2` is also capped to 2)

**--concurrency N**
- Limit parallel captures (default: 3 with --design, unlimited otherwise)

**--locales "en,de,fr"**
- Cross-product expansion with --pages
- Expands `/pricing,/about` + `en,de` → `/en/pricing,/en/about,/de/pricing,/de/about`

**--consistency**
- Cross-page divergence detection
- Reports structural differences across pages
- Works with --pages (single domain) or --urls (multi-domain)

**--batch-report**
- Consolidated markdown table with --pages or --urls
- Output: batch-report.md
- Includes columns: URL, viewport, viewport px, touch targets count, overflow status

**--i18n-check "/en/p,/de/p"**
- Locale structural comparison
- Detects language-specific layout shifts

**batch <dir> --glob "*.html"**
- Batch screenshot directory
- Glob pattern to match files (default: `*/index.html`)

**--serve-dir ./build --pages "/"**
- Serve static directory via HTTP + batch
- Clean URL resolution: `/slug` → `/slug.html` (Astro)

### Multi-Domain Batch

**--urls "https://a.com,https://b.com"**
- Batch across different domains
- Shared browser, pMap concurrency
- Output: preview-domain-path.png (domain sanitized)

**--url-file sites.txt**
- One URL per line (# comments allowed)
- Batch across different domains
- Works with --consistency, --batch-report, all analysis flags

**Batch stdout summary (`--pages`, `--urls`, `--url-file`, `fleet`)**
- Closing `--- Batch: N URLs ---` block prints, per target: URL, page `WxH` (+ `⚠ hscroll +Npx wider than Wpx viewport` when it overflows), title, `AA fails: n`, `suggestions: n`, `checks: n fail`, timing, PNG path — the scan-once table for 10 URLs

**fleet <url...> [analysis flags]**
- Audit multiple live URLs passed as space-separated positionals (no `--urls "a,b,c"` quoting / zsh word-split gotcha)
- Reuses the persistent `--serve` Chromium; runs concurrently like `--urls`
- Defaults to `--contrast --a11y --compact` when no analysis flag is given; respects flags you pass
- Always writes the consolidated `batch-report.md` table and prints the per-URL summary
- Gate: exits 1 on any AA contrast failure (override with explicit flags); composes with `--url-file`/`--urls`
- Example: `looksy fleet https://a.com https://b.com --design-audit`
- **No URLs given** (no positionals, `--urls`, `--url-file`): reads `./fleet.yaml` (or `--fleet <path>`) and runs `domains x pages` — same schema shared with peep/texter/trusty: top-level `domains: [a.com, b.com]`, optional `pages: [/, /about]` (default `/`), `locales` (parsed, ignored by looksy — pages already carry locale prefixes), `viewports: [mobile]`/`[desktop]`/`[mobile, desktop]` (maps to `--mobile`/nothing/`--multi`, never overriding an explicit flag)
- Zero-dep YAML subset only: top-level `key: value`, `key: [a, b]` inline lists, `key:` + `- item` block lists — no nesting
- Explicit positionals/`--urls`/`--url-file` always take priority over `fleet.yaml`
- Example: `looksy fleet --design-audit` (reads `./fleet.yaml` in the repo root)

### HTML Pipe & Files

**echo '<html>...' | looksy --html**
- Read HTML from stdin
- Auto-serves via HTTP

**--fragment**
- Marks the target as a component/fragment preview (no real `<head>`), not a full document
- Suppresses doc-level noise in `a11y.ts`/`seo.ts`'s automatic issue lists: `Missing lang attribute on <html>` (a11y) and `no canonical URL` (seo, incl. `--suggest`'s rederived SEO issues) — both are otherwise guaranteed false positives on a bare fragment piped via `--html` (the auto-wrapper in `html-pipe.ts` never sets `lang` or a canonical link)
- Standalone flag — works with or without `--html` (e.g. also useful pointed at a Storybook iframe/live URL that renders a fragment-like preview)
- Does **not** affect explicit `--check "lang, canonical, …"` assertions — those are opt-in and run as requested even with `--fragment` set
- `title`/`hreflang` are named in the historical PLAN item but are not currently flagged as "missing" anywhere in looksy (title is always shown as-is; hreflang absence is never an issue) — nothing to suppress there today
- Does not touch `--batch-report`'s cross-page `no-canonical` column (multi-page comparison is a different use case than a single fragment preview)

**looksy ./build/index.html**
- Local file: auto-serves directory via HTTP
- Root-relative paths (`/_astro/`, etc.) work

**--watch ./src**
- Auto re-screenshot on file changes
- If watched dir has index.html and no URL, auto-serves

### Analysis Flags (appended to .meta)

Each active analyzer also echoes a one-line summary to stdout (in addition to the full section in `.meta.md`), so CI/agents can read results from the pipe without opening the sidecar — e.g. `a11y: 0 issues, 7 landmarks`, `perf: FCP 183ms, LCP 421ms, CLS 0.01, TTFB 92ms, 42 reqs 512KB`.

**--meta**
- Headings, colors, fonts, styles, errors (verbose metadata)

**--tailwind**
- Tailwind utility profile: groups class names by category (spacing, color, layout, …)
- Implies --meta (rendered as part of the metadata sidecar)

**--compact**
- 50-60% fewer tokens than --meta
- Groups colors with hex values
- Hides LOW suggestions in --suggest

**--report**
- Text-only summary, no PNG (~100 tokens)
- Includes lightweight a11y + contrast + JSON-LD schema types (deduped — a hydrated duplicate block no longer reports `WebSite, WebSite`)
- Images line: `N (x broken, y lazy/not loaded)` — broken = load finished with no pixels; a lazy image that has not been requested yet is *pending*, not broken
- Heading-skip check ignores `display:none` / `aria-hidden` headings (unmounted mobile sheets, closed dialogs) but keeps sr-only ones (screen readers read them)
- Combine with `-o`/`--name`/`--suffix` to also save the PNG at that path (see --name above) — without one of those, no screenshot is taken at all

**--annotate**
- Numbered bounding boxes overlaid on screenshot

**--perf**
- Core Web Vitals: FCP, LCP, CLS, TTFB

**--a11y**
- Accessibility audit via axe-core

**--contrast [--fail-on-aa] [--visible-only] [--contrast-limit N]**
- WCAG contrast analysis
- Resolves transparent backgrounds via DOM walk
- Attributes contrast to **leaf text nodes** only: elements whose text lives entirely in child elements (cards, wrapping `<a>`/`<li>`/`<div>`) are skipped, and pairs whose computed text color equals their resolved background are dropped — kills phantom 1.0:1/1.1:1 container failures and double-counting (same logic in the `contrast:aa`/`contrast:aaa` gate)
- Groups failures semantically
- **Invisible severity**: pairs with ratio < 1.5:1 are tagged `[INVISIBLE]` and listed first (before ordinary AA-fail lines/rows in both compact and full mode), excluded from semantic grouping — a strict subset of AA failures (not counted twice), since 1.5 is below both AA thresholds (3:1 large text, 4.5:1 normal). Surfaced in the `contrast:` stdout summary (`contrast: 1 invisible, 2 AA fail, …`) and in `--brief` as its own `N invisible` fragment (always red, leads before `N AA fail`)
- Includes "Suggested fixes" for AA failures — a **concrete** target color: `lighten/darken fg|bg to #xxxxxx for N:1` (searches both directions, so the generic "adjust both fg and bg" fallback only appears when no single-color tweak can reach 4.5:1)
- `--fail-on-aa`: print details to stderr + exit 1
- `--fail-on-aaa`: same gate at the stricter WCAG AAA level
- `--visible-only`: skip sr-only/hidden elements
- `--contrast-limit N`: max elements sampled (default 150). Applies to both `--contrast` and the `contrast:aa`/`contrast:aaa` checks. When the sample is capped, output reports coverage quantitatively — `sampled 150/311; 161 unchecked` — so partial coverage is never mistaken for a clean pass; the stdout one-liner (`--design`, `--contrast`) and the `--check` detail both append ` — raise with --contrast-limit` as the fix.
- Auto-raised to 400 (instead of the 150 default) whenever `--contrast-limit` isn't set explicitly and either `--design-audit` is on or `--check` includes `contrast:aa`/`contrast:aaa` — a sampled AA/AAA gate that only checks 150 elements isn't a real gate. `looksy --check "contrast:aa"` alone gets the 400 sample; an explicit `--contrast-limit` always wins.

**--network**
- Network waterfall (top 15 resources)

**--css-vars**
- :root custom properties extraction

**--fonts**
- Font loading verification

**--lighthouse**
- Extended perf (memory, long tasks, INP)

**--dom-stats**
- DOM complexity one-liner

**--links [--links-allow "domain1,domain2"]**
- Dead link checker (follows href, reports 404/5xx)
- Three-bucket verdicts: `ok` / `broken` / `unverifiable` — 403/429/999 and known bot-blockers (LinkedIn 999, X/Twitter, Instagram, Facebook — host or subdomain match) never count as broken, since those statuses usually mean the scraper got blocked, not that the link is dead
- `--links-allow`: comma-separated host suffixes (matches host or subdomain) always bucketed `unverifiable`, on top of the built-in bot-blocker list
- stdout summary: `links: 1/20 broken, 3 unverifiable`; `formatLinks` lists Broken and Unverifiable separately

**--coverage**
- CSS/JS code coverage via CDP

**--seo**
- SEO audit (robots.txt, sitemap, OG tags, canonical)
- stdout summary shows the **full** title plus its length (`"…" (57 chars)`) — never truncated

**--schema**
- JSON-LD structured data extraction; duplicate blocks (same JSON) are deduped by content
- `Product`: Google-Merchant-shaped coverage line — `Product: 9/11 recommended fields (missing brand, offers.shippingDetails)` — over name, image, description, sku, brand, gtin/mpn, offers.price, offers.priceCurrency, offers.availability, offers.shippingDetails, offers.hasMerchantReturnPolicy; missing fields are also listed as an issue
- `BreadcrumbList`: flags items without an `item` URL (the last crumb may omit it)

### Performance Analysis

**--speed**
- Compound: enables all performance analysis at once — perf, network, coverage, bundles, images, compression, third-party, cache-audit, critical-path, resource-hints, server-timing, image-optimizer — plus --report --compact

**--bundles**
- JS bundle analysis (chunks, categories)
- Compact mode lists large chunks: `- large: vendor.js 117 KB`

**--images**
- Image audit (oversized, lazy/eager, format recommendations)
- Compact mode (and `--speed`) names the files behind each issue: `- oversized (>2x rendered) (3): a.png, b.png … and 1 more` (cap: `--limit`)

**--compression**
- Compression check (gzip/brotli/none)
- Compact mode lists uncompressed resources largest first: `- uncompressed (2): big.js 200 KB, small.js 2 KB`

**--third-party**
- Third-party resource impact by origin

**--cache-audit**
- Cache policy audit (cache-control headers)
- Compact mode groups offenders per issue: `- static asset not cached (35): hero.webp, app.css, …` (cap: `--limit`)

**--critical-path**
- Critical rendering path (blocking resources, LCP, TTFB)

**--resource-hints**
- Preload/preconnect audit

**--server-timing**
- Server timing headers + TTFB breakdown

**--image-optimizer**
- For `<img>` srcs matching `?w=`/`?width=` or a known optimizer host (`/_next/image`, `res.cloudinary.com`, `imgix.net`, `imagedelivery.net`, `/cdn-cgi/image/`), fetches up to 3 distinct upstreams at `w=64` and `w=1080` via the Playwright request context (no Node `fetch`) and compares byte sizes
- `PASS-THROUGH` when both sizes come back within ±2% (the optimizer accepted the width param but ignored it); `OK` otherwise
- Silently skipped when the page has no candidate image URLs
- stdout: `image-optimizer: PASS-THROUGH (w=64 and w=1080 both 99KB)` / `image-optimizer: OK (2 checked)`

**--budget "totalJS:200KB,FCP:1800,CLS:0.1"**
- Performance budget CI gate
- Format: inline `"metric:value"` pairs or JSON file
- Metrics: totalJS/CSS/Images/Transfer (size), FCP/LCP/TTFB (ms), CLS (decimal), imageCount/requestCount (int)
- Exit 1 on failure

### Design & Validation

**--design**
- Shorthand: `--full --meta --compact --fonts --css-vars --contrast --suggest`

**--design-audit**
- Shorthand: `--full --compact --meta --fonts --css-vars --contrast --suggest` (= `--design`) `+ --seo --schema --font-sources --responsive-check --check "no generator, self-hosted-fonts, contrast:aa"` — its sidecar is a strict superset of `--design`'s
- Pre-launch QA gate — mobile-aware: `--responsive-check` runs at 375/768/1440 for touch targets (44px), overflow, tiny text, AND (because `--contrast` is on) samples contrast per breakpoint, catching mobile-only contrast failures the desktop pass misses
- Responsive findings print to **stdout** (compact block + a `responsive: 375px hscroll +21px, 3 controls < 44px | 768px ok | 1440px ok` summary line), not just the sidecar
- Auto-raises `--contrast-limit` to 400 when not explicitly passed, so a full-page audit doesn't silently gate on a partial sample; an explicit `--contrast-limit` always wins (same auto-raise also fires for any bare `--check "contrast:aa"`/`"contrast:aaa"` — see `--contrast-limit` above)

**--suggest**
- Actionable fix recommendations
- Aggregates data from all enabled analysis modules (the in-memory bus is always allocated with `--suggest`, so `--design` suggestions include heading/H1/alt/broken-image findings without needing `--json`)
- Names the element behind each count: `3 broken images (hero.webp, card-3.jpg, …)`, `1 image missing alt (logo.svg)`, `1 heading level skip (h1 "Alle Produkte" → h3 "Sofa")`
- Design-level suggestions: heading hierarchy, H1, footer, nav, below-fold content
- Priority tiers: HIGH (contrast, broken images), MEDIUM (a11y, heading), LOW (SEO, links, design)
- Compact mode hides LOW items

**--delta**
- Incremental diff vs previous screenshot (~80 tokens)
- Shows only what changed

**--diff-inline before.png**
- Side-by-side comparison
- Output: preview-diff.png

**--diff-report baseline-name**
- Semantic diff vs saved baseline
- Includes pixel diff + metadata diff

**guard <name> <url>** (or `--guard <name>` with a positional url)
- Visual regression gate. First run auto-creates the baseline; later runs pixel-diff against it
- On FAIL (and on any non-zero `diff`), prints `Changed elements:` — changed-pixel regions attributed to the covering selectors, with CSS property deltas vs the semantic baseline when one exists from `looksy save` (best-effort, never fails the command)
- `--threshold N`: max % changed pixels before failing (default 0.5, decimals allowed, validated — non-numeric errors out). Exit 1 when exceeded
- Dimension mismatch between baseline and current is counted as changed area (non-overlap counts into change%, warning on stderr) — a grown page fails the gate instead of silently passing on the cropped overlap

**--ignore "sel1,sel2"**
- Masks dynamic regions (ads, timestamps, carousels) before capture by injecting `visibility: hidden !important` for those selectors — layout is preserved, pixels become stable
- Applies to ALL captures including `save`/`diff`/`guard`, so baselines and comparisons mask identically — use the same `--ignore` on both sides
- Composes with `--inject` (mask CSS is appended)

**--layout**
- Flex/grid overlay with numbered labels

**--responsive-check [--target-size 24] [--visible-only]**
- Responsive audit at 3 breakpoints (375/768/1440px)
- Reports per-element touch target details: tag, text, dimensions, CSS class
- WCAG 2.5.8 AA minimum: links in text flow tagged "(inline, likely exempt)", excluded from failure count
- sr-only / visually-hidden / focus-only elements (class match or clip/≤1px pattern) are **always** excluded from touch-target checks, regardless of `--visible-only` — a focus-revealed skip link is not a real tap target
- Focus-only detection also catches skip links that aren't clipped: class matching `skip-link`/`skip-to`/`skip-nav`, `offsetParent === null` (and not `position: fixed`), or a bounding box fully off-viewport (`right <= 0` or `bottom <= 0`)
- An `<a>` inside `nav`, `[role="navigation"]`, or `header` is always a control — reported as `nav a` — never inline-exempt, even when laid out `display: inline`
- Findings are **deduped across breakpoints**: a target (or contrast failure) flagged at both 375px and 768px collapses to one finding listing the breakpoints (`— at 375px, 768px`), so counts aren't double-inflated
- `--target-size N`: custom threshold (default 44 = AAA, use 24 for AA)
- `--visible-only`: skip sr-only/hidden elements
- **Inline text links are exempt and reported separately** (WCAG 2.5.8 inline exception): any `<a>` with computed `display: inline` (breadcrumb crumbs, footer link lists, tag chips rendered as plain text) or an `<a>` inside a text run. They appear under "Inline Text Links < Npx (exempt — not counted)"; the failure count is controls only, e.g. `3 controls smaller than 44px minimum (+12 inline text links, exempt)`
- Overflow findings state the amount: `Horizontal overflow: page 396px is 21px wider than the 375px viewport`
- Compact touch-target list is capped at 5 (`--limit N` raises it); the non-compact section always lists all
- Honors `--cookie`, `--local-storage`, `--dismiss-consent`, `--timeout` in each breakpoint context
- Composable with --contrast, --a11y, other analysis flags
- When combined with `--contrast`, also samples WCAG contrast at each breakpoint (adds a Contrast AA column + deduped failure list) — surfaces mobile-only contrast issues
- Batch-report includes touch target and overflow columns

**--components ".hero,.cta"**
- Multi-element capture + grid composite
- Comma-separated selectors

**--design-spec ./spec.json**
- Validate against design spec
- Format: `{"fonts": {"h1": "Archivo Black"}, "colors": {".hero bg": "#3D3D3D"}, "spacing": {"section padding-top": "64px"}}`

**--compare https://other.com**
- Side-by-side URL diff
- Output: preview-compare.png

**--pdf | --record 3000 | --har**
- PDF export / video (3s) / HAR export

**--history**
- Save to timestamped timeline (/tmp/looksy/history/<slug>/<timestamp>.png)

### Fingerprinting & Anti-Fingerprint

**--class-audit**
- CSS class names (fingerprint detection)

**--font-sources**
- Font file URLs and CDN domains

**--asset-hashes**
- Hashed asset filenames

**fingerprint collect <url> --save NAME**
- Structural fingerprint of single URL

**fingerprint collect --serve-dir <dir> --save NAME**
- Fingerprint static build directory

**fingerprint collect-batch --serve-dir <dir> [--glob "*.html"]**
- Batch collect N fingerprints from directory

**fingerprint compare <n1> <n2> [n3...]**
- Weighted similarity (0-100): asset filenames 25%, DOM structure 20%, hashed classes 15%, external origins 15%, font sources 10%, meta tags 10%, build dirs 5%
- Empty sets score 0% (excluded from signal)
- Risk: HIGH ≥80, MEDIUM ≥50, LOW ≥20
- Matrix output for >2 fingerprints

**fingerprint diff <before> <after>**
- Show what changed between versions
- Added/removed items per dimension with DOM structure delta

**fingerprint list**
- List saved fingerprints

### Assertions

**--check "assertion1, assertion2, ..."**
Unknown assertion names are reported as `[FAIL] <name> — unknown assertion — known: …` (never coerced into a text search); the vocabulary is exported as `CHECK_ASSERTIONS` in `check.ts` and printed by `--help`.

Grammar (comma-separated):
- `sticky header` / `dark bg` / `light bg` — layout/theme checks
- `dark bg:.selector` / `light bg:.selector` — scoped background
- `text:phrase` — phrase present check
- `selector:.css` — element presence
- `count:N .sel` — element count
- `contrast:aa` / `contrast:aaa` — WCAG contrast level (with element details on failure)
- `no generator` / `no X` — meta tag absence
- `has .sel` / `visible .sel` / `hidden .sel` — visibility states
- `font:<sel>=<family>` — font family check (case-insensitive, full stack)
- `bg:<sel>=<hex>` — background color (walks DOM for transparent, ±5 tolerance)
- `color:<sel>=<hex>` — text color (±5 tolerance)
- `translated` — flags English phrases on non-English pages
- `self-hosted-fonts` — pre-deploy gate: fails if ANY external font domain found
- `no-google-fonts` — GDPR: fails if fonts.googleapis.com / fonts.gstatic.com found
- `unique-footer` / `unique-nav` — footer/nav presence (use with --pages for cross-page consistency)
- `class:<name>` — some element has a class containing `<name>` (the old implicit fallback, now explicit)
- `no-hscroll` — document not wider than the viewport; detail: `page 396px vs viewport 375px (+21px horizontal scroll)`
- `touch-targets[:N]` — no control (a/button/input/select/textarea/role=button|link|menuitem) smaller than N px (default 44); inline `<a>` (display:inline) and sr-only elements exempt; lists the first 5 offenders
- `h1-count[:N]` — exactly N `<h1>` (default 1), display:none/aria-hidden ignored; lists the h1 texts
- `heading-outline` — no skipped levels among screen-reader-visible headings; names both headings per skip
- `no-broken-images` — no `<img>` whose load finished with `naturalWidth === 0`; not-yet-loaded lazy images are not broken
- `alt-text` — every `<img>` has an `alt` attribute (lists the first 5 without)
- `lang` / `canonical` / `meta-description` — presence checks
- `og-image` / `og-title` / `og-tags` (title+description+image) / `twitter-card` — social meta presence

**--audit "token-name"**
- Design token search (e.g., "border-primary/10")

### Theme Validation

**validate-theme theme.json [--compact] [--fail-on-aa]**
- JSON format: `{"pairs": [{"fg": "#fff", "bg": "#333", "label": "Body"}]}` — `name` is accepted as an alias for `label` (both land in the Label column; only unlabeled pairs show `Pair N`)
- Config errors (missing `"pairs"` array, unresolvable auto-detect, unknown color token) show an example shape inline — e.g. `Theme config must have a "pairs" array — e.g. {"pairs":[{"fg":"#fff","bg":"#333"}]}` — so a misconfigured file doesn't require guess-and-retry
- Or token format with "colors" map
- No browser needed
- Ratios within 0.05 of a threshold (4.5 AA / 7 AAA) print with 3 decimals and `(borderline)` — `4.499:1 (borderline) FAIL`, never a misleading `4.50:1 FAIL`

**validate-theme globals.css**
- CSS: parses `:root { … }` **and Tailwind v4 `@theme { … }` / `@theme inline { … }`** blocks; the `--color-` prefix is stripped so `--color-primary` / `--color-primary-foreground` pair like shadcn's `--primary` / `--primary-foreground`
- Auto-pairs by convention: shadcn `--X`/`--X-foreground`, `--fg`/`--bg`
- Cross-product fallback
- **`--text-on fg[,fg2] [--bg-tokens bg[,bg2]]`** — explicit cross-product instead of convention pairing: every listed text token over every listed bg token (default: every other color token); tokens accept `--`/`color-` prefixes; unknown tokens error out listing what the file defines; labels are `--fg on --bg`. CSS input only
- Supports hex, rgb, hsl, bare HSL

### Server & Utilities

**--serve**
- Start persistent Chromium (~100ms per command vs ~2s cold start)
- Detaches by default: publishes PID + WS endpoint, then returns — doesn't hold the terminal/script open. Add `--foreground` to block in the current process instead (for systemd/pm2/your own `&`)
- Idempotent — if a server is already running (verified with a live connect, not just file presence), prints "already running (pid N)" and exits 0 immediately, regardless of `--foreground`

**--serve-stop**
- Stop persistent server

**--cdp <endpoint>**
- Attach to an existing browser over CDP instead of launching or using `--serve` — accepts `http://localhost:9222` (from `--remote-debugging-port=9222`) or a `ws://` CDP endpoint
- Primary use: audit a page inside a Playwright MCP (or any agent-driven) browser session — auth, cookies, and storage of that profile carry over
- Takes precedence over `--serve` for this run; closing only detaches, the external browser keeps running
- Cannot be combined with `--host-resolver` (resolver rules only apply to a looksy-launched browser — errors out explicitly)

**--mcp**
- Run as MCP tool server

**--version**
- Print version and exit

**--cat-meta**
- Print last meta to stdout

**history [url-slug]**
- Browse capture timeline

### Authentication & consent

**--cookie "session=abc; other=1"**
- Set request cookies on the target hostname (path `/`) before navigation. Also applied to `--responsive-check` breakpoint contexts and `save`/`diff`/`guard`

**--local-storage "key=value; key2=value2"**
- Seed `localStorage` for the target origin via an init script that runs before any page script (so a CMP that persists consent in localStorage never shows its banner). Third-party frames are left alone

**--dismiss-consent**
- After load (and `--wait`), before any measurement/capture: click a known accept control (OneTrust, Cookiebot, Sourcepoint, Quantcast, Usercentrics incl. shadow root, Didomi, CookieYes, consentmanager, cookieconsent, HubSpot, iubenda, TrustArc, Axeptio, Osano, Klaro, CookieFirst, common `#cookie-accept`-style ids), else a visible button whose text is an accept phrase (multi-language: accept all / alle akzeptieren / tout accepter / aceptar / прийняти …) **inside a fixed/sticky/dialog ancestor** — a plain in-content "OK" is never clicked. Then the same routine runs in each **child iframe** (Sourcepoint/Quantcast render the whole notice in one) with a stricter phrase list (no bare OK/Got it/Agree — ad iframes have those). Fallback: hide known CMP containers that are overlay-like (fixed/sticky/absolute or dialog) via CSS
- Verified live on: OneTrust (otto.de, ikea.com), Sourcepoint iframes (spiegel.de, theguardian.com, zeit.de, heise.de, bild.de, independent.co.uk), Cookiebot, CookieYes, consentmanager
- Reports what happened on stdout: `consent: clicked button "Alle akzeptieren"` / `consent: clicked button.sp_choice_type_11 (in frame cmp.heise.de)` / `consent: hidden 1 container(s)`; silent when nothing matched
- Best-effort, never fails the capture; also runs in each `--responsive-check` breakpoint context
- Cheapest lever is still the site's own consent state: `--cookie` / `--local-storage` with the CMP's key

**--storage-state ./auth.json**
- Use Playwright storage state file

**--basic-auth user:pass**
- HTTP Basic auth

## Stdout `Page:` line

Every capture prints `Page: WxHpx "title" (t s)`. When the document is wider than the viewport
the line says so explicitly — `Page: 396x3196px ⚠ hscroll +21px wider than 375px viewport`, followed by `  overflow: table right=525px "…"` lines naming the top-3 culprits —
so a mobile layout bug isn't something you only notice by comparing the width to the flag you passed.
Gate it in CI with `--check "no-hscroll"`.

## Output Naming Convention

| Modifier | Output Pattern |
|----------|---|
| default | `preview.png` |
| `--name hero` | `preview-hero.png` |
| `--multi` | `preview-desktop.png`, `preview-mobile.png` |
| `--multi --name hero` | `preview-hero-desktop.png`, `preview-hero-mobile.png` |
| `--sweep` | `preview-320.png`, `preview-375.png`, etc. |
| `--sections` | `preview-1-heading-slug.png`, etc. |
| `--diff-inline` | `preview-diff.png` |
| `diff` subcommand | `diff.png` |
| `--compare` | `preview-compare.png` |
| `--components` | `preview-component-1.png`, `preview-components-grid.png` |
| `--selector --all` | `preview-1.png`, `preview-2.png`, etc. |
| `--filmstrip` | `preview-filmstrip.png` |
| `--pdf` / `--har` | `preview.pdf` / `preview.har` |
| `--record` | `preview.webm` |
| `--history` | `/tmp/looksy/history/<slug>/<timestamp>.png` |
| `-o path` | wherever you specify |
| `--urls` batch | `preview-example-com.png`, `preview-other-com-pricing.png` |

<!-- Key technical details (viewport, exit codes, safeRun, pMap, security) are in CLAUDE.md §Key Rules -->

**Chromium-only.** Playwright install minimized to Chromium (no Firefox/WebKit).
