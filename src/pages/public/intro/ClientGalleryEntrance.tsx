import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { IrisIntro } from './IrisIntro';
import type { EntranceState } from './useGalleryEntrance';

interface Props {
  state: EntranceState;
  onReveal: () => void;
  onOpened: () => void;
  onFaded: () => void;
}

/**
 * The client-gallery entrance overlay. Rendered only by the public /g/:token route — never by the shared
 * GalleryRenderer, the editor preview, the client preview or any admin page.
 */
export function ClientGalleryEntrance({ state, onReveal, onOpened, onFaded }: Props) {
  const fadeRef = useRef<HTMLDivElement>(null);

  // Fallback / Escape path: a short opacity fade, then unmount (transitionend, with a safety net).
  useEffect(() => {
    if (state !== 'fading') return;
    const el = fadeRef.current;
    if (!el) return onFaded();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onFaded();
    };
    const frame = requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    el.addEventListener('transitionend', finish, { once: true });
    const safety = window.setTimeout(finish, 450);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('transitionend', finish);
      window.clearTimeout(safety);
    };
  }, [state, onFaded]);

  if (state === 'off' || state === 'done') return null;

  return createPortal(
    <div
      ref={fadeRef}
      className="g-entrance"
      data-testid="client-entrance"
      data-state={state}
    >
      {state === 'pending' ? (
        // Gallery data still loading: just the dark surface (no aperture for links that may turn out invalid).
        <div className="absolute inset-0 bg-[#0E0E0D]" aria-hidden="true" />
      ) : (
        <IrisIntro
          phase={state === 'opening' ? 'open' : state === 'fading' ? 'hold' : 'closed'}
          onReveal={onReveal}
          onDone={onOpened}
        />
      )}
    </div>, document.body,
  );
}
