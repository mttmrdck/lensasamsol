import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  BLADES,
  TIMELINE,
  anchorFromRect,
  bladePaths,
  fullRevealApothem,
  irisFrame,
  surfaceWithHole,
  clamp01,
  easeInOutCubic,
} from './iris';

interface Props {
  /** 'closed': lens shown, waiting for the cover image. 'open': run the opening. */
  phase: 'closed' | 'open' | 'hold';
  /** Called once, when the reveal passes ~80% (title entrance should start). */
  onReveal: () => void;
  /** Called once when the opening has completed (or was skipped). */
  onDone: () => void;
}

const SURFACE = '#0E0E0D';

/** Focal point of the real cover image in the gallery underneath (null when not rendered yet). */
function readCover(): { rect: DOMRect; focal: { x: number; y: number } } | null {
  const img = document.querySelector<HTMLImageElement>('.g-root[data-mode="public"] .g-hero-img');
  if (!img) return null;
  const [px, py] = getComputedStyle(img).objectPosition.split(' ');
  const pct = (v: string | undefined) => (v && v.endsWith('%') ? parseFloat(v) / 100 : 0.5);
  return { rect: img.getBoundingClientRect(), focal: { x: pct(px), y: pct(py) } };
}

/**
 * Full-viewport camera-iris overlay for the client gallery entrance. The real gallery is rendered underneath;
 * this overlay is a dark surface with a hexagonal hole cut out (even-odd path — no SVG masks, which keeps
 * Safari reliable) plus six blade paths. Geometry is updated per frame by writing `d` attributes directly:
 * no React renders during the animation.
 */
