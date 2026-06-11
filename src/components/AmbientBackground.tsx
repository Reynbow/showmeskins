import { useMemo } from 'react';
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
const DUST_COUNT = 14;

interface Hex {
  points: string;
  opacity: number;
}

interface Mote {
  left: number;
  size: number;
  duration: number;
  delay: number;
}

interface Props {
  /** Pin to the viewport instead of the nearest positioned ancestor — for pages that scroll at the page level. */
  fixed?: boolean;
}

/** Ambient page backdrop: faint hextech lattice, soft glow wash, sparse ember dust. */
export function AmbientBackground({ fixed = false }: Props) {
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
        result.push({
          points: points.join(' '),
          opacity: 0.05 + rand() * 0.05,
        });
      }
    }
    return result;
  }, []);

  const motes = useMemo<Mote[]>(() => {
    const rand = seededRandom(BG_SEED + 1);
    return Array.from({ length: DUST_COUNT }, () => ({
      left: rand() * 100,
      size: 1 + rand() * 2,
      duration: 16 + rand() * 14,
      delay: rand() * 30,
    }));
  }, []);

  return (
    <div className={`ambient-bg${fixed ? ' ambient-bg--fixed' : ''}`} aria-hidden="true">
      <div className="ambient-bg-glow" />
      <svg
        className="ambient-bg-hex"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        {hexes.map((hex, i) => (
          <polygon
            key={i}
            points={hex.points}
            fill="none"
            stroke="#c8aa6e"
            strokeWidth="1"
            strokeOpacity={hex.opacity}
          />
        ))}
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
            }}
          />
        ))}
      </div>
    </div>
  );
}
