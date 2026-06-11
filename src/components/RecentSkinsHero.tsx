import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecentSkinSpotlight } from '../api';
import { getSplashArt, getSplashArtFallback } from '../api';
import './RecentSkinsHero.css';

const AUTO_MS = 5500;

interface Props {
  skins: RecentSkinSpotlight[];
  onOpenSkin: (spotlight: RecentSkinSpotlight) => void;
}

export function RecentSkinsHero({ skins, onOpenSkin }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = skins.length;
  const active = count > 0 ? skins[index] : null;

  const goTo = useCallback((next: number) => {
    if (count === 0) return;
    setIndex(((next % count) + count) % count);
  }, [count]);

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (count <= 1 || paused) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTO_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [count, paused]);

  if (!active) return null;

  return (
    <section
      className="recent-skins-hero"
      aria-label="Recently released skins"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="recent-skins-hero-label">Newest skins</div>

      <div className="recent-skins-hero-stage">
        {skins.map((skin, i) => (
          <button
            key={`${skin.championId}-${skin.skinId}`}
            type="button"
            className={`recent-skins-hero-slide${i === index ? ' active' : ''}`}
            aria-hidden={i !== index}
            tabIndex={i === index ? 0 : -1}
            onClick={() => onOpenSkin(skin)}
          >
            <img
              src={skin.splashUrl ?? getSplashArt(skin.championId, skin.skinNum)}
              alt=""
              loading={i <= 1 ? 'eager' : 'lazy'}
              onError={(e) => {
                // Centered splash -> Data Dragon splash -> loading art.
                const img = e.target as HTMLImageElement;
                const ddragonSplash = getSplashArt(skin.championId, skin.skinNum);
                if (skin.splashUrl && img.src === skin.splashUrl) {
                  img.src = ddragonSplash;
                } else if (img.src === ddragonSplash) {
                  img.src = getSplashArtFallback(skin.championId, skin.skinNum);
                }
              }}
            />
            <div className="recent-skins-hero-overlay" />
            <div className="recent-skins-hero-copy">
              <span className="recent-skins-hero-champ">{skin.championName}</span>
              <span className="recent-skins-hero-name">{skin.skinName}</span>
              <span className="recent-skins-hero-cta">View in 3D</span>
            </div>
          </button>
        ))}

        {count > 1 && (
          <>
            <button
              type="button"
              className="recent-skins-hero-nav recent-skins-hero-nav--prev"
              aria-label="Previous skin"
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              className="recent-skins-hero-nav recent-skins-hero-nav--next"
              aria-label="Next skin"
              onClick={(e) => { e.stopPropagation(); goNext(); }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="recent-skins-hero-dots" role="tablist" aria-label="Skin carousel">
          {skins.map((skin, i) => (
            <button
              key={`dot-${skin.skinId}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${skin.skinName}, slide ${i + 1} of ${count}`}
              className={`recent-skins-hero-dot${i === index ? ' active' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
