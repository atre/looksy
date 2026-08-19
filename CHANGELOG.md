# Changelog

All notable changes to looksy are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow semver.

## [Unreleased]

### Added

- `findings[]` entries carry `scope: 'site'` (mirrors pulse's Finding) and a descriptive `title` (`no-hscroll: +174px at 375px`, `contrast: 2 AA fail`) instead of a bare `1 check fail` count

### Fixed

- `--brief` alone exited 0 on a red result (e.g. HTTP 404) instead of 1 — any printed `✗` line now sets exit 1
- `-q` still printed the `Tip: looksy --serve …` stderr hint on every run — suppressed under quiet/brief

### Changed

- `visual-qa` skill moved into the repo (`skills/visual-qa/SKILL.md`), `~/.claude/skills/visual-qa` now symlinks to it like the other tools

## [0.2.0] — 2026-08-17

Field-feedback round from dogfooding looksy on a live storefront audit (2026-08-15/16).

### Added

- `--dismiss-consent` — click the accept control of common CMPs (OneTrust, Cookiebot, Sourcepoint/Quantcast iframe notices, Usercentrics, Didomi, CookieYes, consentmanager, …; multi-language text fallback inside fixed/dialog overlays, stricter list inside child iframes) or hide the overlay; reports `consent: clicked …` on stdout. Also applied to `--responsive-check` breakpoint contexts and `save`/`diff`/`guard`; MCP `screenshot` tool exposes `dismissConsent`/`localStorage`
- `runChecksStructured()` / `CheckResult[]` — `--check` results are structured (`checkResultsData`, `.meta.json` `check.results`), and the MCP `check-fonts` tool returns per-assertion `pass`/`failed`/`unknownAssertions` instead of a "parse the prose" note
- `withBrowser()` helper in `server.ts` — one-off browser work always releases the (possibly `--serve`-connected) browser; a unit test guards against the `if (owned) close()` anti-pattern returning
- `--local-storage "k=v; k2=v2"` — seed localStorage for the target origin before any page script runs (consent flags, feature flags)
- `--check` vocabulary: `no-hscroll`, `touch-targets[:N]`, `h1-count[:N]`, `heading-outline`, `no-broken-images`, `alt-text`, `lang`, `canonical`, `meta-description`, `og-image`/`og-title`/`og-tags`, `twitter-card`, `class:<name>`; the full list is exported as `CHECK_ASSERTIONS`, printed by `--help`, and documented in README
- `-q, --quiet` — suppress output-path lines; keep `Page:` line, analyzer summaries, checks, suggestions
- `--limit <n>` — cap for offender lists (touch targets, uncompressed, no-cache, large bundles, image issues)
- `Page:` line flags horizontal overflow explicitly: `⚠ +21px wider than 375px viewport (horizontal scroll)`; `--sweep` prints one summary line per breakpoint with the overflow amount and AA fails
- Batch/fleet closing table now carries title, page size (+hscroll), AA fails, suggestion count, failed checks per URL
- `--speed` compact sections name their offenders (which images/resources/bundles), not just counts
- `--suggest` names the element behind each count: broken image srcs, missing-alt srcs, both headings of a heading skip
- `--schema`: Google-Merchant-shaped Product coverage (`Product: 9/11 recommended fields (missing brand, …)`), BreadcrumbList items without `item` URL flagged
- `--responsive-check`: stdout summary line (`responsive: 375px hscroll +21px, 3 controls < 44px | …`) and the compact findings block print with `--design-audit`; overflow findings state the pixel amount
- `validate-theme`: Tailwind v4 `@theme { --color-* }` blocks parsed and auto-paired; `name` accepted as pair label; near-threshold ratios shown with 3 decimals and `(borderline)`
- `--batch-report`/`fleet` write both `.meta.json` (CI) and `.meta.md` (agents) unless `--json` was passed explicitly
- `--seo` stdout summary shows the full title with its length (was truncated at 40 chars)
- `validate-theme <css> --text-on fg,fg2 [--bg-tokens bg,bg2]` — cross-product pairs straight from `:root`/`@theme` tokens (no hand-built JSON); `--limit all` removes list caps

### Fixed

- `save` hung after writing the baseline whenever a `--serve` server was running (semantic-snapshot connection was never released); same root cause fixed for standalone `--responsive-check`, `--compare --class-audit`, and diff→element attribution
- Unknown `--check` names (`touch-targets` typo, `banana`) were coerced into a page-text search and reported `[FAIL] … not found`; they now fail explicitly as `unknown assertion — known: …`
- Lazy-loaded images that had not been requested yet were counted as broken (`3 broken` on a page where every `<img>` returned 200); broken now means load finished with no pixels
- JSON-LD blocks re-injected by hydration were double-counted (`WebSite, WebSite`); deduped by content in `--schema`, `--seo`, `--report`
- Heading-skip checks (`--a11y`, `--report`, `--suggest`) counted `display:none` / `aria-hidden` headings (unmounted mobile sheets) — now screen-reader-visible headings only (sr-only kept); findings name both headings
- Touch-target counts treated inline text links (breadcrumbs, footer link lists) as failed controls; `<a>` with `display: inline` is now WCAG 2.5.8-exempt and reported separately (`3 controls < 44px (+12 inline text links, exempt)`)
- `--design-audit` sidecar dropped `--design`'s meta/css-vars sections; it is now a strict superset
- `--design`'s `--suggest` only saw contrast pairs unless `--json` was on (a11y/heading/alt/broken-image suggestions were silently missing)
- `validate-theme` dropped the `name` field and showed `Pair N`; `4.499:1` rendered as `4.50:1 FAIL`
- `--cookie` was ignored by `--responsive-check` breakpoint contexts

Second field-feedback round — PLAN.md backlog cleared (2026-08-17).

### Added

- Horizontal-overflow findings name the culprit element (`overflow: table right=525px "Technique | Savings | Effort"`) on the `Page:` line and in `--responsive-check`/`--sweep` output
- `--speed`/`--report` offender lines now name ≥1 offender (`cache: 2 no-cache … — a.js, b.css`), respecting `--limit`
- `--links` gains a third `unverifiable` bucket (403/429/999, known bot-blockers like LinkedIn/X/Cloudflare-challenged hosts) that never counts as broken; `--links-allow <domains>` extends it
- `--responsive-check`: nav `<a>` elements are labeled `nav a` and always counted as controls (no longer silently exempt as "inline"); skip-links and other focus-only elements are excluded from touch-target audits; buttons/links with no text content fall back to `aria-label`/`title`/`aria-labelledby`; `display:none`/`visibility:hidden` elements are never measured regardless of `--visible-only`; findings always carry their breakpoint suffix
- `--design-audit` auto-raises `--contrast-limit` to 400 when not set explicitly; capped contrast summaries hint `--contrast-limit` on `--design` too
- `-o <dir>/` (trailing slash or existing directory) puts fleet/`--urls`/`--pages` output one file per URL in that directory instead of last-URL-wins
- `--image-optimizer` — detects Next/Vercel/Cloudinary/imgix/Cloudflare Images URLs and flags `PASS-THROUGH` optimizers (same bytes at `w=64` and `w=1080`); folded into `--speed`
- `fleet.yaml` — optional per-repo config (`domains`, `pages`, `locales`, `viewports`) read by `fleet` when no URLs are given on the command line; `--fleet <path>` overrides the location; explicit flags always win
- `--brief` — ≤10-line, red-only output for gate/hook use (`✗ https://a.com/ — hscroll +21px, 2 AA fail`); implies `-q`
- `--json` sidecars gain a `findings: Finding[]` array (`visual:<url>/<check>` ids, `crit`/`warn` severity, one-line `title`, `hint` flag) shared across single/fleet/`--check` output
- `--help` hints quoting URLs containing `?`/`&`; unquoted URLs with whitespace now error immediately ("did you mean separate args?") instead of producing a mangled filename and a 404 capture
- `--dismiss-consent` always prints its one-line status (`consent: not shown` / `consent: clicked …`), even under `-q`
- `-q` combined with `--check` now prints checks only (`Page:`, `consent:`, check results) instead of the full report body

### Fixed

- `fleet` Contrast Summary and `Contrast failures (…)` headers printed the PNG path instead of the URL
- `alt=""` (decorative images) was flagged as "missing alt" alongside genuinely alt-less images
- Cache audit false-flagged memory/disk-cache hits (empty transfer size, real decoded body) as `no-cache`; classification now trusts the `cache-control` response header when one was observed
- looksy's own stabilization-injected CSP violations cluttered the page `## Errors` block; now tagged `(looksy)` instead of looking like a page bug
- A failed `--check` assertion printed `Some checks failed.` but exited 0 (single, `--multi`, `--pages`, `--urls`/`fleet`); it now exits 1 as documented
- `⚠ hscroll +Npx wider than Wpx viewport` wording was inconsistent between sweep/batch/fleet and single-run output; now one definition site

## [0.1.0] — 2026-08-06

First public release.

### Highlights

- Screenshot any URL/file/stdin-HTML with AI-optimized metadata sidecars (full/compact/report tiers)
- WCAG contrast audit with concrete fix suggestions (+ React `file:line` attribution)
- Visual regression: `save` / `diff` / `guard` with pixel diffing and CI exit codes
- Performance audits (`--speed`, `--budget`), SEO/schema checks, structural fingerprinting, batch + fleet mode
- Persistent Chromium server (`--serve`), MCP server mode (`--mcp`), watch mode

### Added (pre-release hardening)

- `--ignore <selectors>` — mask dynamic regions (ads, timestamps, carousels) at capture time so `save`/`diff`/`guard` compare stable pixels
- `--cdp <endpoint>` — attach to an existing browser over CDP (e.g. a Playwright MCP session); auth/cookies/storage carry over
- Capture stabilization on by default: `document.fonts.ready` wait (3s cap) + CSS animation/transition pause + caret hide; `--no-stabilize` opts out; auto-off for `--filmstrip`
- Diff→element attribution: visual diffs report which elements changed and which CSS values changed, not just pixel percentages
- Structured JSON verdicts in all MCP tool responses (branch on `pass`/`issues` programmatically)
- Release workflow: tags cut GitHub Releases automatically

### Fixed (pre-release hardening)

- Batch/fleet/pages/sweep runs no longer abort on the first failed URL — per-target isolation, failures reported per item and in `batch-report.md`, exit 1 on partial failure
- Pixel diff no longer silently crops to the overlap on dimension mismatch — non-overlapping area counts as changed (a grown page now fails `guard`), warning on stderr, union-box diff PNG
- `guard --threshold` validates its input (a typo used to silently disable the gate via `NaN`)
- `--multi --history` no longer overwrites one of its two entries (ms timestamps + viewport label)
- `--selector --all` skips hidden/zero-size matches with a warning instead of aborting the whole capture
- `bin/looksy.js` prints an actionable message when `dist/` is missing instead of a raw stack trace
- Playwright install failure at `npm install` time now prints a looksy-branded hint
