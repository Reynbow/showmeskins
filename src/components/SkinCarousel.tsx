import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChampionDetail, Skin } from '../types';
import { getCenteredSplashArt, getLoadingArt, getSplashArt, getLoadingArtDdragon, getSplashArtFallback } from '../api';
import './SkinCarousel.css';

interface Props {
  champion: ChampionDetail;
  selectedSkin: Skin;
  onSkinSelect: (skin: Skin) => void;
}

export function SkinCarousel({ champion, selectedSkin, onSkinSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());
  const [canScroll, setCanScroll] = useState(false);

  // Show the nav chevrons (and edge fades) only when the strip overflows.
  // The 300ms re-check catches the active card's width transition settling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setCanScroll(el.scrollWidth > el.clientWidth + 1);
    update();
    const timer = setTimeout(update, 300);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [champion.id, selectedSkin.num]);

  const handleImageLoad = useCallback((skinNum: number) => {
    setLoadedImages(prev => {
      const next = new Set(prev);
      next.add(skinNum);
      return next;
    });
  }, []);

  // Reset loaded state when champion changes
  useEffect(() => {
    setLoadedImages(new Set());
  }, [champion.id]);

  useEffect(() => {
    const selectedEl = scrollRef.current?.querySelector('.skin-card.active');
    if (selectedEl) {
      selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedSkin]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const amount = direction === 'left' ? -320 : 320;
      scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  return (
    <div className="skin-carousel">
      <div className="skin-carousel-header">
        <div className="skin-carousel-line" />
        <span className="skin-carousel-title">Skins</span>
        <span className="skin-carousel-count">{champion.skins.length}</span>
        <div className="skin-carousel-line" />
      </div>

      <div className="skin-carousel-container">
        {canScroll && (
          <button className="skin-nav-btn skin-nav-btn--prev" onClick={() => scroll('left')} aria-label="Scroll left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}

        <div className="skin-cards" ref={scrollRef}>
          {champion.skins.map((skin, i) => {
            const isActive = skin.num === selectedSkin.num;
            const name = skin.num === 0 ? champion.name : skin.name;
            return (
              <button
                key={skin.num}
                className={`skin-card ${isActive ? 'active' : ''}`}
                onClick={() => onSkinSelect(skin)}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="skin-card-image-wrapper">
                  <div className="skin-card-image">
                    {!loadedImages.has(skin.num) && (
                      <div className="skin-card-loader">
                        <div className="skin-card-spinner" />
                      </div>
                    )}
                    <img
                      src={isActive ? getCenteredSplashArt(champion.id, skin.num) : getLoadingArt(champion.id, skin.num)}
                      alt=""
                      loading="lazy"
                      className={loadedImages.has(skin.num) ? 'loaded' : ''}
                      onLoad={() => handleImageLoad(skin.num)}
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (isActive) {
                          // Centered splash → DDragon splash → loading art.
                          const ddSplash = getSplashArt(champion.id, skin.num);
                          if (img.src.includes('_splash_centered_')) {
                            img.src = ddSplash;
                            return;
                          }
                          const fallback = getSplashArtFallback(champion.id, skin.num);
                          if (img.src !== fallback) img.src = fallback;
                          return;
                        }
                        const fallback = getLoadingArtDdragon(champion.id, skin.num);
                        if (img.src !== fallback) img.src = fallback;
                      }}
                    />
                  </div>
                  <span className="skin-card-name">{name}</span>
                  {isActive && <div className="skin-card-glow" />}
                </div>
                {!isActive && <div className="skin-tooltip">{name}</div>}
                {isActive && <div className="skin-card-indicator" />}
              </button>
            );
          })}
        </div>

        {canScroll && (
          <button className="skin-nav-btn skin-nav-btn--next" onClick={() => scroll('right')} aria-label="Scroll right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
