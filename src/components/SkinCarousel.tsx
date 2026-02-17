import { useRef, useEffect, useState, useCallback } from 'react';
import type { ChampionDetail, Skin } from '../types';
import { getLoadingArt, getSplashArt, getLoadingArtFallback, getSplashArtFallback } from '../api';
import './SkinCarousel.css';

interface Props {
  champion: ChampionDetail;
  selectedSkin: Skin;
  onSkinSelect: (skin: Skin) => void;
}

export function SkinCarousel({ champion, selectedSkin, onSkinSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

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
        <button className="skin-nav-btn" onClick={() => scroll('left')} aria-label="Scroll left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

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
                      src={isActive ? getSplashArt(champion.id, skin.num) : getLoadingArt(champion.id, skin.num)}
                      alt=""
                      loading="lazy"
                      className={loadedImages.has(skin.num) ? 'loaded' : ''}
                      onLoad={() => handleImageLoad(skin.num)}
                      onError={(e) => {
                        const img = e.currentTarget;
                        const fallback = isActive
                          ? getSplashArtFallback(champion.id, skin.num)
                          : getLoadingArtFallback(champion.id, skin.num);
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

        <button className="skin-nav-btn" onClick={() => scroll('right')} aria-label="Scroll right">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
