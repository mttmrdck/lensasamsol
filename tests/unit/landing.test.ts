import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoverHero } from '../../src/components/gallery/CoverHero';
import { DEFAULT_STYLE, type StyleConfig } from '../../shared/style';
import type { PublicCollection } from '../../shared/api';

function render(showDescription: boolean, subtitle: string) {
  const style: StyleConfig = {
    ...DEFAULT_STYLE,
    cover: { ...DEFAULT_STYLE.cover, showDescription },
    composition: { template: 'editorial-signature', subtitle },
  };
  const collection: PublicCollection = {
    id: 'gallery',
    title: 'A quiet afternoon',
    description: 'The complete public description.',
    eventDate: null,
    location: null,
    source: 'demo',
    coverPhotoId: null,
    cover: null,
    photoCount: 0,
    folderUrl: null,
    folderAccess: 'unknown',
    style,
  };
  return renderToStaticMarkup(
    createElement(CoverHero, {
      collection,
      cover: null,
      studio: { name: 'Studio', intro: null, contactUrl: null, contactLabel: null },
      style,
      count: 0,
    }),
  );
}
describe('static landing introduction content', () => {
  it('preserves an enabled public description alongside a custom subtitle', () => {
    const html = render(true, 'A portrait study.');
    expect(html).toContain('A portrait study.');
    expect(html).toContain('The complete public description.');
  });
  it('respects the description visibility control without hiding the subtitle', () => {
    const html = render(false, 'A portrait study.');
    expect(html).toContain('A portrait study.');
    expect(html).not.toContain('The complete public description.');
  });
});
