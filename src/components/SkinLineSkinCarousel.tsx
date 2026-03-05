import { useRef, useEffect, useState, useCallback } from 'react';
import type { SkinLineMember } from '../types';
import { getLoadingArt, getLoadingArtDdragon, getSplashArt, getSplashArtFallback } from '../api';
import './SkinCarousel.css';

interface Props {
  members: SkinLineMember[];
  selectedSkinId: string;
  onSelect: (member: SkinLineMember) => void;
}

export function SkinLineSkinCarousel({ members, selectedSkinId, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

  const handleImageLoad = useCallback((skinId: string) => {
    setLoadedImages((prev) => {
      const next = new Set(prev);
      next.add(skinId);
      return next;
    });
  }, []);

  useEffect(() => {
    setLoadedImages(new Set());
  }, [members]);

  useEffect(() => {
    const selectedEl = scrollRef.current?.querySelector('.skin-card.active');
    if (selectedEl) {
      selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedSkinId]);

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
        <span className="skin-carousel-count">{members.length}</span>
        <div className="skin-carousel-line" />
      </div>

      <div className="skin-carousel-container">
        <button className="skin-nav-btn" onClick={() => scroll('left')} aria-label="Scroll left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        <div className="skin-cards" ref={scrollRef}>
          {members.map((member, i) => {
            const isActive = member.skinId === selectedSkinId;
            const name = member.skinName;
            return (
              <button
                key={member.skinId}
                className={`skin-card ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(member)}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="skin-card-image-wrapper">
                  <div className="skin-card-image">
                    {!loadedImages.has(member.skinId) && (
                      <div className="skin-card-loader">
                        <div className="skin-card-spinner" />
                      </div>
                    )}
                    <img
                      src={isActive ? getSplashArt(member.championId, member.skinNum) : getLoadingArt(member.championId, member.skinNum)}
                      alt=""
                      loading="lazy"
                      className={loadedImages.has(member.skinId) ? 'loaded' : ''}
                      onLoad={() => handleImageLoad(member.skinId)}
                      onError={(e) => {
                        const img = e.currentTarget;
                        const fallback = isActive
                          ? getSplashArtFallback(member.championId, member.skinNum)
                          : getLoadingArtDdragon(member.championId, member.skinNum);
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
