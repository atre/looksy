---
name: visual-qa
description: Screenshot → AI review → iterate workflow for visual QA of any rendered web page, using the globally installed `looksy` CLI. TRIGGER when reviewing UI changes in a real browser, doing design review, before/after or visual-regression comparison, WCAG contrast / a11y audit, page performance audit, fleet-wide site checks, or any "check how it looks / verify the frontend" request — in any repo. SKIP when there is no rendered UI, or when the project defines its own preview/QA skill (project skill wins).
---

# Visual QA Workflow (looksy)

Screenshots show THAT something looks wrong; the sidecar (`--meta`/`--compact`) shows WHY (font-size, padding, colors, contrast). Full flag reference: `~/git/looksy/.claude/rules/flag-behavior.md`. Off PATH → `node ~/git/looksy/bin/looksy.js`.

## Core loop

```
looksy --serve                                       # once; detached, idempotent (--serve-stop to kill)
looksy <url> --design --name baseline                # --full --meta --compact --fonts --css-vars --contrast --suggest (~1k tokens)
[make changes]
looksy <url> --design --name v1
looksy <url> --diff-inline /tmp/looksy/preview-baseline.png   # pixel side-by-side → preview-diff.png
looksy <url> --delta                                 # ~80 tokens: metadata diff vs previous capture
looksy <url> --check "contrast:aa, no-hscroll, text:Expected"  # ~50 tokens, exit 1 on fail
```

`--name`/`-o`/`--suffix` force the PNG even in text-only modes (`--report`, `--check`). Stale DNS after a cutover: `--host-resolver domain:ip`.

## Cost / mode picker

| Mode | Tokens | Use |
|---|---|---|
| `--check "…"` | ~50 | assertion pass/fail (CI, hooks) |
| `--report` / `--delta` | ~100 / ~80 | text-only summary / changed props only |
| `--design` | ~1,000 | design review |
| `--design-audit` | ~1,200 | pre-launch gate: + `--seo --schema --font-sources --responsive-check --check "no generator, self-hosted-fonts, contrast:aa"` |
| `--speed` | ~2,500 | perf: perf/network/coverage/bundles/images/compression/third-party/cache/critical-path/hints/server-timing/image-optimizer |

## Fleet / batch

```bash
looksy fleet https://a.com https://b.com --design-audit -q   # N URLs, shared browser, batch-report.md, exit 1 on AA fail
looksy fleet --design-audit                                  # no URLs → ./fleet.yaml (domains × pages; --fleet <path> to override)
looksy fleet --brief                                         # red-only ≤10 lines: `✗ <url> — HTTP 404, hscroll +21px, 2 AA fail` | `✓ N URLs clean`
looksy fleet https://a.com https://b.com -o out/             # -o dir/ → one preview-<slug>.png + sidecar per URL (else last URL wins)
looksy <url> --pages "/,/pricing,/about" --design --consistency --batch-report   # same-domain, cross-page consistency
looksy <url> --links --links-allow "linkedin.com,x.com"      # dead links; allow-list hosts → `unverifiable`, not dead
```

`--brief` implies `-q`; use it in gates/hooks, `--design*` when you need to read the sidecar. `-q` alone drops path lines + the `--serve` tip.

## `findings[]` — machine contract

Every `.meta.json` (`--json`; always under `fleet`/`--batch-report`) has `findings: [{ id: "visual:<url>/<check>", scope: "site", severity: "crit"|"warn", title: "no-hscroll: +174px at 375px", hint: "--sweep" }]` — same shape as pulse; `crit` = failed `--check`, `warn` = audit-only red (contrast AA, hscroll, touch-targets). Per-URL sidecars only — concat them for a fleet view. Consumers: snuff `--profile prod`, pulse, brief.

## Other recipes

- Regression baseline: `looksy save <url> <name>` → `looksy diff <url> <name>` (or `looksy diff a.png b.png`)
- Responsive: `looksy <url> --responsive-check --fail-on-aa --visible-only`; `--sweep` for breakpoint loop
- Fingerprint (cross-site similarity): `looksy fingerprint collect <url> --save v1` → `fingerprint compare v1 v2`
- CI budget: `looksy <url> --budget "totalJS:200KB,FCP:1800,CLS:0.1" --check "contrast:aa"`
- Consent/auth: `--dismiss-consent`, `--cookie`, `--local-storage`, `--storage-state`, `--basic-auth`
- MCP: `looksy --mcp` → `screenshot`, `save-baseline`, `diff-baseline`, `fingerprint-*`, `validate-theme`, `validate-contrast`, `validate-design`, `diff-report`