export function IrisIntro({ phase, onReveal, onDone }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const surfaceRef = useRef<SVGPathElement>(null);
  const bladeRefs = useRef<Array<SVGPathElement | null>>([]);
  const ringRef = useRef<SVGCircleElement>(null);
  const gradRef = useRef<SVGRadialGradientElement>(null);
  const lensGroupRef = useRef<SVGGElement>(null);
  const clipRef = useRef<SVGCircleElement>(null);
  const cbs = useRef({ onReveal, onDone });
  cbs.current = { onReveal, onDone };
  const appearedAt = useRef<number>(performance.now());
  const anchor = useRef<{ key: string; x: number; y: number } | null>(null);

  // Draw one frame for elapsed time t (ms) against the current viewport.
  const draw = (t: number, appearT: number) => {
    const svg = svgRef.current;
    if (!svg) return { done: false, revealProgress: 0 };
    const w = window.innerWidth;
    const h = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const lens = Math.max(96, Math.min(180, Math.min(w, h) * 0.24));
    // Anchor is measured once per viewport size, so the lens never drifts mid-animation.
    const key = `${w}x${h}`;
    if (anchor.current?.key !== key) {
      const cover = readCover();
      anchor.current = { key, ...anchorFromRect(cover?.rect ?? null, cover?.focal ?? null, w, h, lens) };
    }
    // The lens appears centred, then glides to the cover's focal point as the blades open (eased with
    // the opening itself, so position and aperture read as one mechanical movement).
    const glide = easeInOutCubic(clamp01((t - TIMELINE.openStart) / (TIMELINE.openEnd - TIMELINE.openStart)));
    const cx = w / 2 + (anchor.current.x - w / 2) * glide;
    const cy = h / 2 + (anchor.current.y - h / 2) * glide;
    const fr = irisFrame(t, lens, fullRevealApothem(w, h, cx, cy));
    const appear = irisFrame(appearT, lens, 1).appear;
    const reach = Math.hypot(w, h) * 2 + fr.lensR;
    surfaceRef.current?.setAttribute('d', surfaceWithHole(w, h, cx, cy, fr.apothem, fr.theta));
    bladePaths(cx, cy, fr.apothem, fr.theta, reach).forEach((d, k) =>
      bladeRefs.current[k]?.setAttribute('d', d),
    );
    clipRef.current?.setAttribute('r', String(fr.lensR));
    clipRef.current?.setAttribute('cx', String(cx));
    clipRef.current?.setAttribute('cy', String(cy));
    ringRef.current?.setAttribute('r', String(fr.lensR + Math.max(3, lens * 0.035)));
    ringRef.current?.setAttribute('cx', String(cx));
    ringRef.current?.setAttribute('cy', String(cy));
    gradRef.current?.setAttribute('cx', String(cx - fr.lensR * 0.35));
    gradRef.current?.setAttribute('cy', String(cy - fr.lensR * 0.45));
    gradRef.current?.setAttribute('r', String(fr.lensR * 1.6));
    if (lensGroupRef.current) {
      lensGroupRef.current.style.opacity = String(appear);
      // A whisper of settle while the lens appears (1.5% scale), never a dramatic zoom.
      lensGroupRef.current.style.transformOrigin = `${cx}px ${cy}px`;
      lensGroupRef.current.style.transform = `scale(${0.985 + 0.015 * appear})`;
    }
    return fr;
  };

  // Closed pose + appear animation (also handles resize while waiting).
  useLayoutEffect(() => {
    // 'hold' (skip/fallback fade): keep the current frame exactly as it is.
    if (phase !== 'closed') return;
    let raf = 0;
    const loop = () => {
      const appearT = performance.now() - appearedAt.current;
      draw(0, appearT);
      if (phase === 'closed' && appearT < TIMELINE.appearEnd + 50) raf = requestAnimationFrame(loop);
    };
    loop();
    const onResize = () => phase === 'closed' && draw(0, TIMELINE.appearEnd);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [phase]);

  // The opening itself. If the lens already finished appearing we start at phase B; otherwise phase A
  // simply continues into B, so there is never a jump.
  useEffect(() => {
    if (phase !== 'open') return;
    let raf = 0;
    let revealed = false;
    const base = Math.min(performance.now() - appearedAt.current, TIMELINE.openStart);
    const t0 = performance.now();
    // Test-only knob to slow the choreography for frame capture (defaults to real time).
    const speed = (window as unknown as { __LSG_INTRO_SPEED__?: number }).__LSG_INTRO_SPEED__ ?? 1;
    const tick = () => {
      const t = base + (performance.now() - t0) * speed;
      const fr = draw(t, t);
      if (!revealed && fr.revealProgress >= 0.55) {
        revealed = true;
        cbs.current.onReveal();
      }
      if (fr.done) {
        cbs.current.onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none fixed inset-0 z-[80] h-[100dvh] w-screen"
      aria-hidden="true"
      data-testid="iris-intro"
      data-phase={phase}
      preserveAspectRatio="none"
    >
      <defs>
        <clipPath id="lsg-lens">
          <circle ref={clipRef} />
        </clipPath>
        {/* Light falloff from the upper left gives the blades a machined, satin-metal read. */}
        <radialGradient id="lsg-blade" ref={gradRef} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3A3934" />
          <stop offset="0.55" stopColor="#2A2926" />
          <stop offset="1" stopColor="#1B1B19" />
        </radialGradient>
      </defs>
      <path ref={surfaceRef} fill={SURFACE} fillRule="evenodd" />
      <g ref={lensGroupRef} style={{ transformBox: 'view-box' }}>
        <g clipPath="url(#lsg-lens)">
          {Array.from({ length: BLADES }, (_, k) => (
            <path
              key={k}
              ref={(el) => {
                bladeRefs.current[k] = el;
              }}
              fill="url(#lsg-blade)"
              stroke={SURFACE}
              strokeWidth={2.25}
              strokeLinejoin="miter"
            />
          ))}
        </g>
        <circle ref={ringRef} fill="none" stroke="#2E2D29" strokeWidth={1.25} />
      </g>
    </svg>
  );
}
