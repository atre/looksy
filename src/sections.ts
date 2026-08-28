import type { Page } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SectionResult {
  index: number;
  tag: string;
  label: string;
  heading?: string;
  path: string;
  rect: { x: number; y: number; width: number; height: number };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Detect page sections and screenshot each one individually.
 * Uses clip-based screenshots (absolute rects) to avoid non-unique selector issues.
 * Prefers slugified heading text for filenames.
 */
export async function screenshotSections(
  page: Page,
  outputBase: string,
): Promise<SectionResult[]> {
  const dir = dirname(outputBase);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const baseName = outputBase.replace(/\.(png|jpg|jpeg)$/, '');
  const extMatch = outputBase.match(/\.(png|jpg|jpeg)$/);
  const ext = extMatch ? extMatch[0] : '.png';

  const sectionInfo = await page.evaluate(() => {
    const elements = document.querySelectorAll(
      'header, nav, section, main, article, aside, footer',
    );
    const seen = new Set<Element>();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const sections: Array<{
      tag: string;
      id?: string;
      className?: string;
      heading?: string;
      rect: { x: number; y: number; width: number; height: number };
    }> = [];

    for (const el of elements) {
      if (seen.has(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 50 || rect.width < 50) continue;
      seen.add(el);

      const tag = el.tagName.toLowerCase();
      const id = el.id || undefined;
      const cls = el.className ? String(el.className).split(' ')[0] : undefined;

      const h = el.querySelector('h1,h2,h3');
      const heading = h ? (h.textContent || '').trim().slice(0, 50) : undefined;

      // Store absolute rect (account for scroll offset)
      sections.push({
        tag,
        id,
        className: cls,
        heading,
        rect: {
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height,
        },
      });
    }

    return sections;
  });

  const results: SectionResult[] = [];

  for (let i = 0; i < sectionInfo.length; i++) {
    const info = sectionInfo[i];
    // Prefer slugified heading, fall back to id/class/tag
    const label = info.heading ? slugify(info.heading) : (info.id || info.className || info.tag);
    const path = `${baseName}-${i + 1}-${label}${ext}`;

    try {
      // Use clip-based screenshot with absolute rects — avoids non-unique selector issues
      await page.screenshot({
        path,
        clip: {
          x: Math.max(0, info.rect.x),
          y: Math.max(0, info.rect.y),
          width: info.rect.width,
          height: info.rect.height,
        },
      });
      results.push({
        index: i + 1,
        tag: info.tag,
        label,
        heading: info.heading,
        path,
        rect: info.rect,
      });
    } catch {
      // skip sections that can't be screenshotted
    }
  }

  return results;
}
