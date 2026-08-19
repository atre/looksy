import type { Page } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractMetadata } from './metadata.js';
import { extractFonts, type FontInfo } from './fonts.js';
import { extractCssVars, type CssVar } from './css-vars.js';
import { LOOKSY_DIR } from './utils.js';
import { attributeDiff, type AttributionElement, type Region } from './diff-attribution.js';

const META_DIR = `${LOOKSY_DIR}/baselines`;

/** Per-element data captured alongside the semantic snapshot — feeds diff-attribution. */
export interface SnapshotElement {
  selector: string;
  tag: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
}

export interface SemanticSnapshot {
  title: string;
  pageHeight: number;
  fonts: string[];
  fontDetails: FontInfo[];
  colors: { property: string; value: string; element: string }[];
  headings: { level: number; text: string }[];
  cssVars: { name: string; value: string }[];
  elementCount: number;
  /**
   * Optional: per-element rects + computed styles, used for diff→element attribution.
   * Optional (not required) so older baselines saved before this field existed — whose
   * JSON on disk simply lacks it — still load and compare cleanly.
   */
  elements?: SnapshotElement[];
}

/**
 * Capture a semantic snapshot of the page for diff comparison.
 */
export async function captureSemanticSnapshot(page: Page): Promise<SemanticSnapshot> {
  const meta = await extractMetadata(page);
  const fontDetails = await extractFonts(page);
  const cssVars = await extractCssVars(page);

  return {
    title: meta.title,
    pageHeight: meta.pageHeight,
    fonts: meta.fonts,
    fontDetails,
    colors: meta.colors,
    headings: meta.headings,
    cssVars,
    elementCount: meta.elements.length,
    elements: meta.elements.map((el) => ({
      selector: el.selector,
      tag: el.tag,
      rect: el.rect,
      styles: el.styles,
    })),
  };
}

/**
 * Save a semantic snapshot alongside a baseline.
 */
export function saveSemanticBaseline(snapshot: SemanticSnapshot, name: string): string {
  const safeName = name.replace(/[/\\]/g, '-').replace(/\.\./g, '');
  if (!existsSync(META_DIR)) mkdirSync(META_DIR, { recursive: true, mode: 0o700 });
  const dest = resolve(META_DIR, `${safeName}.meta.json`);
  writeFileSync(dest, JSON.stringify(snapshot, null, 2));
  return dest;
}

/**
 * Check whether a semantic baseline exists. Cheaper than loadSemanticBaseline
 * when the caller only needs to fail-fast before doing expensive capture work.
 */
export function hasSemanticBaseline(name: string): boolean {
  const safeName = name.replace(/[/\\]/g, '-').replace(/\.\./g, '');
  return existsSync(resolve(META_DIR, `${safeName}.meta.json`));
}

/**
 * Load a saved semantic baseline.
 */
