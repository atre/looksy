# Contributing to looksy

Thanks for your interest! Bug reports, feature requests, and PRs are all welcome.

## Development setup

```bash
git clone https://github.com/atre/looksy.git
cd looksy
npm install            # also builds dist/ via prepare
npm link               # optional: makes `looksy` available globally
```

Requires Node.js 18.3+. Playwright Chromium is installed automatically on `npm install`; if that fails, run `npx playwright install chromium`.

## Running tests

```bash
npm test               # tsc + full vitest suite
npx vitest             # watch mode
npx vitest run tests/unit/contrast.test.ts   # single file
```

Some tests launch a real Chromium — make sure the Playwright browser is installed.

## Guidelines

- **Flag parsing is strict** — new flags must be registered explicitly; unknown flags error on purpose. See `.claude/rules/flag-behavior.md` for the full flag reference and keep it in sync with any CLI change.
- **Every analysis module goes through `safeRun()`** — a failing module should report, not crash the capture.
- **No config files, no interactive prompts** — everything is CLI flags, batch-friendly, exit code 0/1.
- **Add tests** for new flags, modules, or bug fixes (Vitest, `tests/`).
- Keep README's Usage section and `--help` output in sync with the code.

## Reporting bugs

Open an issue with the exact command, expected vs actual behavior, and OS/Node version. For rendering issues, attach the screenshot and `.meta.md` sidecar if possible.
