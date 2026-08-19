import type { Page } from 'playwright';

export interface SchemaItem {
  /** @type value */
  type: string;
  /** Key properties extracted from the schema */
  properties: Record<string, string>;
  /** Whether the schema has required fields */
  issues: string[];
}

export interface SchemaData {
  items: SchemaItem[];
  /** Raw JSON-LD blocks count */
  blockCount: number;
}

/**
 * Extract and validate JSON-LD structured data from the page.
 * Reports types, key properties, and basic validation issues.
 */
export async function extractSchema(page: Page): Promise<SchemaData> {
  return await page.evaluate(() => {
    const items: Array<{ type: string; properties: Record<string, string>; issues: string[] }> = [];
    const blocks = document.querySelectorAll('script[type="application/ld+json"]');

    // Collect all JSON-LD objects into a flat queue, then process
    // (avoids named function inside evaluate — esbuild keepNames wraps them with __name())
    const queue: any[] = [];
    // Dedupe by content: hydration frameworks (and some CMPs) re-inject the same JSON-LD
    // block, which used to report "WebSite, WebSite" for a page with one WebSite entity.
    const seenBlocks = new Set<string>();
    for (const el of blocks) {
      try {
        const rawText = (el.textContent || '').trim();
        const json = JSON.parse(rawText);
        const key = JSON.stringify(json);
        if (seenBlocks.has(key)) continue;
        seenBlocks.add(key);
        if (Array.isArray(json)) {
          for (const item of json) queue.push(item);
        } else if (json['@graph'] && Array.isArray(json['@graph'])) {
          for (const item of json['@graph']) queue.push(item);
        } else {
          queue.push(json);
        }
      } catch {
        items.push({ type: 'PARSE_ERROR', properties: {}, issues: ['invalid JSON'] });
      }
    }

    for (const json of queue) {
      if (!json || typeof json !== 'object') continue;
      const type = json['@type'] || 'Unknown';
      const properties: Record<string, string> = {};
      const issues: string[] = [];

      if (json.name) properties.name = String(json.name).slice(0, 100);
      if (json.description) properties.description = String(json.description).slice(0, 100);
      if (json.url) properties.url = String(json.url).slice(0, 100);
      if (json.image) properties.image = typeof json.image === 'string' ? json.image.slice(0, 100) : 'object';
      if (json.datePublished) properties.datePublished = String(json.datePublished);
      if (json.dateModified) properties.dateModified = String(json.dateModified);
      if (json.author) properties.author = typeof json.author === 'string' ? json.author : json.author?.name || 'object';
      if (json.publisher) properties.publisher = typeof json.publisher === 'string' ? json.publisher : json.publisher?.name || 'object';

      if (type === 'HowTo' || type === 'Recipe') {
        if (json.step) properties.steps = String(Array.isArray(json.step) ? json.step.length : 1);
      }
      if (type === 'FAQPage') {
        if (json.mainEntity) properties.questions = String(Array.isArray(json.mainEntity) ? json.mainEntity.length : 1);
      }
      if (type === 'ItemList') {
        if (json.itemListElement) properties.items = String(Array.isArray(json.itemListElement) ? json.itemListElement.length : 1);
      }
      if (type === 'Review' || type === 'AggregateRating') {
        if (json.ratingValue) properties.rating = String(json.ratingValue);
        if (json.reviewCount) properties.reviewCount = String(json.reviewCount);
      }
      if (type === 'Product') {
        const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
        if (offers) properties.offers = typeof offers === 'object' ? (offers.price ?? offers.lowPrice ? `${offers.priceCurrency || ''}${offers.price ?? offers.lowPrice}` : 'yes') : 'yes';
        // Google Merchant-shaped completeness: syntax-valid JSON-LD is not the same as a
        // rich-result-eligible Product. Report recommended-field coverage + what's missing.
        const has = (v: any) => v !== undefined && v !== null && v !== '';
        const recommended: Array<[string, boolean]> = [
          ['name', has(json.name)],
          ['image', has(json.image)],
          ['description', has(json.description)],
          ['sku', has(json.sku)],
          ['brand', has(json.brand)],
          ['gtin/mpn', has(json.gtin) || has(json.gtin13) || has(json.gtin8) || has(json.gtin14) || has(json.gtin12) || has(json.mpn)],
          ['offers.price', has(offers?.price) || has(offers?.lowPrice)],
          ['offers.priceCurrency', has(offers?.priceCurrency)],
          ['offers.availability', has(offers?.availability)],
          ['offers.shippingDetails', has(offers?.shippingDetails)],
          ['offers.hasMerchantReturnPolicy', has(offers?.hasMerchantReturnPolicy)],
        ];
        const missing = recommended.filter(([, ok]) => !ok).map(([k]) => k);
        properties.recommended = `${recommended.length - missing.length}/${recommended.length} recommended fields${missing.length ? ` (missing ${missing.join(', ')})` : ''}`;
        if (missing.length > 0) issues.push(`Product missing recommended: ${missing.join(', ')}`);
      }
      if (type === 'BreadcrumbList') {
        const els = Array.isArray(json.itemListElement) ? json.itemListElement : json.itemListElement ? [json.itemListElement] : [];
        if (json.itemListElement) properties.items = String(els.length);
        const noItem = els.filter((e: any) => e && typeof e === 'object' && !e.item && !e['@id']).length;
        // The last crumb may legitimately omit `item` (current page); anything else must link.
        if (noItem > 1) issues.push(`${noItem} BreadcrumbList item(s) without item URL`);
      }
      if (type === 'Organization' || type === 'LocalBusiness') {
        if (json.telephone) properties.telephone = String(json.telephone);
        if (json.address) properties.address = typeof json.address === 'object' ? (json.address.streetAddress || 'object') : String(json.address);
      }

      if (!json['@context'] && !json['@id']) issues.push('missing @context');
      if (type === 'Article' && !json.author) issues.push('missing author');
      if (type === 'Article' && !json.datePublished) issues.push('missing datePublished');
      if (type === 'Product' && !json.offers) issues.push('missing offers');
      if (type === 'FAQPage' && !json.mainEntity) issues.push('missing mainEntity');
      if (type === 'HowTo' && !json.step) issues.push('missing step');
      if (type === 'Review' && !json.reviewRating && !json.ratingValue) issues.push('missing rating');

      items.push({ type, properties, issues });
    }

    return { items, blockCount: blocks.length };
  });
}

