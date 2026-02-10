import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChampionDetail, Skin, ChromaInfo } from '../types';
import { ModelViewer, type ViewMode } from './ModelViewer';
import { SkinCarousel } from './SkinCarousel';
import { getSplashArt, getSplashArtFallback, getModelUrl, getAlternateModelUrl, ALTERNATE_FORMS, getChampionChromas, resolveChromaTextureUrl } from '../api';
import './ChampionViewer.css';

interface Props {
  champion: ChampionDetail;
  selectedSkin: Skin;
  onBack: () => void;
  onSkinSelect: (skin: Skin) => void;
  onPrevChampion: () => void;
  onNextChampion: () => void;
}

export function ChampionViewer({ champion, selectedSkin, onBack, onSkinSelect, onPrevChampion, onNextChampion }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('model');

  /* ── Chroma data & selection ─────────────────────────────────── */
  const [chromaMap, setChromaMap] = useState<Record<string, ChromaInfo[]>>({});
  const [selectedChromaId, setSelectedChromaId] = useState<number | null>(null);
  const [chromaResolving, setChromaResolving] = useState(false);
  const [chromaTextureUrl, setChromaTextureUrl] = useState<string | null>(null);

  // Track which skin the current chroma state belongs to.
  // When the skin changes we clear chroma state synchronously during render
  // so the ModelViewer never receives a stale chroma URL for a different skin.
  const chromaSkinRef = useRef(selectedSkin.id);
  if (chromaSkinRef.current !== selectedSkin.id) {
    chromaSkinRef.current = selectedSkin.id;
    if (selectedChromaId !== null) setSelectedChromaId(null);
    if (chromaTextureUrl !== null) setChromaTextureUrl(null);
    if (chromaResolving) setChromaResolving(false);
  }

  // Fetch chroma data once per champion
  useEffect(() => {
    setChromaMap({});
    getChampionChromas(champion.key).then(setChromaMap);
  }, [champion.key]);

  const handleChromaSelect = useCallback((chromaId: number | null) => {
    setSelectedChromaId(chromaId);
    setChromaResolving(chromaId !== null);
  }, []);

  const skinChromas = chromaMap[selectedSkin.id] ?? [];

  // Attempt to resolve the chroma texture URL.
  // If resolution fails the swatch stays selected but the model just keeps
  // showing the base skin — no deselection, no error UI.
  useEffect(() => {
    if (selectedChromaId == null) {
      setChromaTextureUrl(null);
      setChromaResolving(false);
      return;
    }
    let cancelled = false;
    resolveChromaTextureUrl(champion.id, selectedChromaId)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setChromaTextureUrl(url);
        }
        // If url is null the base skin stays visible — that's fine.
        setChromaResolving(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Silently fall back to the base skin.
        setChromaResolving(false);
      });
    return () => { cancelled = true; };
  }, [champion.id, selectedChromaId]);

  /* ── Alternate form toggle (Elise spider, Nidalee cougar, etc.) ── */
  const [useAltForm, setUseAltForm] = useState(false);
  const altForm = ALTERNATE_FORMS[champion.id] ?? null;

  // Reset to default form when switching champions (but keep it when switching skins)
  useEffect(() => {
    setUseAltForm(false);
  }, [champion.id]);

  const ddSplashUrl = getSplashArt(champion.id, selectedSkin.num);
  const [splashUrl, setSplashUrl] = useState(ddSplashUrl);

  // When skin changes, try DDragon first; fall back to CommunityDragon CDN on error
  useEffect(() => {
    const dd = getSplashArt(champion.id, selectedSkin.num);
    setSplashUrl(dd);
    const img = new Image();
    img.src = dd;
    img.onload = () => setSplashUrl(dd);
    img.onerror = () => setSplashUrl(getSplashArtFallback(champion.key, selectedSkin.num));
    return () => { img.onload = null; img.onerror = null; };
  }, [champion.id, champion.key, selectedSkin.num]);

  // Model URL — use alternate form URL if toggled, otherwise default
  const modelUrl = useAltForm && altForm
    ? getAlternateModelUrl(champion.id, selectedSkin.id)!
    : getModelUrl(champion.id, selectedSkin.id);
  const skinName = selectedSkin.num === 0 ? champion.name : selectedSkin.name;

  /* ── Draggable splash art ─────────────────────────────────── */
  const panelRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgOffset, setImgOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragState = useRef<{ dragging: boolean; startX: number; startY: number; originX: number; originY: number }>({
    dragging: false, startX: 0, startY: 0, originX: 0, originY: 0,
  });

  // Reset offset when skin changes
  useEffect(() => {
    setImgOffset({ x: 0, y: 0 });
  }, [selectedSkin.id]);

  /** Clamp offset so the image never reveals empty space at edges */
  const clampOffset = useCallback((ox: number, oy: number): { x: number; y: number } => {
    const panel = panelRef.current;
    const img = imgRef.current;
    if (!panel || !img) return { x: 0, y: 0 };

    const pW = panel.clientWidth;
    const pH = panel.clientHeight;
    const natW = img.naturalWidth || pW;
    const natH = img.naturalHeight || pH;

    // The image is rendered to cover the panel; compute its rendered size
    const scaleW = pW / natW;
    const scaleH = pH / natH;
    const scale = Math.max(scaleW, scaleH);
    const renderedW = natW * scale;
    const renderedH = natH * scale;

    // Maximum panning range: how much overflow the image has vs the panel
    const maxX = Math.max((renderedW - pW) / 2, 0);
    const maxY = Math.max((renderedH - pH) / 2, 0);

    return {
      x: Math.max(-maxX, Math.min(maxX, ox)),
      y: Math.max(-maxY, Math.min(maxY, oy)),
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      originX: imgOffset.x,
      originY: imgOffset.y,
    };
  }, [imgOffset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setImgOffset(clampOffset(dragState.current.originX + dx, dragState.current.originY + dy));
  }, [clampOffset]);

  const handlePointerUp = useCallback(() => {
    dragState.current.dragging = false;
    // Snap back to clamped position (smooth via CSS transition)
    setImgOffset((prev) => clampOffset(prev.x, prev.y));
  }, [clampOffset]);

  return (
    <div className="champion-viewer">
      {/* Background splash - subtle */}
      <div
        className="viewer-bg-splash"
        style={{ backgroundImage: `url(${splashUrl})` }}
      />

      <div className="viewer-header">
        <button className="back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Champions</span>
        </button>

        <div className="champ-nav">
          <button className="champ-nav-btn" onClick={onPrevChampion} title="Previous Champion">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Previous</span>
          </button>
          <button className="champ-nav-btn" onClick={onNextChampion} title="Next Champion">
            <span>Next</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* View mode toggle */}
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'model' ? 'active' : ''}`}
            onClick={() => setViewMode('model')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <span>Front View</span>
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'ingame' ? 'active' : ''}`}
            onClick={() => setViewMode('ingame')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 12L12 2l10 10" />
              <path d="M2 12l10 10 10-10" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Top-Down</span>
          </button>
        </div>

        {altForm && (
          <button
            className={`form-toggle-btn${useAltForm ? ' active' : ''}`}
            onClick={() => setUseAltForm((prev) => !prev)}
            title={useAltForm ? `Switch to default form` : `Switch to ${altForm.label}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
            <span>{useAltForm ? 'Default' : altForm.label}</span>
          </button>
        )}

        <div className="viewer-skin-badge">
          <span className="viewer-skin-name">{skinName}</span>
          <span className="viewer-skin-sep">|</span>
          <span className="viewer-skin-title">{champion.title}</span>
        </div>
      </div>

      <div className="viewer-main">
        <div
          className="viewer-splash-panel"
          ref={panelRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img
            ref={imgRef}
            src={splashUrl}
            alt={skinName}
            className="viewer-splash-img"
            style={{
              objectPosition: `calc(50% + ${imgOffset.x}px) calc(50% + ${imgOffset.y}px)`,
            }}
            draggable={false}
            onError={(e) => {
              const fallback = getSplashArtFallback(champion.key, selectedSkin.num);
              if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
            }}
          />
        </div>
        <div className="viewer-model-panel">
          <ModelViewer
            modelUrl={modelUrl}
            splashUrl={splashUrl}
            viewMode={viewMode}
            chromas={skinChromas}
            selectedChromaId={selectedChromaId}
            chromaTextureUrl={chromaTextureUrl}
            chromaResolving={chromaResolving}
            onChromaSelect={handleChromaSelect}
          />
        </div>
      </div>

      <SkinCarousel
        champion={champion}
        selectedSkin={selectedSkin}
        onSkinSelect={onSkinSelect}
      />
    </div>
  );
}
