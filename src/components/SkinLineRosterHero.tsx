import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getSkinCenteredSplashArt, getSplashArt, getSplashArtFallback } from '../api';
import type { SkinLineCategory } from '../types';
import './RecentSkinsHero.css';

const AUTO_MS = 5500;

function randomStartIndex(count: number): number {
  if (count <= 1) return 0;
  return Math.floor(Math.random() * count);
}

interface Props {
  line: SkinLineCategory;
}

export function SkinLineRosterHero({ line }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const members = useMemo(
    () => [...line.members].sort((a, b) => {
      const byChamp = a.championName.localeCompare(b.championName);
      return byChamp !== 0 ? byChamp : a.skinName.localeCompare(b.skinName);
    }),
    [line.members],
  );

  const count = members.length;
  const active = count > 0 ? members[index] : null;

  const goTo = useCallback((next: number) => {
    if (count === 0) return;
    setIndex(((next % count) + count) % count);
  }, [count]);

  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);
  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);

  useLayoutEffect(() => {
    setIndex(randomStartIndex(members.length));
  }, [line.id, members.length]);

  useEffect(() => {
    if (count <= 1 || paused) return;
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTO_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [count, paused, line.id]);

  if (!active) return null;

  return (
    <section
      className="recent-skins-hero"
      aria-label={`${line.name} skin line artwork`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p className="recent-skins-hero-label">{line.name}</p>

      <div className="recent-skins-hero-stage">
        {members.map((member, i) => {
          const centeredSplash = getSkinCenteredSplashArt(member);
          return (
          <div
            key={`${member.championId}-${member.skinId}`}
            className={`recent-skins-hero-slide${i === index ? ' active' : ''}`}
            aria-hidden={i !== index}
          >
            <img
              src={centeredSplash}
              alt=""
              loading={i <= 1 ? 'eager' : 'lazy'}
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                const ddragonSplash = getSplashArt(member.championId, member.skinNum);
                if (member.splashPath && img.src === centeredSplash) {
                  img.src = ddragonSplash;
                } else if (img.src === ddragonSplash) {
                  img.src = getSplashArtFallback(member.championId, member.skinNum);
                }
              }}
            />
            <div className="recent-skins-hero-overlay" />
            <div className="recent-skins-hero-copy">
              <span className="recent-skins-hero-champ">{member.championName}</span>
              <span className="recent-skins-hero-name">{member.skinName}</span>
            </div>
          </div>
          );
        })}

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
        <div className="recent-skins-hero-dots" role="tablist" aria-label={`${line.name} skins`}>
          {members.map((member, i) => (
            <button
              key={`dot-${member.skinId}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${member.championName} — ${member.skinName}, slide ${i + 1} of ${count}`}
              className={`recent-skins-hero-dot${i === index ? ' active' : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}

      {count === 1 && (
        <div className="recent-skins-hero-dots" aria-hidden="true">
          <span className="recent-skins-hero-dot active" />
        </div>
      )}
    </section>
  );
}
