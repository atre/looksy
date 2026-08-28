import { screenshot } from './screenshot.js';
import { diffInline } from './diff-inline.js';
import { connectOrLaunch } from './server.js';

/**
 * Screenshot two URLs and produce a side-by-side diff comparison.
 */
export async function compareUrls(
  url1: string,
  url2: string,
  outputBase: string,
  viewport: { width: number; height: number },
): Promise<{ diffPath: string; changedPixels: number; totalPixels: number; changePercent: string }> {
  const baseName = outputBase.replace(/\.(png|jpg|jpeg)$/, '');
  const path1 = `${baseName}-left.png`;
  const path2 = `${baseName}-right.png`;
  const diffPath = `${baseName}-compare.png`;

  const { browser, owned } = await connectOrLaunch();

  try {
    // Screenshot both URLs in parallel with shared browser
    const [result1, result2] = await Promise.all([
      screenshot({ url: url1, output: path1, ...viewport, fullPage: false, darkMode: false, browser }),
      screenshot({ url: url2, output: path2, ...viewport, fullPage: false, darkMode: false, browser }),
    ]);

    return await diffInline(result1.imagePath, result2.imagePath, diffPath);
  } finally {
    await browser.close();
  }
}