export function formatSchema(data: SchemaData, opts: { compact?: boolean } = {}): string {
  if (data.items.length === 0) return '## Schema: no JSON-LD found\n';

  const allIssues = data.items.flatMap((i) => i.issues);

  if (opts.compact) {
    const types = data.items.map((i) => i.type).join(', ');
    const issueStr = allIssues.length > 0 ? ` | ${allIssues.length} issues` : '';
    const lines = [`## Schema (${data.items.length}): ${types}${issueStr}`];
    for (const item of data.items) {
      if (item.properties.recommended) lines.push(`- ${item.type}: ${item.properties.recommended}`);
    }
    for (const issue of allIssues) {
      if (!issue.startsWith('Product missing recommended')) lines.push(`- ⚠️ ${issue}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const lines = ['## JSON-LD Schema\n'];
  lines.push(`**${data.blockCount} block(s), ${data.items.length} item(s)**\n`);

  for (const item of data.items) {
    lines.push(`### ${item.type}\n`);
    if (Object.keys(item.properties).length > 0) {
      for (const [key, val] of Object.entries(item.properties)) {
        lines.push(`- **${key}:** ${val}`);
      }
    }
    if (item.issues.length > 0) {
      lines.push('');
      for (const issue of item.issues) {
        lines.push(`- ⚠️ ${issue}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
