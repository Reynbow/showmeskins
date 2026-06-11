import { useEffect, useId, useMemo, useRef } from 'react';
import './AmbientBackground.css';

// Seeded once per page load so the lattice/dust layout is stable across re-renders.
const BG_SEED = Date.now() >>> 0;

/** mulberry32 — tiny deterministic PRNG, keeps the useMemo pure. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIEW_W = 1920;
const VIEW_H = 1080;
const HEX_R = 40;
const DUST_COUNT = 42;
const BLOOM_CYCLE_MS = 4800;
const BLOOM_BLUR = 4;
const BLOOM_OPACITY_MIN = 0.28;
const BLOOM_OPACITY_MAX = 1;
const BLOOM_BRIGHTNESS_MIN = 1;
const BLOOM_BRIGHTNESS_MAX = 1.6;
const SHARP_OPACITY_MIN = 0.7;
const SHARP_OPACITY_MAX = 1;

/** Smooth 0–1 sine wave for a gentle breathing pulse. */
function bloomWaveAt(phase: number): number {
  return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

function brightnessMatrix(scale: number): string {
  return `${scale} 0 0 0 0  0 ${scale} 0 0 0  0 0 ${scale} 0 0  0 0 0 1 0`;
}

interface Hex {
  points: string;
  opacity: number;
  strokeWidth: number;
}

interface Mote {
  left: number;
  size: number;
  duration: number;
  delay: number;
  peakOpacity: number;
}

interface Props {
  /** Pin to the viewport instead of the nearest positioned ancestor — for pages that scroll at the page level. */
  fixed?: boolean;
}

/** Ambient page backdrop: faint hextech lattice with a soft bloom pulse, sparse ember dust. */
export function AmbientBackground({ fixed = false }: Props) {
  const filterId = useId().replace(/:/g, '');
  const bloomGroupRef = useRef<SVGGElement>(null);
  const sharpGroupRef = useRef<SVGGElement>(null);
  const bloomBrightnessRef = useRef<SVGFEColorMatrixElement>(null);

  useEffect(() => {
    const bloomGroup = bloomGroupRef.current;
    const sharpGroup = sharpGroupRef.current;
    const brightnessEl = bloomBrightnessRef.current;
    if (!bloomGroup || !sharpGroup || !brightnessEl) return;

    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const phase = ((now - start) % BLOOM_CYCLE_MS) / BLOOM_CYCLE_MS;
      const wave = bloomWaveAt(phase);

      bloomGroup.style.opacity = String(lerp(BLOOM_OPACITY_MIN, BLOOM_OPACITY_MAX, wave));
      sharpGroup.style.opacity = String(lerp(SHARP_OPACITY_MIN, SHARP_OPACITY_MAX, wave));
      brightnessEl.setAttribute(
        'values',
        brightnessMatrix(lerp(BLOOM_BRIGHTNESS_MIN, BLOOM_BRIGHTNESS_MAX, wave)),
      );

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const hexes = useMemo<Hex[]>(() => {
    const rand = seededRandom(BG_SEED);
    const dx = HEX_R * 1.5;
    const dy = Math.sqrt(3) * HEX_R;
    const result: Hex[] = [];
    for (let col = -1; col * dx < VIEW_W + HEX_R; col++) {
      for (let row = -1; row * dy < VIEW_H + dy; row++) {
        const cx = col * dx;
        const cy = row * dy + (col % 2 ? dy / 2 : 0);
        const points: string[] = [];
        for (let k = 0; k < 6; k++) {
          const angle = (Math.PI / 3) * k;
          points.push(`${(cx + HEX_R * Math.cos(angle)).toFixed(1)},${(cy + HEX_R * Math.sin(angle)).toFixed(1)}`);
        }
        const roll = rand();
        const highlighted = roll > 0.88;
        result.push({
          points: points.join(' '),
          opacity: highlighted
            ? 0.11 + rand() * 0.07
            : 0.03 + rand() * 0.07,
          strokeWidth: highlighted ? 1.15 + rand() * 0.35 : 0.8 + rand() * 0.55,
        });
      }
    }
    return result;
  }, []);

  const motes = useMemo<Mote[]>(() => {
    const rand = seededRandom(BG_SEED + 1);
    return Array.from({ length: DUST_COUNT }, () => ({
      left: rand() * 100,
      size: 1.2 + rand() * 2.5,
      duration: 11 + rand() * 15,
      delay: rand() * 22,
      peakOpacity: 0.4 + rand() * 0.28,
    }));
  }, []);

  return (
    <div className={`ambient-bg${fixed ? ' ambient-bg--fixed' : ''}`} aria-hidden="true">
      <svg
        className="ambient-bg-hex"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={BLOOM_BLUR} result="blur" />
            <feColorMatrix
              ref={bloomBrightnessRef}
              in="blur"
              type="matrix"
              values={brightnessMatrix(BLOOM_BRIGHTNESS_MIN)}
              result="bright"
            />
            <feMerge>
              <feMergeNode in="bright" />
            </feMerge>
          </filter>
        </defs>
        <g ref={bloomGroupRef} className="ambient-bg-hex-bloom" filter={`url(#${filterId})`}>
          {hexes.map((hex, i) => (
            <polygon
              key={`bloom-${i}`}
              points={hex.points}
              fill="none"
              stroke="#c8aa6e"
              strokeWidth={hex.strokeWidth + 2}
              strokeOpacity={hex.opacity * 1.05}
            />
          ))}
        </g>
        <g ref={sharpGroupRef} className="ambient-bg-hex-sharp">
          {hexes.map((hex, i) => (
            <polygon
              key={`sharp-${i}`}
              points={hex.points}
              fill="none"
              stroke="#c8aa6e"
              strokeWidth={hex.strokeWidth}
              strokeOpacity={hex.opacity}
            />
          ))}
        </g>
      </svg>
      <div className="ambient-bg-dust">
        {motes.map((mote, i) => (
          <span
            key={i}
            style={{
              left: `${mote.left.toFixed(1)}%`,
              width: `${mote.size.toFixed(1)}px`,
              height: `${mote.size.toFixed(1)}px`,
              animationDuration: `${mote.duration.toFixed(1)}s`,
              animationDelay: `-${mote.delay.toFixed(1)}s`,
              ['--mote-peak' as string]: mote.peakOpacity.toFixed(2),
            }}
          />
        ))}
      </div>
    </div>
  );
}
