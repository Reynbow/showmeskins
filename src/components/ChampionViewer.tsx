import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ChampionDetail, Skin, ChromaInfo } from '../types';
import { ModelViewer, type ViewMode } from './ModelViewer';
import { SkinCarousel } from './SkinCarousel';
import { getSplashArt, getSplashArtFallback, getModelUrl, getAlternateModelUrl, getAlternateFormTextureUrl, getCompanionModelUrl, COMPANION_MODELS, ALTERNATE_FORMS, LEVEL_FORM_CHAMPIONS, LEVEL_FORM_SKINS, CHAMPION_MODEL_VERSIONS, getModelVersionUrl, getModelVersionTextureUrl, getChampionChromas, resolveChromaTextureUrl, getModelAssetUrl, type ChampionModelVersion } from '../api';
import './ChampionViewer.css';

interface Props {
  champion: ChampionDetail;
  selectedSkin: Skin;
  initialChromaId?: number | null;
  onBack: () => void;
  onSkinSelect: (skin: Skin) => void;
  onPrevChampion: () => void;
  onNextChampion: () => void;
  hasLiveGame?: boolean;
  onLiveGame?: () => void;
}

type ExtraModel = { url: string; positionOffset: [number, number, number]; scaleMultiplier?: number };
type ResolvedModelVersion = ChampionModelVersion & { modelUrl: string; resolvedSkinId: string };
const EMPTY_MODEL_VERSIONS: ChampionModelVersion[] = [];

