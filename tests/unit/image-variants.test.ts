import { describe, expect, it } from 'vitest';
import {
  containDimensions,
  IMAGE_VARIANTS,
  previewDimensions,
  viewingVariant,
} from '../../shared/image-variants';
import { srcSet } from '../../src/lib/format';

describe('honest bounded image variants', () => {
  it('shares fixed long edges, with portrait width descriptors', () => {
    expect(IMAGE_VARIANTS).toEqual({ s: 480, m: 960, l: 1600, xl: 2560 });
    expect(srcSet('p', 2000, 3000, 'token', 'xl')).toBe(
      '/img/t/token/p/s 320w, /img/t/token/p/m 640w, /img/t/token/p/l 1067w, /img/t/token/p/xl 1707w',
    );
  });
  it('caps to native dimensions and removes duplicate candidates', () => {
    expect(srcSet('p', 600, 400, null, 'xl')).toBe('/img/a/p/s 480w, /img/a/p/m 600w');
    expect(previewDimensions(300, 450, 'xl')).toEqual({ width: 300, height: 450 });
    expect(srcSet('p', 6000, 4000)).not.toContain('/xl');
  });
  it('contains portrait and landscape independently of derivative natural dimensions', () => {
    expect(containDimensions(4000, 6000, 1200, 720)).toEqual({ width: 480, height: 720 });
    expect(containDimensions(6000, 4000, 1200, 720)).toEqual({ width: 1080, height: 720 });
    expect(containDimensions(0, 0, 900, 600)).toEqual({ width: 900, height: 600 });
  });
  it('chooses adjacent preload tiers by fitted long edge and pixel density', () => {
    expect(viewingVariant(4000, 6000, 390, 650, 1)).toBe('m');
    expect(viewingVariant(4000, 6000, 390, 650, 3)).toBe('xl');
    expect(viewingVariant(4000, 6000, 390, 650, 3, 'l')).toBe('l');
    expect(viewingVariant(300, 450, 1200, 900, 3)).toBe('s');
  });
});
