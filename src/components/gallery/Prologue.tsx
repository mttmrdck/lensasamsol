import type { RefObject } from 'react';
import { PhotoGrid } from './PhotoGrid';
import type { StyleConfig } from '../../../shared/style';
import { useImages } from './images';
import { ArrowDown } from 'lucide-react';
import type { PublicPhoto } from '../../../shared/api';
import { plural } from '../../lib/format';

interface Props {
  featured: Array<{ photo: PublicPhoto; index: number }>;
  heading: string;
  total: number;
  hrefFor: (p: PublicPhoto) => string;
  onOpen: (index: number) => void;
  onSkip: () => void;
  styleConfig?: StyleConfig;
  scrollRoot?: RefObject<HTMLElement | null>;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * The curated opening sequence: a handful of admin-chosen frames presented as exhibition plates
 * between the cover and the full contact sheet. Never a slideshow — it scrolls natively, and the
 * full gallery is always one action away.
 */
export function Prologue({
  featured,
  heading,
  total,
  hrefFor,
  onOpen,
  onSkip,
  styleConfig,
  scrollRoot,
}: Props) {
  if (styleConfig?.composition) {
    return (
      <section aria-label={heading} className="g-wrap pt-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--g-line)] pb-3">
          <h2 className="g-display text-[28px]">{heading}</h2>
          <button type="button" onClick={onSkip} className="g-secondary min-h-11 text-[14px]">
            Skip to all {plural(total, 'photograph')}
          </button>
        </div>
        <PhotoGrid
          selection
          scrollRoot={scrollRoot}
          photos={featured.map((f) => f.photo)}
          style={{
            ...styleConfig,
            composition: { ...styleConfig.composition, template: 'compact-exhibition' },
            layout: { ...styleConfig.layout, rowHeight: 240 },
          }}
          hrefFor={hrefFor}
          onOpen={(i) => onOpen(featured[i].index)}
        />
      </section>
    );
  }
  // Rhythm: landscapes stand alone as wide plates; consecutive portraits are hung as an offset pair.
  const groups: Array<typeof featured> = [];
  for (let k = 0; k < featured.length;) {
    const a = featured[k];
    const b = featured[k + 1];
    const portrait = (p: PublicPhoto) => p.h > p.w;
    if (portrait(a.photo) && b && portrait(b.photo)) {
      groups.push([a, b]);
      k += 2;
    } else {
      groups.push([a]);
      k += 1;
    }
  }
  let plate = 0;
  return (
    <section aria-label={heading} className="g-wrap pb-6 pt-16 sm:pt-24">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-[var(--g-line)] pb-4 sm:mb-16">
        <h2 className="g-display text-[30px] sm:text-[40px]">{heading}</h2>
        <button
          type="button"
          onClick={onSkip}
          className="g-secondary flex min-h-11 items-center gap-2 text-[14px] hover:text-[var(--g-fg)]"
        >
          Skip to all {plural(total, 'photograph')}
          <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-16 sm:gap-28">
        {groups.map((g) => {
          if (g.length === 1) {
            const { photo, index } = g[0];
            const landscape = photo.w >= photo.h;
            const n = plate++;
            const align = 'mx-auto';
            return (
              <Figure
                key={photo.id}
                photo={photo}
                index={index}
                plate={n}
                href={hrefFor(photo)}
                onOpen={onOpen}
                className={`${align} ${landscape ? 'w-full' : 'w-full @[640px]:w-[44%]'}`}
              />
            );
          }
          return (
            <div
              key={g[0].photo.id}
              className="grid grid-cols-1 items-start gap-16 @[640px]:grid-cols-2 @[640px]:gap-[6%]"
            >
              {g.map(({ photo, index }, k) => (
                <Figure
                  key={photo.id}
                  photo={photo}
                  index={index}
                  plate={plate++}
                  href={hrefFor(photo)}
                  onOpen={onOpen}
                  className={k === 1 ? 'w-full @[640px]:mt-[18%] @[640px]:justify-self-end' : 'w-full'}
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Figure({
  photo,
  index,
  plate,
  href,
  onOpen,
  className,
}: {
  photo: PublicPhoto;
  index: number;
  plate: number;
  href: string;
  onOpen: (i: number) => void;
  className: string;
}) {
  const { imgUrl, srcSet } = useImages();
  return (
    <figure
      className={`g-prologue-figure ${className}`}
      // Never taller than ~78% of the viewport, whatever the orientation.
      style={{ maxWidth: `min(100%, calc(var(--g-vh) * 78 * ${(photo.w / photo.h).toFixed(4)}))` }}
    >
      <a
        href={href}
        className="block focus-visible:outline-offset-4"
        aria-label={`Plate ${ROMAN[plate] ?? plate + 1}: view photograph ${index + 1}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          onOpen(index);
        }}
      >
        <img
          className="g-prologue-img"
          src={imgUrl(photo.id, 'l')}
          srcSet={srcSet(photo.id, photo.w, photo.h)}
          sizes="(min-width: 1280px) 1180px, 100vw"
          width={photo.w}
          height={photo.h}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ aspectRatio: `${photo.w} / ${photo.h}` }}
        />
      </a>
      <figcaption className="g-muted tnum mt-3 text-[12px]">Plate {ROMAN[plate] ?? plate + 1}</figcaption>
    </figure>
  );
}