export function loadSemanticBaseline(name: string): SemanticSnapshot {
  const safeName = name.replace(/[/\\]/g, '-').replace(/\.\./g, '');
  const path = resolve(META_DIR, `${safeName}.meta.json`);
  if (!existsSync(path)) {
    throw new Error(`Semantic baseline "${name}" not found. Run: looksy save <url> ${name}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err: any) {
    throw new Error(
      `Semantic baseline "${name}" is corrupt (${err.message}). Re-save it: looksy save <url> ${name}`,
    );
  }
}

/**
 * Compare two semantic snapshots and produce a human-readable diff report.
 */
export function compareSemanticSnapshots(
  before: SemanticSnapshot,
  after: SemanticSnapshot,
  regions: Region[] = [],
): string {
  const changes: string[] = [];

  // Changed elements (diff→element attribution) — headline section, so it leads the report.
  if (regions.length > 0) {
    const beforeElements: AttributionElement[] = before.elements ?? [];
    const afterElements: AttributionElement[] = after.elements ?? [];
    if (beforeElements.length > 0 || afterElements.length > 0) {
      const attributions = attributeDiff(regions, beforeElements, afterElements);
      if (attributions.length > 0) {
        const totalArea = regions.reduce((sum, r) => sum + r.width * r.height, 0);
        changes.push('### Changed Elements');
        for (const attr of attributions.slice(0, 10)) {
          const elArea = attr.rect.width * attr.rect.height;
          const overlapArea = (attr.overlapPct / 100) * elArea;
          const shareOfChanged = totalArea > 0 ? Math.min(100, (overlapArea / totalArea) * 100) : 0;
          changes.push(
            `  - \`${attr.selector}\` (${attr.tag}) — ${shareOfChanged.toFixed(0)}% of changed area`,
          );
          if (attr.styleDeltas) {
            for (const d of attr.styleDeltas.slice(0, 6)) {
              changes.push(`      ${d.prop}: ${d.before || '(none)'} → ${d.after || '(none)'}`);
            }
          }
        }
        if (attributions.length > 10) {
          changes.push(`  ... and ${attributions.length - 10} more`);
        }
        changes.push('');
      }
    }
  }

  // Font changes
  const fontsBefore = new Set(before.fonts);
  const fontsAfter = new Set(after.fonts);
  const addedFonts = [...fontsAfter].filter((f) => !fontsBefore.has(f));
  const removedFonts = [...fontsBefore].filter((f) => !fontsAfter.has(f));

  if (addedFonts.length > 0 || removedFonts.length > 0) {
    changes.push('### Fonts');
    if (removedFonts.length > 0) changes.push(`  - Removed: ${removedFonts.join(', ')}`);
    if (addedFonts.length > 0) changes.push(`  + Added: ${addedFonts.join(', ')}`);
    changes.push('');
  }

  // Font detail changes (loading status)
  const fontStatusBefore = new Map(
    before.fontDetails.map((f) => [`${f.family}:${f.weight}`, f.status]),
  );
  const fontStatusAfter = new Map(
    after.fontDetails.map((f) => [`${f.family}:${f.weight}`, f.status]),
  );
  const fontStatusChanges: string[] = [];
  for (const [key, status] of fontStatusAfter) {
    const prev = fontStatusBefore.get(key);
    if (prev && prev !== status) {
      fontStatusChanges.push(`  ~ ${key}: ${prev} → ${status}`);
    }
  }
  if (fontStatusChanges.length > 0) {
    changes.push('### Font Loading');
    changes.push(...fontStatusChanges);
    changes.push('');
  }

  // Color changes
  const colorsBefore = new Map(before.colors.map((c) => [`${c.element}:${c.property}`, c.value]));
  const colorsAfter = new Map(after.colors.map((c) => [`${c.element}:${c.property}`, c.value]));

  const colorChanges: string[] = [];
  for (const [key, value] of colorsAfter) {
    const prev = colorsBefore.get(key);
    if (prev && prev !== value) {
      colorChanges.push(`  ~ ${key}: ${prev} → ${value}`);
    } else if (!prev) {
      colorChanges.push(`  + ${key}: ${value}`);
    }
  }
  for (const [key, value] of colorsBefore) {
    if (!colorsAfter.has(key)) {
      colorChanges.push(`  - ${key}: ${value}`);
    }
  }

  if (colorChanges.length > 0) {
    changes.push('### Colors');
    changes.push(...colorChanges.slice(0, 30));
    if (colorChanges.length > 30) changes.push(`  ... and ${colorChanges.length - 30} more`);
    changes.push('');
  }

  // CSS variable changes
  const varsBefore = new Map(before.cssVars.map((v) => [v.name, v.value]));
  const varsAfter = new Map(after.cssVars.map((v) => [v.name, v.value]));
  const varChanges: string[] = [];

  const allVarNames = new Set([...varsBefore.keys(), ...varsAfter.keys()]);
  for (const name of allVarNames) {
    const bv = varsBefore.get(name);
    const av = varsAfter.get(name);
    if (bv && av && bv !== av) {
      varChanges.push(`  ~ ${name}: ${bv} → ${av}`);
    } else if (!bv && av) {
      varChanges.push(`  + ${name}: ${av}`);
    } else if (bv && !av) {
      varChanges.push(`  - ${name}: ${bv}`);
    }
  }

  if (varChanges.length > 0) {
    changes.push('### CSS Variables');
    changes.push(...varChanges.slice(0, 20));
    if (varChanges.length > 20) changes.push(`  ... and ${varChanges.length - 20} more`);
    changes.push('');
  }

  // Heading changes
  const headingsBefore = before.headings.map((h) => `H${h.level}: ${h.text}`);
  const headingsAfter = after.headings.map((h) => `H${h.level}: ${h.text}`);
  const addedHeadings = headingsAfter.filter((h) => !headingsBefore.includes(h));
  const removedHeadings = headingsBefore.filter((h) => !headingsAfter.includes(h));

  if (addedHeadings.length > 0 || removedHeadings.length > 0) {
    changes.push('### Heading Structure');
    if (removedHeadings.length > 0) {
      for (const h of removedHeadings) changes.push(`  - ${h}`);
    }
    if (addedHeadings.length > 0) {
      for (const h of addedHeadings) changes.push(`  + ${h}`);
    }
    changes.push('');
  }

  // Layout changes
  const layoutChanges: string[] = [];
  if (before.pageHeight !== after.pageHeight) {
    const delta = after.pageHeight - before.pageHeight;
    const pct = before.pageHeight > 0 ? ((delta / before.pageHeight) * 100).toFixed(1) : '0';
    layoutChanges.push(
      `  Page height: ${before.pageHeight}px → ${after.pageHeight}px (${delta > 0 ? '+' : ''}${pct}%)`,
    );
  }
  if (before.elementCount !== after.elementCount) {
    const delta = after.elementCount - before.elementCount;
    layoutChanges.push(
      `  Elements: ${before.elementCount} → ${after.elementCount} (${delta > 0 ? '+' : ''}${delta})`,
    );
  }
  if (before.title !== after.title) {
    layoutChanges.push(`  Title: "${before.title}" → "${after.title}"`);
  }

  if (layoutChanges.length > 0) {
    changes.push('### Layout');
    changes.push(...layoutChanges);
    changes.push('');
  }

  if (changes.length === 0) {
    return '## Semantic Diff\n\nNo semantic changes detected.\n';
  }

  return `## Semantic Diff: "${before.title}" → "${after.title}"\n\n${changes.join('\n')}\n`;
}
