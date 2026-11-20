import { useEffect, useRef } from 'react';
import { IrisIntro } from './IrisIntro';
import type { EntranceState } from './useGalleryEntrance';

interface Props {
  state: EntranceState;
  onReveal: () => void;
  onOpened: () => void;
  onFaded: () => void;
  onSkip: () => void;
}

/**
 * The client-gallery entrance overlay. Rendered only by the public /g/:token route — never by the shared
 * GalleryRenderer, the editor preview, the client preview or any admin page.
 */
export function ClientGalleryEntrance({ state, onReveal, onOpened, onFaded, onSkip }: Props) {
  const fadeRef = useRef<HTMLDivElement>(null);

  // Fallback / skip path: a short opacity fade, then unmount (transitionend, with a safety net).
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
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    el.addEventListener('transitionend', finish, { once: true });
    const safety = window.setTimeout(finish, 450);
    return () => {
      el.removeEventListener('transitionend', finish);
      window.clearTimeout(safety);
    };
  }, [state, onFaded]);

  if (state === 'off' || state === 'done') return null;

  return (
    <div
      ref={fadeRef}
      className="fixed inset-0 z-[80] transition-opacity duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
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
      {(state === 'closed' || state === 'opening') && (
        <button
          type="button"
          onClick={onSkip}
          className="absolute bottom-[max(20px,env(safe-area-inset-bottom))] left-1/2 z-[81] min-h-11 -translate-x-1/2 rounded-full px-4 text-[12px] tracking-[0.01em] text-white/55 transition-colors hover:text-white/90 focus-visible:text-white focus-visible:outline-1 focus-visible:outline-white/60"
        >
          Skip intro
        </button>
      )}
    </div>
  );
}
