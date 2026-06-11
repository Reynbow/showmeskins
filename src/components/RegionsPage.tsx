import { useMemo, useState, type CSSProperties } from 'react';
import { getChampionIcon, getLoadingArt, getSplashArt, getSplashArtFallback } from '../api';
import type { ChampionBasic, RegionCategory } from '../types';
import { AmbientBackground } from './AmbientBackground';
import './SkinLinesPage.css';

interface Props {
  regions: RegionCategory[];
  champions: ChampionBasic[];
  version: string;
  onBack: () => void;
  onSelectChampion: (champion: ChampionBasic) => void;
}

const REGION_LOGOS: Record<string, string> = {
  'Bandle City': 'https://universe.leagueoflegends.com/images/bandle_city_crest_icon.png',
  Bilgewater: 'https://universe.leagueoflegends.com/images/bilgewater_crest_icon.png',
  Demacia: 'https://universe.leagueoflegends.com/images/demacia_crest_icon.png',
  Freljord: 'https://universe.leagueoflegends.com/images/freljord_crest_icon.png',
  Ionia: 'https://universe.leagueoflegends.com/images/iona_crest_icon.png',
  Ixtal: 'https://universe.leagueoflegends.com/images/ixtal_crest_icon.png',
  Noxus: 'https://universe.leagueoflegends.com/images/noxus_crest_icon.png',
  Piltover: 'https://universe.leagueoflegends.com/images/piltover_crest_icon.png',
  'Shadow Isles': 'https://universe.leagueoflegends.com/images/shadow_isles_crest_icon.png',
  Shurima: 'https://universe.leagueoflegends.com/images/shurima_crest_icon.png',
  Targon: 'https://universe.leagueoflegends.com/images/mt_targon_crest_icon.png',
  'The Void': 'https://universe.leagueoflegends.com/images/void_crest_icon.png',
  Zaun: 'https://universe.leagueoflegends.com/images/zaun_crest_icon.png',
  Runeterra: 'https://universe.leagueoflegends.com/images/icon-faction.png',
};

export function RegionsPage({
  regions,
  champions,
  version,
  onBack,
  onSelectChampion,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeRegion, setActiveRegion] = useState<RegionCategory | null>(null);

  const championById = useMemo(
    () => Object.fromEntries(champions.map((champ) => [champ.id.toLowerCase(), champ])),
    [champions],
  );

  const previewMembers = useMemo(() => {
    const byRegion = new Map<string, RegionCategory['members'][number]>();
    for (const region of regions) {
      if (region.members.length === 0) continue;
      const idx = Math.floor(Math.random() * region.members.length);
      byRegion.set(region.id, region.members[idx]);
    }
    return byRegion;
  }, [regions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return regions;
    return regions.filter((region) => region.name.toLowerCase().includes(term));
  }, [regions, search]);

  const modalChampions = useMemo(() => {
    if (!activeRegion) return [];
    const entries: Array<{
      championId: string;
      championName: string;
      roles: string[];
      champion: ChampionBasic;
    }> = [];
    for (const member of activeRegion.members) {
      const champion = championById[member.championId.toLowerCase()];
      if (!champion) continue;
      entries.push({
        championId: champion.id,
        championName: champion.name,
        roles: champion.tags,
        champion,
      });
    }
    return entries.sort((a, b) => a.championName.localeCompare(b.championName));
  }, [activeRegion, championById]);

  const modalHeaderArt = useMemo(() => {
    if (!activeRegion) return undefined;
    if (activeRegion.imageUri) return activeRegion.imageUri;
    const preview = previewMembers.get(activeRegion.id);
    return preview ? getSplashArt(preview.championId, 0) : undefined;
  }, [activeRegion, previewMembers]);

  const modalLayout = useMemo(() => {
    const count = modalChampions.length;
    if (count <= 1) return { rows: 1, columns: 1 };
    const rows = count <= 6 ? 1 : count <= 14 ? 2 : 3;
    const columns = Math.ceil(count / rows);
    return { rows, columns };
  }, [modalChampions.length]);

  const openRegionModal = (region: RegionCategory) => {
    setActiveRegion(region);
  };

  const closeRegionModal = () => {
    setActiveRegion(null);
  };

  return (
    <div className="skin-lines-page">
      <AmbientBackground />
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
          <div className="skin-lines-subtitle">Regions</div>
          <div className="skin-lines-count">
            {filtered.length} Region{filtered.length !== 1 ? 's' : ''}
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
            placeholder="Search regions..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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
        {filtered.map((region) => (
          <div
            key={region.id}
            className="skin-line-card region-card"
            role="button"
            tabIndex={0}
            onClick={() => openRegionModal(region)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openRegionModal(region);
              }
            }}
          >
            {(region.imageUri || previewMembers.get(region.id)) && (
              <div className="skin-line-card-preview">
                <img
                  src={region.imageUri ?? getSplashArt(previewMembers.get(region.id)!.championId, 0)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    if (region.imageUri && previewMembers.get(region.id)) {
                      const member = previewMembers.get(region.id);
                      if (!member) return;
                      e.currentTarget.src = getSplashArt(member.championId, 0);
                      return;
                    }
                    const member = previewMembers.get(region.id);
                    if (!member) return;
                    const fallback = getSplashArtFallback(member.championId, 0);
                    if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                  }}
                />
              </div>
            )}
            <div className="skin-line-card-head">
              <h2>{region.name}</h2>
            </div>
            <div className="region-card-logo-wrap">
              <img
                className="region-card-logo"
                src={REGION_LOGOS[region.name] ?? REGION_LOGOS.Runeterra}
                alt=""
                loading="lazy"
                onError={(event) => {
                  if (event.currentTarget.src !== REGION_LOGOS.Runeterra) {
                    event.currentTarget.src = REGION_LOGOS.Runeterra;
                  }
                }}
              />
            </div>
            <button
              className="skin-line-card-count"
              onClick={(event) => {
                event.stopPropagation();
                openRegionModal(region);
              }}
              aria-label={`View champions in ${region.name}`}
            >
              {region.members.length}
            </button>
          </div>
        ))}
      </div>

      {activeRegion && (
        <div
          className="region-modal-overlay"
          onClick={closeRegionModal}
        >
          <section
            className="region-modal"
            onClick={(event) => event.stopPropagation()}
            style={
              {
                '--region-modal-columns': String(modalLayout.columns),
                '--region-modal-rows': String(modalLayout.rows),
              } as CSSProperties
            }
          >
            <div
              className="region-modal-head"
              style={modalHeaderArt
                ? {
                  backgroundImage: `url(${modalHeaderArt})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
                : undefined}
            >
              <div className="region-modal-title-wrap">
                <h3>{activeRegion.name}</h3>
              </div>
              <button className="region-modal-close" onClick={closeRegionModal} aria-label="Close roster">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="region-modal-list">
              {modalChampions.map((champ) => (
                <button
                  key={`${activeRegion.id}-${champ.championId}`}
                  className="region-modal-card"
                  onClick={() => onSelectChampion(champ.champion)}
                >
                  <div className="region-modal-card-art">
                    <img
                      src={getLoadingArt(champ.championId, 0)}
                      alt={champ.championName}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.src = getChampionIcon(champ.championId, version);
                      }}
                    />
                    <span className="region-modal-card-name">{champ.championName}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
