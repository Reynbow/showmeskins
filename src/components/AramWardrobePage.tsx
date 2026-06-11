import { useEffect, useMemo, useRef, useState } from 'react';
import { getModelUrl, getSplashArt, getSplashArtFallback, getTileArt } from '../api';
import type { AramWardrobeChampion } from '../types';
import { ModelViewer } from './ModelViewer';
import './AramWardrobePage.css';

interface Props {
  champions: AramWardrobeChampion[];
  onBack: () => void;
}

type CostFilter = 'All' | number;

interface SelectedSkin {
  championId: string;
  championName: string;
  skinId: string;
  skinNum: number;
  skinName: string;
  cost: number;
}

export function AramWardrobePage({ champions, onBack }: Props) {
  const [search, setSearch] = useState('');
  const [costFilter, setCostFilter] = useState<CostFilter>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Skin IDs whose splash art 404'd; remembers the loading-art fallback URL.
  const [splashFallbacks, setSplashFallbacks] = useState<Record<string, string>>({});
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  // Distinct RP tiers present in the wardrobe (e.g. 520 / 750 / 975 / 1350).
  const costTiers = useMemo(() => {
    const tiers = new Set<number>();
    for (const champion of champions) {
      for (const skin of champion.skins) tiers.add(skin.cost);
    }
    return Array.from(tiers).sort((a, b) => a - b);
  }, [champions]);

  // Champion groups after search + RP-tier filtering (empty groups dropped).
  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result: Array<{ champion: AramWardrobeChampion; skins: AramWardrobeChampion['skins'] }> = [];
    for (const champion of champions) {
      const championMatches = !term || champion.championName.toLowerCase().includes(term);
      const skins = champion.skins.filter((skin) => {
        if (costFilter !== 'All' && skin.cost !== costFilter) return false;
        return championMatches || skin.skinName.toLowerCase().includes(term);
      });
      if (skins.length > 0) result.push({ champion, skins });
    }
    return result;
  }, [champions, search, costFilter]);

  const totalSkins = useMemo(
    () => groups.reduce((sum, group) => sum + group.skins.length, 0),
    [groups],
  );

  // Derive the active skin during render: the picked skin if still visible,
  // otherwise fall back to the first visible skin. No selection-syncing effect.
  const selected = useMemo<SelectedSkin | null>(() => {
    if (groups.length === 0) return null;
    const toSelected = (group: typeof groups[number], skin: AramWardrobeChampion['skins'][number]): SelectedSkin => ({
      championId: group.champion.championId,
      championName: group.champion.championName,
      skinId: skin.skinId,
      skinNum: skin.skinNum,
      skinName: skin.skinName,
      cost: skin.cost,
    });
    if (selectedId) {
      for (const group of groups) {
        const skin = group.skins.find((s) => s.skinId === selectedId);
        if (skin) return toSelected(group, skin);
      }
    }
    return toSelected(groups[0], groups[0].skins[0]);
  }, [groups, selectedId]);

  const splashUrl = selected
    ? splashFallbacks[selected.skinId] ?? getSplashArt(selected.championId, selected.skinNum)
    : '';

  // Preload the splash; only the async onerror callback touches state, so this
  // effect never sets state synchronously.
  useEffect(() => {
    if (!selected || splashFallbacks[selected.skinId]) return;
    const { championId, skinNum, skinId } = selected;
    const img = new Image();
    img.src = getSplashArt(championId, skinNum);
    img.onerror = () => {
      setSplashFallbacks((prev) => ({ ...prev, [skinId]: getSplashArtFallback(championId, skinNum) }));
    };
    return () => {
      img.onerror = null;
    };
  }, [selected, splashFallbacks]);

  // Keep the active row in view when selection changes (e.g. via filtering).
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected?.skinId]);

  return (
    <div className="aram-page">
      <div className="aram-header">
        <button className="aram-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Champions</span>
        </button>
        <div className="aram-header-title">
          <strong>ARAM Wardrobe</strong>
          <small>{totalSkins} Skin{totalSkins !== 1 ? 's' : ''} · {groups.length} Champion{groups.length !== 1 ? 's' : ''}</small>
        </div>
      </div>

      <div className="aram-body">
        <aside className="aram-list-col">
          <div className="aram-list-controls">
            <div className="aram-search-wrap">
              <svg className="aram-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className="aram-search"
                placeholder="Search skins or champions..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button className="aram-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="aram-cost-filter">
              <button
                className={`aram-chip${costFilter === 'All' ? ' active' : ''}`}
                onClick={() => setCostFilter('All')}
              >
                All
              </button>
              {costTiers.map((tier) => (
                <button
                  key={tier}
                  className={`aram-chip${costFilter === tier ? ' active' : ''}`}
                  onClick={() => setCostFilter(tier)}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          <div className="aram-list">
            {groups.length === 0 && (
              <div className="aram-empty">No skins match your filters.</div>
            )}
            {groups.map((group) => (
              <div
                key={group.champion.championId}
                className="aram-group"
              >
                <div className="aram-group-header">
                  <span>{group.champion.championName}</span>
                  <span className="aram-group-count">{group.skins.length}</span>
                </div>
                <div className="aram-skin-grid">
                  {group.skins.map((skin) => {
                    const isSelected = selected?.championId === group.champion.championId
                      && selected?.skinId === skin.skinId;
                    return (
                      <button
                        key={skin.skinId}
                        ref={isSelected ? selectedRowRef : undefined}
                        className={`aram-card${isSelected ? ' selected' : ''}`}
                        onClick={() => setSelectedId(skin.skinId)}
                        title={`${skin.skinName} — ${skin.cost} RP`}
                      >
                        <div className="aram-card-border" />
                        <div className="aram-card-image">
                          <img
                            src={getTileArt(group.champion.championId, skin.skinNum)}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                              const fallback = getSplashArtFallback(group.champion.championId, skin.skinNum);
                              if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
                            }}
                          />
                          <span className="aram-card-cost">{skin.cost}</span>
                        </div>
                        <span className="aram-card-name">{skin.skinName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="aram-preview">
          {selected ? (
            <>
              <ModelViewer
                key={`${selected.championId}-${selected.skinId}`}
                modelUrl={getModelUrl(selected.championId, selected.skinId)}
                chromaTextureUrl={null}
                splashUrl={splashUrl}
                viewMode="model"
                chromas={[]}
                selectedChromaId={null}
                chromaResolving={false}
                onChromaSelect={() => {}}
                modelCameraZ={7}
              />
              <div className="aram-preview-overlay">
                <div className="aram-preview-name">{selected.skinName}</div>
                <div className="aram-preview-meta">
                  <span>{selected.championName}</span>
                  <span className="aram-preview-cost">{selected.cost} RP</span>
                </div>
              </div>
            </>
          ) : (
            <div className="aram-preview-empty">Select a skin to preview</div>
          )}
        </section>
      </div>
    </div>
  );
}
