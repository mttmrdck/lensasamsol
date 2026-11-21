import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

export function useElementWidth(ref: RefObject<HTMLElement | null>, enabled = true): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!enabled) {
      setWidth(0);
      return;
    }
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, enabled]);
  return width;
}

/**
 * Visible vertical window of `target`, in target-local pixels, against either the window or a custom
 * scroll container (the editor canvas). Quantised to 120px steps so scrolling doesn't re-render every frame.
 */
export function useVisibleWindow(
  target: RefObject<HTMLElement | null>,
  scrollRoot: RefObject<HTMLElement | null> | undefined,
): { top: number; bottom: number } {
  const [win, setWin] = useState({ top: 0, bottom: 1600 });
  useEffect(() => {
    const root = scrollRoot?.current ?? null;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = target.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rootTop = root ? root.getBoundingClientRect().top : 0;
      const rootH = root ? root.clientHeight : window.innerHeight;
      const q = 120;
      const top = Math.floor((rootTop - rect.top) / q) * q;
      const bottom = Math.ceil((rootTop - rect.top + rootH) / q) * q;
      setWin((w) => (w.top === top && w.bottom === bottom ? w : { top, bottom }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const scroller: HTMLElement | Window = root ?? window;
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    if (target.current) ro.observe(target.current);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target, scrollRoot]);
  return win;
}
