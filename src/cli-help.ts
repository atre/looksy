import { LOOKSY_DIR } from './utils.js';

const DEFAULT_OUTPUT = `${LOOKSY_DIR}/preview.png`;

export function printHelp(): void {
  console.log(`looksy — screenshot any URL for AI-assisted visual development

Usage:
  looksy <url> [options]          Screenshot a URL
  looksy ./file.html              Screenshot a local file (auto-served via HTTP)
  looksy save <url> <name>        Save screenshot as named baseline
  looksy diff <url> <name>        Compare URL against saved baseline
  looksy diff <a.png> <b.png>     Compare two local image files
  looksy guard <name> <url>       Visual regression gate (auto-creates/updates baseline)
  looksy fleet <url...> [options] Audit multiple live URLs (space-separated, reuses --serve)
  looksy fleet [options]           No URLs? Reads ./fleet.yaml (domains x pages), or --fleet <path>
  looksy batch <dir> [options]    Batch screenshot files in a directory
  looksy history [url-slug]       Show capture history timeline
  looksy validate-theme <json|css> Validate theme color pairs against WCAG AA
                                  (JSON pairs, or :root / Tailwind v4 @theme CSS vars;
                                  --text-on fg,fg2 [--bg-tokens bg,bg2] = cross-product)
  looksy fingerprint collect <url> --save <name>   Save structural fingerprint
  looksy fingerprint collect --serve-dir <dir> --save <name>  Fingerprint a static build
  looksy fingerprint collect-batch --serve-dir <dir> [--glob "*/index.html"]  Batch collect
  looksy fingerprint compare <n1> <n2> [n3...]     Compare fingerprints (pairwise or matrix)
  looksy fingerprint diff <before> <after>         Show what changed between two versions
  looksy fingerprint list                          List saved fingerprints
  looksy list                     List saved baselines
  looksy --serve                  Start persistent Chromium server, detached (~100ms captures)
  looksy --serve --foreground     Same, but blocks in this process (for systemd/pm2/&)
  looksy --serve-stop             Stop persistent Chromium server
  echo '<html>' | looksy --html   Screenshot piped HTML

  Quote URLs containing ? or & (zsh globbing / word-splitting): looksy "https://a.com/?q=1"

Capture options:
  -o, --output <path>    Output path (default: ${DEFAULT_OUTPUT}); dir/ or existing dir = one file per URL (fleet/--urls/--pages)
  --mobile               Mobile viewport (390x844)
  --tablet               Tablet viewport (768x1024)
  --full                 Full page scroll capture
  --max-height <n>       Cap full-page capture height (use with --full)
  --width <n>            Custom viewport width
  --height <n>           Custom viewport height
  --selector <css>       Screenshot specific element
  --all                  With --selector: screenshot every matching element
  --multi                Desktop + mobile screenshots
  --wait <ms>            Wait before screenshot
  --dark                 Emulate dark color scheme
  --design               Shorthand: --full --meta --compact --fonts --css-vars --contrast --suggest
                         (many URLs, one table → looksy fleet <url...> --design)
  --design-audit         Pre-launch QA gate: --design's sidecar + responsive-check at 375/768/1440
                         (touch targets, hscroll, per-breakpoint contrast) + --seo --schema
                         --font-sources --check "no generator, self-hosted-fonts, contrast:aa"
  --fold                 Viewport-only capture (overrides --full)
  --micro                Thumbnail mode (640px wide, JPEG q40)
  --suffix, --name <n>   Suffix for default output (preview-<name>.png)
  --format <png|jpeg>    Output format (default: png)
  --quality <n>          JPEG quality 0-100 (default: 80)

Metadata & analysis:
  --meta                 Extract page metadata sidecar (.meta.md)
  --tailwind             Tailwind utility profile (groups class names by category; implies --meta)
  --annotate             Draw numbered bounding boxes on elements
  --layout               Highlight flex/grid containers with overlay + legend
  --perf                 Core Web Vitals (FCP, LCP, CLS, TTFB)
  --a11y                 Accessibility audit (landmarks, headings, issues)
  --contrast             WCAG color contrast check (ratio < 1.5:1 flagged [INVISIBLE], listed first)
  --contrast-limit <n>   Max elements sampled by contrast checks (default 150)
  --limit <n|all>        Max offenders listed per section (touch targets, uncompressed,
                         no-cache, large bundles, images; default 10 / 5 in compact lists)
  --visible-only         Skip hidden elements in contrast checks
  --fail-on-aa           Exit code 1 if any AA contrast failures
  --fail-on-aaa          Exit code 1 if any AAA contrast failures
  --network              Network waterfall (top 15 slowest resources)
  --css-vars             Extract CSS custom properties from :root
  --fonts                Font loading verification
  --lighthouse           Extended performance metrics (memory, long tasks)
  --dom-stats            DOM complexity one-liner (elements, depth, inline styles)
  --links                Dead link checker (HEAD request all hrefs)
  --links-allow <domains>
                         Comma-separated host suffixes always bucketed unverifiable (never broken)
  --coverage             CSS/JS code coverage analysis
  --class-audit          Extract all CSS class names (fingerprint detection)
  --font-sources         List all font file URLs and CDN domains
  --asset-hashes         List hashed asset filenames (build fingerprints)
  --seo                  SEO audit (robots.txt, sitemap, og, canonical, schema)
  --schema               JSON-LD structured data extraction and validation
  --bundles              JS bundle analysis (chunks, categories, large bundles)
  --images               Image audit (oversized, lazy/eager, format, dimensions)
  --compression          Compression check (gzip/brotli/none per resource)
  --third-party          Third-party resource impact by origin
  --cache-audit          Cache policy audit (cache status, TTL, issues)
  --critical-path        Critical rendering path analysis
  --resource-hints       Resource hints audit (preload/preconnect/prefetch)
  --server-timing        Server timing + TTFB breakdown
  --image-optimizer      Probe ?w=/known-host optimizer images at w=64/w=1080,
                         flag PASS-THROUGH when both sizes come back equal
  --budget <json|inline> Performance budget gate (exit code 1 on failure)
  --speed                Compound: all performance analysis in one flag
  --design-spec <json>   Validate page against a design specification
  --diff-report <name>   Semantic diff against a saved baseline
  --suggest              Actionable fix recommendations (contrast, a11y, seo)
  --delta                Incremental diff vs previous capture (~80 tokens)
  --compact              Condensed metadata (~50-60% fewer tokens)
  --json                 Output metadata as JSON instead of markdown

Token-saving:
  --report               Text-only summary (~100 tokens, no screenshot needed)
  --check <assertions>   Pass/fail checklist (comma-separated; unknown names error out):
                           sticky header · dark bg[:sel] · light bg[:sel] · text:<phrase>
                           class:<name> · selector:<css> · count:N <css> · has <css>
                           no <pattern> · visible <css> · hidden <css>
                           font:<css>=<family> · bg:<css>=<hex> · color:<css>=<hex>
                           contrast:aa · contrast:aaa · no-hscroll · touch-targets[:N]
                           h1-count[:N] · heading-outline · no-broken-images · alt-text
                           lang · canonical · meta-description · og-image · og-title
                           og-tags · twitter-card · no generator · translated
                           self-hosted-fonts · no-google-fonts · unique-footer · unique-nav
  --audit <pattern>      Flag elements matching a design token pattern
  -q, --quiet            No output-path lines — Page line, analyzer summaries, checks only
  --brief                ≤10-line red-only summary for gate/hook use (implies -q)
  --fail-only            fleet/pages/urls: print only red pages, plus a trailing "N clean" line

Capture modes:
  --sweep                Screenshot at 5 responsive breakpoints (320-1440px)
  --sweep-widths <w>     Custom breakpoints (e.g. "375,768,1280")
  --sections             Screenshot each page section individually
  --filmstrip <ms>       Capture frames over duration (filmstrip PNG)
  --filmstrip-scroll <px> Scroll distance during filmstrip capture
  --components <sels>    Screenshot multiple elements (comma-separated selectors)
  --responsive-check     Responsive audit: overflow, touch targets, text size
  --target-size <px>     Touch target minimum size (default 44; 24 for WCAG AA)
  --history              Save each capture to timestamped history timeline

Auth & consent:
  --cookie <cookies>     Set cookies (e.g. "name=value; name2=value2")
  --local-storage <kv>   Seed localStorage before load (e.g. "cmp_consent=1; theme=dark")
  --dismiss-consent      Click a known cookie/consent accept control after load (OneTrust,
                         Cookiebot, Usercentrics, Didomi, CookieYes, …) or hide the CMP overlay
  --storage-state <path> Playwright storage state JSON file
  --basic-auth <u:p>     Basic auth credentials (user:password)

Comparison & diffing:
  --diff-inline <path>   Side-by-side diff against a "before" PNG
  --compare <url>        Visual comparison between two URLs
  --guard <name>         Visual regression gate with auto-baseline (--threshold N%)
  --threshold <n>        Pixel change threshold for --guard (default: 0.5%)
  --ignore <selectors>   Mask dynamic regions before capture/diff (e.g. ".ad,.timestamp")

Batch & multi-page:
  --pages <paths>        Batch screenshot paths on one domain (e.g. "/,/pricing,/contact")
                          "@sitemap" reads <origin>/sitemap.xml (+ index sitemaps) instead
  --pages-limit N        Cap the expanded --pages list to N pages (with @sitemap or a manual list)
  --urls <urls>          Batch screenshot full URLs across domains (comma-separated)
  --url-file <path>      Batch screenshot URLs from a file (one URL per line)
  --fleet <path>         fleet.yaml location for "looksy fleet" with no URLs (default: ./fleet.yaml)
  --batch-report         With --pages/--urls: consolidated markdown table (batch-report.md)
  --locales <list>       Cross-product locales × pages (e.g. "en,de")
  --consistency          Flag cross-page/cross-domain divergences
  --i18n-check <a>,<b>   Structural comparison of two locale paths
  --serve-dir <dir>      Serve a directory via HTTP (use with --pages or fingerprint collect)
  --glob <pattern>       File pattern for batch mode (e.g. "*/index.html")
  --concurrency <n>      Max parallel page captures (default: 3 with --design, else unlimited)

Watch & server:
  --watch <dir>          Re-screenshot on file changes in directory
  --serve                Start persistent Chromium server, detached (~100ms captures)
  --foreground           With --serve: block in this process instead of detaching
  --serve-stop           Stop persistent Chromium server
  --cdp <endpoint>       Attach to an existing browser over CDP (http://localhost:9222
                         or ws:// endpoint) — e.g. a Playwright MCP session; keeps its
                         auth/cookies/storage instead of launching a fresh Chromium

Export:
  --pdf                  Export page as PDF
  --record <ms>          Record video for duration (WebM)
  --har                  Export HTTP Archive

Advanced:
  --html                 Read HTML from stdin instead of URL
  --fragment             Suppress doc-level issues (missing lang, canonical) for
                         component/fragment previews (piped HTML with no <head>)
  --interact <actions>   Actions before capture (click:.btn,wait:500,scroll:1000)
  --inject <css>         Inject custom CSS before capture
  --no-stabilize         Skip capture stabilization (fonts.ready wait + animation pause)
  --timeout <ms>         Navigation timeout (default: 30000)
  --host-resolver <domain:ip>  Force one hostname to resolve to one IP for this run
                         (bypasses the OS resolver — stale DNS after a domain cutover)
  --output-dir <dir>     Output directory for batch captures
  --cat-meta             Print meta file contents to stdout
  --mcp                  Run as MCP tool server for Claude Code
  -v, --version          Show version number
  -h, --help             Show this help

Environment:
  LOOKSY_DIR             Base directory (default: /tmp/looksy). Use for persistent baselines in CI.`);
}
