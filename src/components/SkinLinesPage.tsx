import { useMemo, useState } from 'react';
import { getSplashArt, getSplashArtFallback } from '../api';
import type { SkinLineCategory, SkinLineMember } from '../types';
import './SkinLinesPage.css';

interface Props {
  skinLines: SkinLineCategory[];
  onBack: () => void;
  onOpenLine: (line: SkinLineCategory) => void;
}

export function SkinLinesPage({
  skinLines,
  onBack,
  onOpenLine,
}: Props) {
  const [search, setSearch] = useState('');
  const previewMembers = useMemo(() => {
    const byLine = new Map<number, SkinLineMember>();
    for (const line of skinLines) {
      if (line.members.length === 0) continue;
      const idx = Math.floor(Math.random() * line.members.length);
      byLine.set(line.id, line.members[idx]);
    }
    return byLine;
  }, [skinLines]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return skinLines;
    return skinLines.filter((line) => line.name.toLowerCase().includes(term));
  }, [search, skinLines]);

  return (
    <div className="skin-lines-page">
      <div className="sl-bg-glow" />
      <div className="sl-bg-lines" />
      <div className="skin-lines-header">
        <button className="skin-lines-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Champions</span>
        </button>
        <div className="skin-lines-brand">
          <div className="skin-lines-logo">
            <svg viewBox="0 0 40 40" fill="none" className="skin-lines-logo-icon">
              <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            </svg>
          </div>
          <h1 className="skin-lines-title"><span className="skin-lines-title-x">x</span>9report.com</h1>
          <div className="skin-lines-subtitle">Skin Lines</div>
          <div className="skin-lines-count">
            {filtered.length} Skin Line{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      <div className="skin-lines-controls">
        <div className="skin-lines-search-wrap">
          <svg className="skin-lines-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="skin-lines-search"
            placeholder="Search skin lines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="skin-lines-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="skin-lines-grid">
        {filtered.map((line) => (
          <button key={line.id} className="skin-line-card" onClick={() => onOpenLine(line)}>
            {previewMembers.get(line.id) && (
              <div className="skin-line-card-preview">
                <img
                  src={getSplashArt(previewMembers.get(line.id)!.championId, previewMembers.get(line.id)!.skinNum)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    const member = previewMembers.get(line.id);
                    if (!member) return;
                    const fallback = getSplashArtFallback(member.championId, member.skinNum);
                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                  }}
                />
              </div>
            )}
            <div className="skin-line-card-head">
              <h2>{line.name}</h2>
            </div>
            <p>{line.description || 'Explore champions in this skin line.'}</p>
            <span className="skin-line-card-count">{line.members.length}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
