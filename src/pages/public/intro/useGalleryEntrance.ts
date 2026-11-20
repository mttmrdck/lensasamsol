import { useCallback, useEffect, useRef, useState } from 'react';
import type { GalleryResponse } from '../../../../shared/api';
import { imgUrl, srcSet } from '../../../lib/format';

/**
 * Entrance state machine for the PUBLIC client gallery route only.
 *
 *   off      — not eligible (deep link, reduced motion, already seen this session, no cover…)
 *   pending  — eligible so far; gallery data still loading (a plain dark surface, no aperture yet)
 *   closed   — gallery valid; lens visible at its closed pose while the cover image decodes (bounded wait)
 *   opening  — the iris is opening over the real gallery
 *   fading   — fallback: cover too slow/failed or visitor skipped; overlay fades out quickly
 *   done     — overlay gone, gallery fully interactive
 */
export type EntranceState = 'off' | 'pending' | 'closed' | 'opening' | 'fading' | 'done';

const COVER_WAIT_MS = 1600;

/** Non-reversible session key: FNV-1a of the token, so the raw link never sits in storage. */
function sessionKey(token: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `lsg-intro:${(h >>> 0).toString(36)}`;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function initiallyEligible(token: string, hasPhotoParam: boolean) {
  if (typeof window === 'undefined' || hasPhotoParam) return false;
  if ((window as unknown as { __LSG_NO_INTRO__?: boolean }).__LSG_NO_INTRO__) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    return storage()?.getItem(sessionKey(token)) !== '1';
  } catch {
    return true;
  }
}

export function useGalleryEntrance(
  token: string,
  hasPhotoParam: boolean,
  data: GalleryResponse | undefined,
  failed: boolean,
) {
  // Decided once from the URL the visitor arrived with; later ?photo= changes never re-trigger it.
  const [state, setState] = useState<EntranceState>(() =>
    initiallyEligible(token, hasPhotoParam) ? 'pending' : 'off',
  );
  const [titlesIn, setTitlesIn] = useState(false);
  const started = useRef(false);

  const markSeen = useCallback(() => {
    try {
      storage()?.setItem(sessionKey(token), '1');
    } catch {
      /* storage unavailable: the intro may replay, which is harmless */
    }
  }, [token]);

  // Invalid / revoked / unpublished links: drop the intro immediately so Not Found shows promptly.
  useEffect(() => {
    if (failed && state === 'pending') setState('off');
  }, [failed, state]);

  // Data arrived: decide, then wait (bounded) for the cover to be decoded before opening.
  useEffect(() => {
    if (state !== 'pending' || !data || started.current) return;
    started.current = true;
    const cover = data.collection.cover;
    const style = data.collection.style.cover.style;
    if (!cover || style === 'typographic' || data.photos.length === 0) {
      setState('off');
      return;
    }
    setState('closed');
    // Same src/srcset/sizes as the hero image, so the browser fetches and decodes the cover only once.
    const img = new Image();
    img.decoding = 'async';
    img.sizes = '100vw';
    img.srcset = srcSet(cover.id, cover.w, cover.h, token);
    img.src = imgUrl(cover.id, 'l', token);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setState((s) => (s === 'closed' ? 'fading' : s)); // slow cover: don't hold the visitor behind the lens
    }, COVER_WAIT_MS);
    img
      .decode()
      .then(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        markSeen();
        setState((s) => (s === 'closed' ? 'opening' : s));
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setState((s) => (s === 'closed' ? 'fading' : s)); // broken cover: fall back to the gallery's own placeholder state
      });
    return () => {
      // Unmount/route change mid-wait: stop waiting. (StrictMode re-runs are guarded by `started`.)
      window.clearTimeout(timer);
    };
  }, [state, data, token, markSeen]);

  // While the overlay is up: lock page scroll; restore on any exit path.
  const active = state === 'pending' || state === 'closed' || state === 'opening' || state === 'fading';
  useEffect(() => {
    if (!active) return;
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = 'hidden';
    return () => {
      el.style.overflow = prev;
    };
  }, [active]);

  const skip = useCallback(() => {
    markSeen();
    setTitlesIn(true);
    setState((s) => (s === 'done' || s === 'off' ? s : 'fading'));
  }, [markSeen]);

  // Escape skips, like any modal moment.
  useEffect(() => {
    if (state !== 'closed' && state !== 'opening') return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && skip();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [state, skip]);

  return {
    state,
    /** True while the hero title should wait for the reveal. */
    holdTitles: (state === 'closed' || state === 'opening' || state === 'pending') && !titlesIn,
    overlayVisible: active,
    onReveal: () => setTitlesIn(true),
    onOpened: () => setState('done'),
    onFaded: () => setState('done'),
    skip,
  };
}
