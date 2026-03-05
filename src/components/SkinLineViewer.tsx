import { useEffect, useState } from 'react';
import { getModelUrl, getSplashArt, getSplashArtFallback } from '../api';
import type { ChampionDetail, Skin, SkinLineCategory, SkinLineMember } from '../types';
import { ModelViewer, type ViewMode } from './ModelViewer';
import { SkinLineSkinCarousel } from './SkinLineSkinCarousel';
import './SkinLineViewer.css';

interface Props {
  skinLine: SkinLineCategory;
  selectedMember: SkinLineMember;
  champion: ChampionDetail;
  skin: Skin;
  onBackToLines: () => void;
  onSelectMember: (member: SkinLineMember) => void;
}

export function SkinLineViewer({
  skinLine,
  selectedMember,
  champion,
  skin,
  onBackToLines,
  onSelectMember,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('model');
  const [splashUrl, setSplashUrl] = useState(getSplashArt(champion.id, skin.num));

  useEffect(() => {
    const splash = getSplashArt(champion.id, skin.num);
    setSplashUrl(splash);
    const img = new Image();
    img.src = splash;
    img.onerror = () => setSplashUrl(getSplashArtFallback(champion.id, skin.num));
    return () => {
      img.onerror = null;
    };
  }, [champion.id, skin.num]);

  return (
    <div className="skin-line-viewer">
      <div className="skin-line-viewer-header">
        <button className="skin-line-viewer-back" onClick={onBackToLines}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Skin Lines</span>
        </button>
        <div className="skin-line-viewer-title">
          <strong>{skinLine.name}</strong>
          <small>{skin.name} - {champion.name}</small>
        </div>
        <div className="skin-line-view-toggle">
          <button
            className={viewMode === 'model' ? 'active' : ''}
            onClick={() => setViewMode('model')}
          >
            Front
          </button>
          <button
            className={viewMode === 'ingame' ? 'active' : ''}
            onClick={() => setViewMode('ingame')}
          >
            Top-Down
          </button>
        </div>
      </div>

      <div className="skin-line-viewer-main">
        <div className="skin-line-viewer-splash">
          <img src={splashUrl} alt={skin.name} />
        </div>
        <div className="skin-line-viewer-model">
          <ModelViewer
            modelUrl={getModelUrl(champion.id, skin.id)}
            chromaTextureUrl={null}
            splashUrl={splashUrl}
            viewMode={viewMode}
            chromas={[]}
            selectedChromaId={null}
            chromaResolving={false}
            onChromaSelect={() => {}}
          />
        </div>
      </div>

      <SkinLineSkinCarousel
        members={skinLine.members}
        selectedSkinId={selectedMember.skinId}
        onSelect={onSelectMember}
      />
    </div>
  );
}
