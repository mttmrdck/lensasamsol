import { useRef, useState } from 'react';
import { useElementWidth } from './hooks';
import { naturalAspect } from '../../../shared/composition';
import type { PublicCollection, PublicPhoto, PublicStudio } from '../../../shared/api';
import type { StyleConfig } from '../../../shared/style';
import { formatDate, plural } from '../../lib/format';
import { useImages } from './images';

interface Props {
  collection: PublicCollection;
  cover: PublicPhoto | null;
  studio: PublicStudio;
  style: StyleConfig;
  count: number;
}

/** One static photographic opening, shared verbatim by client links and the editor canvas.
 * Legacy photographic cover styles keep their saved settings but use this exhibition composition.
 * A deliberately selected typography-only cover is still respected.
 */
export function CoverHero({ collection, cover, studio, style, count }: Props) {
  const { imgUrl, srcSet } = useImages();
  const mediaRef = useRef<HTMLDivElement>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const showImage = cover && style.cover.style !== 'typographic';
  const mediaWidth = useElementWidth(mediaRef, !!showImage);
  const aspect = cover ? naturalAspect(cover) : 1.5;
  const customSubtitle = style.composition?.subtitle?.trim();
  const description = style.cover.showDescription ? collection.description : null;
  const subtitle = customSubtitle || description;
  const additionalDescription = customSubtitle && description !== customSubtitle ? description : null;
  const metadata = [
    style.cover.showDate && collection.eventDate ? formatDate(collection.eventDate) : null,
    collection.location,
    style.cover.showCount && count ? plural(count, 'photograph') : null,
  ].filter(Boolean);
  const caption = (
    <div
      className={`g-hero-text g-exhibition-caption ${style.cover.titleAlign === 'center' ? 'g-exhibition-centered' : ''}`}
    >
      <div className="g-exhibition-copy">
        <h1 className="g-display g-exhibition-title">{collection.title}</h1>
        {subtitle && <p className="g-secondary g-exhibition-subtitle">{subtitle}</p>}
        {additionalDescription && (
          <p className="g-secondary g-exhibition-description">{additionalDescription}</p>
        )}
      </div>
      {!!metadata.length && (
        <p className="g-secondary g-exhibition-meta tnum">
          {metadata.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </p>
      )}
    </div>
  );
  return (
    <header
      className="g-wrap g-exhibition"
      data-testid={showImage ? 'featured-hero' : 'typographic-hero'}
      data-cover-style={style.cover.style}
    >
      <div className="g-exhibition-masthead">
        <span className="g-exhibition-wordmark">{studio.name}</span>
      </div>
      {showImage ? (
        <figure
          className={`g-exhibition-plate ${aspect < 0.92 ? 'g-exhibition-portrait' : ''}`}
          style={
            {
              '--g-cover-ar': aspect,
              '--g-cover-limit': Math.min(78, Math.max(56, style.cover.height - 4)),
            } as React.CSSProperties
          }
        >
          <div ref={mediaRef} className="g-exhibition-media">
            {failedId === cover.id ? (
              <div className="absolute inset-0 grid place-items-center g-muted text-sm" role="status">
                Preview unavailable
              </div>
            ) : (
              <img
                className="g-hero-img"
                src={mediaWidth > 0 ? imgUrl(cover.id, 'l') : undefined}
                srcSet={
                  mediaWidth > 0
                    ? srcSet(cover.id, cover.w, cover.h, collection.source === 'demo' ? 'l' : 'xl')
                    : undefined
                }
                sizes={mediaWidth > 0 ? `${mediaWidth}px` : '100vw'}
                onError={() => setFailedId(cover.id)}
                width={cover.w > 0 ? cover.w : 1500}
                height={cover.h > 0 ? cover.h : 1000}
                alt=""
                decoding="async"
                fetchPriority="high"
              />
            )}
          </div>
          <figcaption>{caption}</figcaption>
        </figure>
      ) : (
        <div className="g-exhibition-type-only">{caption}</div>
      )}
    </header>
  );
}
