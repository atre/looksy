import { describe, it, expect } from 'vitest';
import { findFiles, startStaticServer } from '../../dist/static-server.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TMP = '/tmp/looksy-test-static-server';

describe('findFiles', () => {
  // Set up temp directory structure
  const setup = () => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'template-a', '_astro'), { recursive: true });
    mkdirSync(join(TMP, 'template-b', '_astro'), { recursive: true });
    mkdirSync(join(TMP, 'template-c', 'sub'), { recursive: true });
    writeFileSync(join(TMP, 'template-a', 'index.html'), '<html>a</html>');
    writeFileSync(join(TMP, 'template-a', '_astro', 'style.css'), 'body{}');
    writeFileSync(join(TMP, 'template-b', 'index.html'), '<html>b</html>');
    writeFileSync(join(TMP, 'template-b', 'about.html'), '<html>about</html>');
    writeFileSync(join(TMP, 'template-c', 'index.html'), '<html>c</html>');
    writeFileSync(join(TMP, 'template-c', 'sub', 'page.html'), '<html>sub</html>');
  };

  it('finds files matching */index.html', () => {
    setup();
    const files = findFiles(TMP, '*/index.html');
    expect(files).toEqual([
      'template-a/index.html',
      'template-b/index.html',
      'template-c/index.html',
    ]);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('finds files matching **/*.html', () => {
    setup();
    const files = findFiles(TMP, '**/*.html');
    expect(files).toContain('template-a/index.html');
    expect(files).toContain('template-b/about.html');
    expect(files).toContain('template-c/sub/page.html');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('finds files matching *.css in subdirectories', () => {
    setup();
    const files = findFiles(TMP, '**/*.css');
    expect(files).toEqual([
      'template-a/_astro/style.css',
    ]);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('returns empty array for no matches', () => {
    setup();
    const files = findFiles(TMP, '*.xyz');
    expect(files).toEqual([]);
    rmSync(TMP, { recursive: true, force: true });
  });
});

describe('startStaticServer .html fallback', () => {
  const TMP_SERVE = '/tmp/looksy-test-serve-fallback';

  it('resolves /slug to /slug.html for clean URLs', async () => {
    rmSync(TMP_SERVE, { recursive: true, force: true });
    mkdirSync(TMP_SERVE, { recursive: true });
    writeFileSync(join(TMP_SERVE, 'index.html'), '<html>index</html>');
    writeFileSync(join(TMP_SERVE, 'about.html'), '<html>about</html>');
    mkdirSync(join(TMP_SERVE, 'pricing'), { recursive: true });
    writeFileSync(join(TMP_SERVE, 'pricing', 'index.html'), '<html>pricing</html>');

    const server = await startStaticServer(TMP_SERVE);
    try {
      // Direct file access
      const indexRes = await fetch(`${server.url}/index.html`);
      expect(indexRes.status).toBe(200);
      expect(await indexRes.text()).toContain('index');

      // Directory → index.html fallback
      const pricingRes = await fetch(`${server.url}/pricing`);
      expect(pricingRes.status).toBe(200);
      expect(await pricingRes.text()).toContain('pricing');

      // Clean URL → .html fallback (the new feature)
      const aboutRes = await fetch(`${server.url}/about`);
      expect(aboutRes.status).toBe(200);
      expect(await aboutRes.text()).toContain('about');

      // Non-existent still 404s
      const missingRes = await fetch(`${server.url}/nonexistent`);
      expect(missingRes.status).toBe(404);
    } finally {
      server.close();
      rmSync(TMP_SERVE, { recursive: true, force: true });
    }
  });
});
