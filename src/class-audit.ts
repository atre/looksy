import type { Page } from 'playwright';

export interface ClassAuditData {
  /** Total unique class names found */
  totalClasses: number;
  /** All unique class names */
  classes: string[];
  /** Classes that look like framework-generated hashes (e.g. _astro/, Tailwind arbitrary) */
  hashedClasses: string[];
  /** Most frequently used classes (top 20) */
  topClasses: Array<{ name: string; count: number }>;
  /** Most frequent class combinations (sorted multi-class signatures) — surfaces recurring component shapes */
  topCombos: Array<{ combo: string; count: number; classCount: number }>;
}

/**
 * Extract all CSS class names from the page DOM.
 * Useful for detecting fingerprinting vectors (identical class hashes across sites).
 */
export async function extractClassAudit(page: Page): Promise<ClassAuditData> {
  return await page.evaluate(() => {
    const classCounts = new Map<string, number>();
    const comboCounts = new Map<string, { count: number; classCount: number }>();

    for (const el of document.querySelectorAll('*')) {
      const list = Array.from(el.classList);
      if (list.length === 0) continue;
      for (const cls of list) {
        classCounts.set(cls, (classCounts.get(cls) || 0) + 1);
      }
      // Combos: 2+ classes only — sorted for stable signature
      if (list.length >= 2) {
        const combo = list.slice().sort().join(' ');
        const existing = comboCounts.get(combo);
        if (existing) existing.count++;
        else comboCounts.set(combo, { count: 1, classCount: list.length });
      }
    }

    const classes = Array.from(classCounts.keys()).sort();

    // Detect hashed/generated class names (common patterns)
    const hashPattern = /^[a-zA-Z_-]*[a-f0-9]{5,}$|^_[a-zA-Z]+_[a-z0-9]+$|^astro-|^css-|^sc-|^emotion-|^_astro/;
    const hashedClasses = classes.filter((c) => hashPattern.test(c));

    // Top 20 most-used classes
    const topClasses = Array.from(classCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    // Top 10 recurring combos (need to repeat at least twice to be a "pattern")
    const topCombos = Array.from(comboCounts.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([combo, v]) => ({ combo, count: v.count, classCount: v.classCount }));

    return {
      totalClasses: classes.length,
      classes: classes.slice(0, 200), // cap to avoid huge payloads
      hashedClasses: hashedClasses.slice(0, 50),
      topClasses,
      topCombos,
    };
  });
}

export interface ClassCompareResult {
  /** Classes shared by both pages */
  shared: string[];
  /** Hashed classes shared (fingerprint overlap) */
  sharedHashed: string[];
  /** Classes only in page A */
  onlyA: string[];
  /** Classes only in page B */
  onlyB: string[];
  totalA: number;
  totalB: number;
}

/** Compare class audit data from two pages to find fingerprint overlap. */
export function compareClassAudits(a: ClassAuditData, b: ClassAuditData): ClassCompareResult {
  const setA = new Set(a.classes);
  const setB = new Set(b.classes);
  const shared = a.classes.filter((c) => setB.has(c));
  const hashedA = new Set(a.hashedClasses);
  const hashedB = new Set(b.hashedClasses);
  const sharedHashed = shared.filter((c) => hashedA.has(c) || hashedB.has(c));

  return {
    shared,
    sharedHashed,
    onlyA: a.classes.filter((c) => !setB.has(c)),
    onlyB: b.classes.filter((c) => !setA.has(c)),
    totalA: a.totalClasses,
    totalB: b.totalClasses,
  };
}

export function formatClassCompare(result: ClassCompareResult, opts: { compact?: boolean; urlA?: string; urlB?: string } = {}): string {
  const labelA = opts.urlA ?? 'Page A';
  const labelB = opts.urlB ?? 'Page B';

  if (opts.compact) {
    const fingerprint = result.sharedHashed.length > 0
      ? ` | ⚠ ${result.sharedHashed.length} shared hashed: ${result.sharedHashed.slice(0, 5).join(', ')}${result.sharedHashed.length > 5 ? '...' : ''}`
      : '';
    return `## Class Compare: ${result.shared.length} shared, ${result.onlyA.length} unique to A, ${result.onlyB.length} unique to B${fingerprint}\n`;
  }

  const lines = ['## Class Audit Comparison\n'];
  lines.push(`| | ${labelA} | ${labelB} |`);
  lines.push('|---|---|---|');
  lines.push(`| Total classes | ${result.totalA} | ${result.totalB} |`);
  lines.push(`| Shared | ${result.shared.length} | ${result.shared.length} |`);
  lines.push(`| Unique | ${result.onlyA.length} | ${result.onlyB.length} |`);
  lines.push('');

  if (result.sharedHashed.length > 0) {
    lines.push(`### Shared Hashed Classes (${result.sharedHashed.length}) — Fingerprint Risk\n`);
    lines.push('Identical generated class names indicate shared build output:\n');
    for (const c of result.sharedHashed.slice(0, 30)) {
      lines.push(`- \`${c}\``);
    }
    lines.push('');
  }

  if (result.shared.length > 0) {
    lines.push(`### All Shared Classes (${result.shared.length})\n`);
    lines.push(`\`${result.shared.slice(0, 100).join('`, `')}\``);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatClassAudit(data: ClassAuditData, opts: { compact?: boolean } = {}): string {
  if (data.totalClasses === 0) return '## Class Audit: no classes found\n';

  if (opts.compact) {
    const hashed = data.hashedClasses.length > 0
      ? ` | ${data.hashedClasses.length} hashed: ${data.hashedClasses.slice(0, 5).join(', ')}${data.hashedClasses.length > 5 ? '...' : ''}`
      : '';
    const combo = data.topCombos.length > 0
      ? ` | ${data.topCombos.length} recurring combo${data.topCombos.length > 1 ? 's' : ''} (top: ${data.topCombos[0].count}x)`
      : '';
    return `## Class Audit: ${data.totalClasses} unique classes${hashed}${combo}\n`;
  }

  const lines = ['## Class Audit\n'];
  lines.push(`**${data.totalClasses} unique CSS classes**\n`);

  if (data.hashedClasses.length > 0) {
    lines.push(`### Generated/Hashed Classes (${data.hashedClasses.length})\n`);
    lines.push('These may create fingerprinting vectors if identical across sites:\n');
    for (const c of data.hashedClasses) {
      lines.push(`- \`${c}\``);
    }
    lines.push('');
  }

  lines.push('### Most Used Classes\n');
  lines.push('| Class | Count |');
  lines.push('|-------|-------|');
  for (const c of data.topClasses) {
    lines.push(`| \`${c.name}\` | ${c.count} |`);
  }
  lines.push('');

  if (data.topCombos.length > 0) {
    lines.push(`### Recurring Class Combinations (${data.topCombos.length})\n`);
    lines.push('Repeated multi-class signatures suggest reusable component shapes:\n');
    lines.push('| Count | Classes | Combo |');
    lines.push('|-------|---------|-------|');
    for (const c of data.topCombos) {
      const display = c.combo.length > 100 ? c.combo.slice(0, 100) + '…' : c.combo;
      lines.push(`| ${c.count} | ${c.classCount} | \`${display}\` |`);
    }
    lines.push('');
  }

  lines.push('### All Classes\n');
  lines.push(`\`${data.classes.join('`, `')}\``);
  lines.push('');

  return lines.join('\n');
}
