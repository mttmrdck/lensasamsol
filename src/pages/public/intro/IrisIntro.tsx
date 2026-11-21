import { useLayoutEffect, useRef } from 'react';
import { BLADES, TIMELINE, bladePaths, fullRevealApothem, irisFrame, surfaceWithHole } from './iris';

interface Props {
  phase: 'closed' | 'open' | 'hold';
  onReveal: () => void;
  onDone: () => void;
}

/** Viewport-sized diaphragm. DOM path updates avoid React work on animation frames. */
export function IrisIntro({ phase, onReveal, onDone }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const surfaceRef = useRef<SVGPathElement>(null);
  const bladeRefs = useRef<Array<SVGPathElement | null>>([]);
  const elapsed = useRef(0);
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let raf = 0;
    let revealed = false;
    let finished = false;
    const start = performance.now();
    // Local capture hook is unavailable in release builds.
    const speed = import.meta.env.DEV
      ? Math.max(0, (window as unknown as { __LSG_INTRO_SPEED__?: number }).__LSG_INTRO_SPEED__ ?? 1)
      : 1;
    let width = 1, height = 1, cx = 0, cy = 0;
    const draw = () => {
      const fr = irisFrame(elapsed.current, 0, fullRevealApothem(width, height, cx, cy));
      surfaceRef.current?.setAttribute('d', surfaceWithHole(width, height, cx, cy, fr.apothem, fr.theta));
      // A microscopic construction radius keeps blade directions defined in the fully closed pose.
      bladePaths(cx, cy, Math.max(0.01, fr.apothem), fr.theta, Math.hypot(width, height) * 4)
        .forEach((path, i) => bladeRefs.current[i]?.setAttribute('d', path));
      svg.dataset.progress = String(fr.revealProgress);
      svg.dataset.center = `${cx},${cy}`;
      if (phase === 'open' && !revealed && fr.revealProgress >= 0.55) {
        revealed = true; callbacks.current.onReveal();
      }
      if (phase === 'open' && fr.done && !finished) {
        finished = true; callbacks.current.onDone();
      }
    };
    const measure = () => {
      // Cover the layout viewport, while centering within its currently visible portion.
      // Unlike 100dvh, inset anchoring does not leave a strip during toolbar resizing.
      const box = svg.getBoundingClientRect();
      width = box.width; height = box.height;
      const vv = window.visualViewport;
      cx = vv ? vv.offsetLeft + vv.width / 2 - box.left : width / 2;
      cy = vv ? vv.offsetTop + vv.height / 2 - box.top : height / 2;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      draw();
    };
    if (phase === 'closed') elapsed.current = 0;
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(svg);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    const tick = () => {
      const captureTime = import.meta.env.DEV
        ? (window as unknown as { __LSG_INTRO_TIME__?: number }).__LSG_INTRO_TIME__ : undefined;
      elapsed.current = captureTime ?? (performance.now() - start) * speed;
      draw();
      if (!finished) raf = requestAnimationFrame(tick);
    };
    if (phase === 'open') raf = requestAnimationFrame(tick);
    // A paused/lost animation frame must never hold the page indefinitely.
    const safety = phase === 'open' ? window.setTimeout(() => {
      if (!finished) { finished = true; callbacks.current.onDone(); }
    }, TIMELINE.revealEnd + 900) : undefined;
    return () => {
      cancelAnimationFrame(raf); clearTimeout(safety); resize.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [phase]);

  return (
    <svg ref={svgRef} className="g-iris" aria-hidden="true" data-testid="iris-intro"
      data-phase={phase} preserveAspectRatio="none">
      <path ref={surfaceRef} fill="#161715" fillRule="evenodd" />
      {Array.from({ length: BLADES }, (_, i) => (
        <path key={i} ref={el => { bladeRefs.current[i] = el; }}
          fill={['#20211e', '#242520', '#292a25', '#242520', '#20211e', '#1c1d1a'][i]}
          stroke="#161715" strokeWidth="0.6" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
