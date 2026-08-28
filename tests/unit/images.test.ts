import { describe, it, expect } from 'vitest';
import { formatImages, type ImageAuditData } from '../../src/images.js';

const sampleData: ImageAuditData = {
  images: [
    { src: 'hero.jpg', name: 'hero.jpg', renderedWidth: 300, renderedHeight: 200, naturalWidth: 2000, naturalHeight: 1333, format: 'JPEG', transferSize: 50000, loading: 'lazy', aboveFold: true, oversized: true, missingDimensions: false, isNextImage: false, isSvg: false },
    { src: 'icon.svg', name: 'icon.svg', renderedWidth: 24, renderedHeight: 24, naturalWidth: 24, naturalHeight: 24, format: 'SVG', transferSize: 1000, loading: 'auto', aboveFold: true, oversized: false, missingDimensions: false, isNextImage: false, isSvg: true },
    { src: 'footer.png', name: 'footer.png', renderedWidth: 100, renderedHeight: 50, naturalWidth: 100, naturalHeight: 50, format: 'PNG', transferSize: 5000, loading: 'eager', aboveFold: false, oversized: false, missingDimensions: true, isNextImage: false, isSvg: false },
  ],
  totalCount: 3,
  totalTransferSize: 56000,
  issues: [
    { severity: 'high', message: '1 above-fold image(s) are lazy-loaded (should be eager/priority)' },
    { severity: 'high', message: '1 image(s) served larger than rendered (>2x)' },
    { severity: 'medium', message: '1 below-fold image(s) are eager-loaded (could be lazy)' },
  ],
};

describe('formatImages', () => {
  it('shows empty message when no images', () => {
    const result = formatImages({ images: [], totalCount: 0, totalTransferSize: 0, issues: [] });
    expect(result).toContain('No images found');
  });

  it('compact mode shows summary with issues', () => {
    const result = formatImages(sampleData, { compact: true });
    expect(result).toContain('3 images');
    expect(result).toContain('critical');
  });

  it('verbose mode shows table and issues', () => {
    const result = formatImages(sampleData);
    expect(result).toContain('Image Audit');
    expect(result).toContain('hero.jpg');
    expect(result).toContain('oversized');
    expect(result).toContain('lazy above fold');
    expect(result).toContain('Issues');
  });

  it('marks above/below fold', () => {
    const result = formatImages(sampleData);
    expect(result).toContain('↑');
    expect(result).toContain('↓');
  });
});