export function ChampionViewer({ champion, selectedSkin, initialChromaId, onBack, onSkinSelect, onPrevChampion, onNextChampion, hasLiveGame, onLiveGame }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('model');

  /* ── Chroma data & selection ─────────────────────────────────── */
  const [chromaMap, setChromaMap] = useState<Record<string, ChromaInfo[]>>({});
  const [selectedChromaId, setSelectedChromaId] = useState<number | null>(null);
  const [chromaResolving, setChromaResolving] = useState(false);
  const [chromaTextureUrl, setChromaTextureUrl] = useState<string | null>(null);
  const [companionChromaTextureUrl, setCompanionChromaTextureUrl] = useState<string | null>(null);
  const [resolvedExtraModels, setResolvedExtraModels] = useState<ExtraModel[]>([]);
  const [resolvedModelVersions, setResolvedModelVersions] = useState<ResolvedModelVersion[]>([]);
  const [modelVersionIndex, setModelVersionIndex] = useState(0);

  // Track which skin the current chroma state belongs to.
  // When the skin changes we clear chroma state synchronously during render
  // so the ModelViewer never receives a stale chroma URL for a different skin.
  const chromaSkinRef = useRef(selectedSkin.id);
  if (chromaSkinRef.current !== selectedSkin.id) {
    chromaSkinRef.current = selectedSkin.id;
    if (selectedChromaId !== null) setSelectedChromaId(null);
    if (chromaTextureUrl !== null) setChromaTextureUrl(null);
    if (companionChromaTextureUrl !== null) setCompanionChromaTextureUrl(null);
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

  // When companion app syncs a chroma selection, apply it here
  useEffect(() => {
    if (
      initialChromaId != null &&
      skinChromas.some((c) => c.id === initialChromaId)
    ) {
      setSelectedChromaId(initialChromaId);
    }
  }, [initialChromaId, skinChromas]);

  // Attempt to resolve the chroma texture URL(s).
  // For champions with companions (e.g. Annie + Tibbers), resolve both separately.
  // If resolution fails the swatch stays selected but the model just keeps
  // showing the base skin — no deselection, no error UI.
  const companion = COMPANION_MODELS[champion.id];
  useEffect(() => {
    if (selectedChromaId == null) {
      setChromaTextureUrl(null);
      setCompanionChromaTextureUrl(null);
      setChromaResolving(false);
      return;
    }
    let cancelled = false;
    const resolveMain = resolveChromaTextureUrl(champion.id, selectedChromaId, selectedSkin.id);
    const resolveCompanion = companion
      ? resolveChromaTextureUrl(champion.id, selectedChromaId, selectedSkin.id, companion.alias)
      : Promise.resolve(null);
    Promise.all([resolveMain, resolveCompanion]).then(([mainUrl, compUrl]) => {
      if (cancelled) return;
      if (mainUrl) setChromaTextureUrl(mainUrl);
      if (compUrl) setCompanionChromaTextureUrl(compUrl);
      setChromaResolving(false);
    }).catch(() => {
      if (cancelled) return;
      setChromaResolving(false);
    });
    return () => { cancelled = true; };
  }, [champion.id, selectedChromaId, selectedSkin.id, companion?.alias]);

  /* ── Alternate form toggle (Elise spider, Nidalee cougar, etc.) ── */
  const [useAltForm, setUseAltForm] = useState(false);
  const altForm = ALTERNATE_FORMS[champion.id] ?? null;

  // Reset to default form when switching champions (but keep it when switching skins)
  useEffect(() => {
    setUseAltForm(false);
  }, [champion.id]);

  // Resolve historical/alternate model versions for this champion + selected skin.
  // If the selected skin variant is unavailable, fall back to base skin.
  const modelVersions = useMemo(
    () => CHAMPION_MODEL_VERSIONS[champion.id] ?? EMPTY_MODEL_VERSIONS,
    [champion.id],
  );
  useEffect(() => {
    if (modelVersions.length === 0) {
      setResolvedModelVersions([]);
      return;
    }

    let cancelled = false;
    const baseSkinId = `${parseInt(champion.key, 10) * 1000}`;

    const headExists = async (url: string): Promise<boolean> => {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        return res.ok;
      } catch {
        return false;
      }
    };

    Promise.all(modelVersions.map(async (version) => {
      const selectedSkinUrl = getModelVersionUrl(version, champion.id, selectedSkin.id);
      if (selectedSkinUrl && await headExists(selectedSkinUrl)) {
        return { ...version, modelUrl: selectedSkinUrl, resolvedSkinId: selectedSkin.id } as ResolvedModelVersion;
      }
      if (baseSkinId !== selectedSkin.id) {
        const baseSkinUrl = getModelVersionUrl(version, champion.id, baseSkinId);
        if (baseSkinUrl && await headExists(baseSkinUrl)) {
          return { ...version, modelUrl: baseSkinUrl, resolvedSkinId: baseSkinId } as ResolvedModelVersion;
        }
      }
      return null;
    })).then((versions) => {
      if (cancelled) return;
      setResolvedModelVersions(versions.filter((v): v is ResolvedModelVersion => v !== null));
    });

    return () => { cancelled = true; };
  }, [champion.id, champion.key, modelVersions, selectedSkin.id]);

  // Reset selected historical version when changing champion, or when variants
  // shrink and the current index becomes invalid.
  useEffect(() => {
    setModelVersionIndex(0);
  }, [champion.id]);

  useEffect(() => {
    if (modelVersionIndex > resolvedModelVersions.length) setModelVersionIndex(0);
  }, [resolvedModelVersions.length, modelVersionIndex]);

  /* ── Level-form selector (Kayle ascension levels, Gun Goddess MF exosuits, etc.) ──── */
  // Skin-specific forms take precedence over champion-level forms
  const levelFormChamp = LEVEL_FORM_SKINS[selectedSkin.id] ?? LEVEL_FORM_CHAMPIONS[champion.id] ?? null;
  const [levelFormIndex, setLevelFormIndex] = useState(0);

  // Reset form index when switching champions or skins
  useEffect(() => {
    setLevelFormIndex(0);
  }, [champion.id, selectedSkin.id]);

  // The active form definition (null when champion has no level forms)
  const activeLevelForm = levelFormChamp ? levelFormChamp.forms[levelFormIndex] ?? null : null;

  const ddSplashUrl = getSplashArt(champion.id, selectedSkin.num);
  const [splashUrl, setSplashUrl] = useState(ddSplashUrl);

  // When skin changes, try Data Dragon first; fall back to CommunityDragon on error
  useEffect(() => {
    const dd = getSplashArt(champion.id, selectedSkin.num);
    setSplashUrl(dd);
    const img = new Image();
    img.src = dd;
    img.onload = () => setSplashUrl(dd);
    img.onerror = () => setSplashUrl(getSplashArtFallback(champion.key, selectedSkin.num));
    return () => { img.onload = null; img.onerror = null; };
  }, [champion.id, champion.key, selectedSkin.num]);

  // Companion model (e.g. Annie + Tibbers) — shown alongside main, no toggle
  const companionModelUrl = getCompanionModelUrl(champion.id, selectedSkin.id);

  // Champion-specific extra models (e.g. Azir soldiers).
  useEffect(() => {
    const getExtraModelSpecs = () => {
      if (champion.id === 'Azir') {
        return [
          { aliases: ['azirsoldier', 'azir_soldier', 'azirsandwarrior'], positionOffset: [0.9, 0, 1.0] as [number, number, number] },
          { aliases: ['azirtower', 'azir_tower', 'azirsundisc', 'azir_sundisc', 'sundisc'], positionOffset: [0.15, -0.1, -3.4] as [number, number, number], scaleMultiplier: 2.1 },
        ];
      }
      if (champion.id === 'Bard') {
        // Bard's meeps are exposed as the "bardfollower" model family.
        return [
          { aliases: ['bardfollower', 'bard_follower', 'bardmeep'], positionOffset: [0.95, 0, 1.2] as [number, number, number], scaleMultiplier: 0.18 },
        ];
      }
      return [];
    };

    const specs = getExtraModelSpecs();
    if (specs.length === 0) {
      setResolvedExtraModels([]);
      return;
    }

    let cancelled = false;

    const resolveModelFromAliases = async (aliases: string[]): Promise<string | null> => {
      for (const alias of aliases) {
        const url = getModelAssetUrl(alias, selectedSkin.id);
        try {
          const res = await fetch(url, { method: 'HEAD' });
          if (res.ok) return url;
        } catch {
          // Ignore and try the next alias candidate.
        }
      }
      return null;
    };

    Promise.all(specs.map(async (spec) => {
      const url = await resolveModelFromAliases(spec.aliases);
      if (!url) return null;
      const model: ExtraModel = {
        url,
        positionOffset: spec.positionOffset,
      };
      if (spec.scaleMultiplier != null) model.scaleMultiplier = spec.scaleMultiplier;
      return model;
    })).then((models) => {
      if (cancelled) return;
      setResolvedExtraModels(models.filter((model): model is ExtraModel => model !== null));
    });

    return () => { cancelled = true; };
  }, [champion.id, selectedSkin.id]);

  const extraModels = resolvedExtraModels;

  const mainModelOffset = useMemo<[number, number, number] | undefined>(
    () => (champion.id === 'Azir' ? [-0.6, 0, -0.2] : undefined),
    [champion.id],
  );

  // Alternate form can be either:
  // - a dedicated model alias (Elise/Nidalee/etc.), or
  // - a texture swap on the base model (Bel'Veth ult form).
  const altModelUrl = useAltForm && altForm
    ? getAlternateModelUrl(champion.id, selectedSkin.id)
    : null;
  const altTextureUrl = useAltForm && altForm
    ? getAlternateFormTextureUrl(champion.id, selectedSkin.id)
    : null;
  const altIdleAnimation = useAltForm ? (altForm?.idleAnimation ?? null) : null;
  const activeModelVersion = !useAltForm && modelVersionIndex > 0
    ? (resolvedModelVersions[modelVersionIndex - 1] ?? null)
    : null;
  const nextModelVersionLabel = useMemo(() => {
    if (resolvedModelVersions.length === 0) return 'alternate';
    const nextIdx = (modelVersionIndex + 1) % (resolvedModelVersions.length + 1);
    return nextIdx === 0 ? 'current' : (resolvedModelVersions[nextIdx - 1]?.label ?? 'current');
  }, [modelVersionIndex, resolvedModelVersions]);
  const versionTextureUrl = activeModelVersion
    ? getModelVersionTextureUrl(activeModelVersion, champion.id, activeModelVersion.resolvedSkinId)
    : null;
  const versionIdleAnimation = activeModelVersion?.idleAnimation ?? null;
  const modelUrl = altModelUrl ?? activeModelVersion?.modelUrl ?? getModelUrl(champion.id, selectedSkin.id);
  const activeMainTextureUrl = altTextureUrl ?? versionTextureUrl ?? chromaTextureUrl;
  const preferredIdleAnimation = altIdleAnimation ?? versionIdleAnimation;
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

        {hasLiveGame && onLiveGame && (
          <button className="viewer-live-game-btn" onClick={onLiveGame} title="View live game">
            <span className="viewer-live-game-dot" />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="viewer-live-game-icon">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            Live Game
          </button>
        )}

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

        {altForm && !companionModelUrl && (
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

        {resolvedModelVersions.length > 0 && !companionModelUrl && (
          <button
            className={`form-toggle-btn${activeModelVersion ? ' active' : ''}`}
            onClick={() => setModelVersionIndex((idx) => (idx + 1) % (resolvedModelVersions.length + 1))}
            title={activeModelVersion
              ? `Switch to ${nextModelVersionLabel} model`
              : `Switch to ${resolvedModelVersions[0]?.label ?? 'alternate'} model`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 7h16M4 17h16M7 4v16m10-16v16" />
            </svg>
            <span>{activeModelVersion ? activeModelVersion.label : 'Current'}</span>
          </button>
        )}

        {levelFormChamp && (
          <div className="level-form-selector">
            <span className="level-form-label">{levelFormChamp.label}</span>
            <div className="level-form-buttons">
              {levelFormChamp.forms.map((form, idx) => (
                <button
                  key={idx}
                  className={`level-form-btn${levelFormIndex === idx ? ' active' : ''}`}
                  onClick={() => setLevelFormIndex(idx)}
                  title={form.label}
                >
                  {form.label}
                </button>
              ))}
            </div>
          </div>
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
            companionModelUrl={companionModelUrl}
            extraModels={extraModels}
            mainModelOffset={mainModelOffset}
            chromaTextureUrl={activeMainTextureUrl}
            companionChromaTextureUrl={companionModelUrl ? companionChromaTextureUrl : null}
            preferredIdleAnimation={preferredIdleAnimation}
            splashUrl={splashUrl}
            viewMode={viewMode}
            chromas={skinChromas}
            selectedChromaId={selectedChromaId}
            chromaResolving={chromaResolving}
            onChromaSelect={handleChromaSelect}
            levelForm={activeLevelForm}
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
