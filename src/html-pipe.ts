import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOOKSY_DIR } from './utils.js';

const TEMP_DIR = LOOKSY_DIR;
const TEMP_HTML = resolve(TEMP_DIR, '_pipe.html');

/**
 * Read HTML from stdin (non-blocking check).
 * Returns null if stdin is a TTY (no pipe).
 * On timeout, warns on stderr if partial data was captured so truncation isn't silent.
 */
export function readStdin(timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }

    let data = '';
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    const timer = setTimeout(() => {
      if (data) {
        process.stderr.write(
          `looksy: stdin timed out after ${timeoutMs}ms with ${data.length} bytes — input may be truncated\n`
        );
      }
      finish(data || null);
    }, timeoutMs);
    process.stdin.on('end', () => { clearTimeout(timer); finish(data || null); });
    process.stdin.on('error', (err) => {
      clearTimeout(timer);
      process.stderr.write(`looksy: stdin error: ${err.message}\n`);
      finish(data || null);
    });
  });
}

/**
 * Write HTML content to a temp file and return its file:// URL.
 */
export function htmlToTempUrl(html: string): string {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Wrap bare HTML snippets in a basic document
  let fullHtml = html;
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
    fullHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body { font-family: -apple-system, sans-serif; margin: 24px; }</style>
</head><body>${html}</body></html>`;
  }

  writeFileSync(TEMP_HTML, fullHtml, 'utf-8');
  return `file://${TEMP_HTML}`;
}

/**
 * Clean up temp HTML file.
 */
export function cleanupTempHtml(): void {
  try {
    if (existsSync(TEMP_HTML)) unlinkSync(TEMP_HTML);
  } catch {
    // ignore
  }
}
