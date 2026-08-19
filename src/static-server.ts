import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { readdirSync } from 'node:fs';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

export interface StaticServer {
  url: string;
  port: number;
  close: () => void;
}

/**
 * Start a static HTTP server for a local directory.
 * Serves files with correct MIME types. Uses a random available port.
 */
export async function startStaticServer(dir: string): Promise<StaticServer> {
  const root = resolve(dir);

  const server: Server = createServer(async (req, res) => {
    try {
      let urlPath: string;
      try {
        urlPath = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
      }
      let filePath = resolve(root, '.' + urlPath);

      // Prevent path traversal outside served directory
      if (!filePath.startsWith(root + sep) && filePath !== root) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // Serve index.html for directory paths, fall back to .html extension for clean URLs
      try {
        const st = await stat(filePath);
        if (st.isDirectory()) filePath = join(filePath, 'index.html');
      } catch {
        // Try appending .html for clean URL resolution (e.g. /about → /about.html)
        // Supports Astro format:'file' builds and similar static site generators
        if (!extname(filePath)) {
          try {
            const htmlPath = filePath + '.html';
            const htmlSt = await stat(htmlPath);
            if (htmlSt.isFile()) filePath = htmlPath;
          } catch { /* will 404 below */ }
        }
      }

      try {
        const data = await readFile(filePath);
        const ext = extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    } catch (err: any) {
      // Last-resort safety net: anything unexpected becomes a 500 rather than a hung connection.
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Internal Server Error: ${err?.message ?? 'unknown'}`);
        } else {
          res.end();
        }
      } catch { /* socket already gone */ }
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}

/**
 * Recursively find files matching a simple glob pattern in a directory.
 * Supports * (single path segment) and ** (any depth).
 */
export function findFiles(dir: string, pattern: string): string[] {
  const root = resolve(dir);
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function walk(currentDir: string): void {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(currentDir, entry.name);
      const relativePath = fullPath.slice(root.length + 1);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && regex.test(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  walk(root);
  return results.sort();
}

/** Convert a simple glob pattern to a regex. */
function globToRegex(pattern: string): RegExp {
  const parts = pattern
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => {
      if (segment === '**') return '(?:.+/)?';
      return segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
    });

  // Build regex: join parts with /
  let regexStr = '^';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '(?:.+/)?') {
      // ** matches zero or more path segments
      regexStr += parts[i];
    } else {
      if (i > 0 && parts[i - 1] !== '(?:.+/)?') regexStr += '/';
      regexStr += parts[i];
    }
  }
  regexStr += '$';

  return new RegExp(regexStr);
}
