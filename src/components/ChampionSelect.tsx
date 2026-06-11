import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ChampionBasic, RegionCategory, SkinLineCategory, SkinLineMember } from '../types';
import type { RecentSkinSpotlight } from '../api';
import {
  getChampionIcon,
  getRecentSkins,
  getSkinPreviewArt,
  getSplashArt,
  getSplashArtFallback,
  getTileArt,
} from '../api';
import { RecentSkinsHero } from './RecentSkinsHero';
import { SkinLineRosterHero } from './SkinLineRosterHero';
import { AmbientBackground } from './AmbientBackground';
import { REGION_LOGOS } from './regionConstants';
import './ChampionSelect.css';

interface Props {
  champions: ChampionBasic[];
  version: string;
  onSelect: (champion: ChampionBasic) => void;
  onOpenSkin: (spotlight: RecentSkinSpotlight) => void;
  onCompanion: () => void;
  onSkinLines: () => void;
  onRegions: () => void;
  onAramWardrobe: () => void;
  onOpenMatchHistory: (riotId: string) => void;
  hasLiveGame?: boolean;
  onLiveGame?: () => void;
  regionsView?: boolean;
  regions?: RegionCategory[];
  regionsLoading?: boolean;
  regionsError?: string | null;
  onRegionsBack?: () => void;
  skinLinesView?: boolean;
  skinLines?: SkinLineCategory[];
  skinLinesLoading?: boolean;
  skinLinesError?: string | null;
  onSkinLinesBack?: () => void;
  onSelectSkinLineMember?: (line: SkinLineCategory, member: SkinLineMember) => void;
}

function previewMemberForRegion(region: RegionCategory) {
  if (region.members.length === 0) return undefined;
  let hash = 0;
  for (let i = 0; i < region.id.length; i++) {
    hash = (hash + region.id.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return region.members[hash % region.members.length];
}

function previewMemberForSkinLine(line: SkinLineCategory) {
  if (line.members.length === 0) return undefined;
  let hash = 0;
  const key = String(line.id);
  for (let i = 0; i < key.length; i++) {
    hash = (hash + key.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return line.members[hash % line.members.length];
}

function uniqueChampionIdsInSkinLine(line: SkinLineCategory): Set<string> {
  return new Set(line.members.map((member) => member.championId.toLowerCase()));
}

const ROLES = ['All', 'Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'];
const PLAYER_SEARCH_NAME_KEY = 'sms_player_search_name';
const PLAYER_SEARCH_TAG_KEY = 'sms_player_search_tag';

export function ChampionSelect({
  champions,
  version,
  onSelect,
  onOpenSkin,
  onCompanion,
  onSkinLines,
  onRegions,
  onAramWardrobe,
  onOpenMatchHistory,
  hasLiveGame,
  onLiveGame,
  regionsView = false,
  regions = [],
  regionsLoading = false,
  regionsError = null,
  onRegionsBack,
  skinLinesView = false,
  skinLines = [],
  skinLinesLoading = false,
  skinLinesError = null,
  onSkinLinesBack,
  onSelectSkinLineMember,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeRegion, setActiveRegion] = useState<RegionCategory | null>(null);
  const [activeSkinLine, setActiveSkinLine] = useState<SkinLineCategory | null>(null);
  const [riotGameNameSearch, setRiotGameNameSearch] = useState(() => {
    try {
      return window.localStorage.getItem(PLAYER_SEARCH_NAME_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [riotTagSearch, setRiotTagSearch] = useState(() => {
    try {
      return window.localStorage.getItem(PLAYER_SEARCH_TAG_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [selectedRole, setSelectedRole] = useState('All');
  const [scrolled, setScrolled] = useState(false);
  const [hoveredLetter, setHoveredLetter] = useState<string | null>(null);
  const [recentSkins, setRecentSkins] = useState<RecentSkinSpotlight[]>([]);

  const showingRegionGrid = regionsView && !activeRegion;
  const showingRegionRoster = regionsView && !!activeRegion;
  const showingSkinLineGrid = skinLinesView && !activeSkinLine;
  const showingSkinLineRoster = skinLinesView && !!activeSkinLine;
  const showingCatalogRoster = showingRegionRoster || showingSkinLineRoster;

  useEffect(() => {
    if (regionsView) {
      setSearch('');
      setSelectedRole('All');
      return;
    }
    setActiveRegion(null);
  }, [regionsView]);

  useEffect(() => {
    if (skinLinesView) {
      setSearch('');
      setSelectedRole('All');
      return;
    }
    setActiveSkinLine(null);
  }, [skinLinesView]);

  useEffect(() => {
    getRecentSkins()
      .then(setRecentSkins)
      .catch((err) => {
        console.error('Failed to load recent skins:', err);
        setRecentSkins([]);
      });
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PLAYER_SEARCH_NAME_KEY, riotGameNameSearch);
    } catch {
      // ignore storage errors
    }
  }, [riotGameNameSearch]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PLAYER_SEARCH_TAG_KEY, riotTagSearch);
    } catch {
      // ignore storage errors
    }
  }, [riotTagSearch]);

  const handleGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrolled(e.currentTarget.scrollTop > 0);
  }, []);

  const openRegionRoster = useCallback((region: RegionCategory) => {
    setActiveRegion(region);
    setSearch('');
    setSelectedRole('All');
    setHoveredLetter(null);
  }, []);

  const backToRegionGrid = useCallback(() => {
    setActiveRegion(null);
    setSearch('');
    setSelectedRole('All');
    setHoveredLetter(null);
  }, []);

  const openSkinLineRoster = useCallback((line: SkinLineCategory) => {
    setActiveSkinLine(line);
    setSearch('');
    setSelectedRole('All');
    setHoveredLetter(null);
  }, []);

  const backToSkinLineGrid = useCallback(() => {
    setActiveSkinLine(null);
    setSearch('');
    setSelectedRole('All');
    setHoveredLetter(null);
  }, []);

  const championPool = useMemo(() => {
    if (showingRegionRoster && activeRegion) {
      const ids = new Set(activeRegion.members.map((m) => m.championId.toLowerCase()));
      return champions.filter((c) => ids.has(c.id.toLowerCase()));
    }
    if (showingSkinLineRoster && activeSkinLine) {
      const ids = uniqueChampionIdsInSkinLine(activeSkinLine);
      return champions.filter((c) => ids.has(c.id.toLowerCase()));
    }
    return champions;
  }, [champions, showingRegionRoster, activeRegion, showingSkinLineRoster, activeSkinLine]);

  const filteredChampions = useMemo(() => {
    return championPool.filter((c) => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
      const matchesRole = selectedRole === 'All' || c.tags.includes(selectedRole);
      return matchesSearch && matchesRole;
    });
  }, [championPool, search, selectedRole]);

  const filteredRegions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return regions;
    return regions.filter((region) => region.name.toLowerCase().includes(term));
  }, [regions, search]);

  const filteredSkinLines = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return skinLines;
    return skinLines.filter((line) => line.name.toLowerCase().includes(term));
  }, [skinLines, search]);

  const regionPreviews = useMemo(() => {
    const map = new Map<string, RegionCategory['members'][number]>();
    for (const region of regions) {
      const preview = previewMemberForRegion(region);
      if (preview) map.set(region.id, preview);
    }
    return map;
  }, [regions]);

  const skinLinePreviews = useMemo(() => {
    const map = new Map<number, SkinLineCategory['members'][number]>();
    for (const line of skinLines) {
      const preview = previewMemberForSkinLine(line);
      if (preview) map.set(line.id, preview);
    }
    return map;
  }, [skinLines]);

  const getRegionArt = useCallback(
    (region: RegionCategory) => {
      if (region.imageUri) return region.imageUri;
      const preview = regionPreviews.get(region.id);
      return preview ? getSplashArt(preview.championId, 0) : undefined;
    },
    [regionPreviews],
  );

  const activeRegionArt = useMemo(
    () => (activeRegion ? getRegionArt(activeRegion) : undefined),
    [activeRegion, getRegionArt],
  );

  const skinLineRosterMembers = useMemo(() => {
    if (!showingSkinLineRoster || !activeSkinLine) {
      return new Map<string, SkinLineCategory['members'][number]>();
    }
    const map = new Map<string, SkinLineCategory['members'][number]>();
    for (const member of activeSkinLine.members) {
      const key = member.championId.toLowerCase();
      if (!map.has(key)) map.set(key, member);
    }
    return map;
  }, [showingSkinLineRoster, activeSkinLine]);

  const grouped = useMemo(() => {
    const groups: { letter: string; champions: ChampionBasic[] }[] = [];
    let currentLetter = '';
    for (const champ of filteredChampions) {
      const letter = champ.name[0].toUpperCase();
      if (letter !== currentLetter) {
        currentLetter = letter;
        groups.push({ letter, champions: [champ] });
      } else {
        groups[groups.length - 1].champions.push(champ);
      }
    }
    return groups;
  }, [filteredChampions]);

  const submitRiotHistory = useCallback(() => {
    const gameName = riotGameNameSearch.trim();
    const tagLine = riotTagSearch.trim();
    if (!gameName || !tagLine) return;
    onOpenMatchHistory(`${gameName}#${tagLine}`);
  }, [onOpenMatchHistory, riotGameNameSearch, riotTagSearch]);

  const handleChampionCardClick = useCallback(
    (champion: ChampionBasic) => {
      if (showingSkinLineRoster && activeSkinLine && onSelectSkinLineMember) {
        const member = skinLineRosterMembers.get(champion.id.toLowerCase());
        if (member) {
          onSelectSkinLineMember(activeSkinLine, member);
          return;
        }
      }
      onSelect(champion);
    },
    [
      showingSkinLineRoster,
      activeSkinLine,
      onSelectSkinLineMember,
      skinLineRosterMembers,
      onSelect,
    ],
  );

  const searchPlaceholder = showingRegionGrid
    ? 'Search regions...'
    : showingSkinLineGrid
      ? 'Search skin lines...'
      : 'Search champions...';

  return (
    <div className="champion-select">
      <AmbientBackground />

      <div className="champion-select-header">
        <div className="cs-logo">
          <svg viewBox="0 0 40 40" fill="none" className="cs-logo-icon">
            <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
          </svg>
        </div>
        <h1 className="champion-select-title"><span className="cs-title-x">x</span>9report.com</h1>
        <div className="cs-companion-wrap">
          {hasLiveGame && onLiveGame && (
            <button className="cs-live-game-btn" onClick={onLiveGame} title="View live game">
              <span className="cs-live-game-dot" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cs-live-game-icon">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Live Game
            </button>
          )}
          <button className="cs-companion-btn cs-companion-btn--hidden" onClick={onCompanion}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cs-companion-icon">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download App
          </button>
        </div>
      </div>

      <div className="champion-select-controls">
        <div className="search-row">
          <div className="search-wrapper">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="search-wrapper search-wrapper--riot">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21a8 8 0 1 0-16 0" />
              <circle cx="12" cy="8" r="4" />
            </svg>
            <div className={`riot-id-inputs${!riotGameNameSearch && !riotTagSearch ? ' riot-id-inputs--empty' : ''}`}>
              <input
                type="text"
                className="search-input riot-id-input riot-id-input--name"
                placeholder="Search Players..."
                value={riotGameNameSearch}
                onChange={(e) => setRiotGameNameSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRiotHistory();
                }}
              />
              <span className="riot-id-separator" aria-hidden="true">#</span>
              <input
                type="text"
                className="search-input riot-id-input riot-id-input--tag"
                placeholder="Tag"
                value={riotTagSearch}
                onChange={(e) => setRiotTagSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRiotHistory();
                }}
              />
            </div>
            <button
              className="cs-history-btn"
              onClick={submitRiotHistory}
              disabled={!riotGameNameSearch.trim() || !riotTagSearch.trim()}
            >
              Search
            </button>
          </div>
        </div>

        {recentSkins.length > 0 && !showingCatalogRoster && (
          <RecentSkinsHero skins={recentSkins} onOpenSkin={onOpenSkin} />
        )}

        {showingRegionRoster && activeRegion && (
          <div className="region-roster-hero">
            <div className="region-roster-hero-label">Regions</div>
            <div className="region-roster-hero-stage">
              {activeRegionArt && (
                <img
                  className="region-roster-hero-art"
                  src={activeRegionArt}
                  alt=""
                  loading="lazy"
                />
              )}
              <div className="region-roster-hero-shade" />
              <div className="region-roster-hero-copy">
                <img
                  className="region-roster-hero-logo"
                  src={REGION_LOGOS[activeRegion.name] ?? REGION_LOGOS.Runeterra}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    if (event.currentTarget.src !== REGION_LOGOS.Runeterra) {
                      event.currentTarget.src = REGION_LOGOS.Runeterra;
                    }
                  }}
                />
                <div className="region-roster-hero-text">
                  <span className="region-roster-hero-kicker">Region</span>
                  <h2 className="region-roster-hero-title">{activeRegion.name}</h2>
                </div>
              </div>
            </div>
            <div className="region-roster-hero-dots" aria-hidden="true">
              <span className="region-roster-hero-dot active" />
            </div>
          </div>
        )}

        {showingSkinLineRoster && activeSkinLine && (
          <SkinLineRosterHero line={activeSkinLine} />
        )}

        <div className="cs-page-nav">
          {(showingRegionGrid || showingRegionRoster) && onRegionsBack && (
            <button type="button" className="cs-page-nav-btn cs-page-nav-btn--back" onClick={onRegionsBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Champions
            </button>
          )}
          {(showingSkinLineGrid || showingSkinLineRoster) && onSkinLinesBack && (
            <button type="button" className="cs-page-nav-btn cs-page-nav-btn--back" onClick={onSkinLinesBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Champions
            </button>
          )}
          {!skinLinesView && (
            <button type="button" className="cs-page-nav-btn" onClick={onSkinLines}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 4 20 8 12 12 4 8 12 4z" />
                <path d="M4 12l8 4 8-4" />
                <path d="M4 16l8 4 8-4" />
              </svg>
              Skin Lines
            </button>
          )}
          {!regionsView && (
            <button type="button" className="cs-page-nav-btn" onClick={onRegions}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="7.5" />
                <path d="M4.5 12h15" />
                <path d="M12 4.5c2.2 2.4 2.2 12.6 0 15" />
                <path d="M12 4.5c-2.2 2.4-2.2 12.6 0 15" />
              </svg>
              Regions
            </button>
          )}
          <button type="button" className="cs-page-nav-btn" onClick={onAramWardrobe}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="4" width="14" height="16" rx="1.5" />
              <path d="M12 4v16" />
            </svg>
            ARAM Wardrobe
          </button>
        </div>
      </div>

      <div className="champion-select-filters">
        {showingRegionRoster ? (
          <div className="region-filters">
            <button type="button" className="region-filter-back" onClick={backToRegionGrid}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Regions
            </button>
            {regions.map((region) => (
              <button
                key={region.id}
                type="button"
                className={`region-btn${activeRegion?.id === region.id ? ' active' : ''}`}
                onClick={() => openRegionRoster(region)}
              >
                {region.name}
              </button>
            ))}
          </div>
        ) : showingSkinLineRoster ? (
          <div className="region-filters">
            <button type="button" className="region-filter-back" onClick={backToSkinLineGrid}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Skin Lines
            </button>
          </div>
        ) : showingRegionGrid || showingSkinLineGrid ? (
          <div className="role-filters role-filters--placeholder" aria-hidden="true" />
        ) : (
          <div className="role-filters">
            {ROLES.map((role) => (
              <button
                key={role}
                type="button"
                className={`role-btn ${selectedRole === role ? 'active' : ''}`}
                onClick={() => setSelectedRole(role)}
              >
                {role}
              </button>
            ))}
          </div>
        )}

        <div className="cs-secondary-actions">
          <div className="champion-count">
            {showingRegionGrid
              ? `${filteredRegions.length} Region${filteredRegions.length !== 1 ? 's' : ''}`
              : showingSkinLineGrid
                ? `${filteredSkinLines.length} Skin Line${filteredSkinLines.length !== 1 ? 's' : ''}`
                : `${filteredChampions.length} Champion${filteredChampions.length !== 1 ? 's' : ''}`}
          </div>
        </div>
      </div>

      <div className={`champion-grid-wrapper${scrolled ? ' scrolled' : ''}`} onScroll={handleGridScroll}>
        {showingSkinLineGrid ? (
          <div className="champion-grid regions-grid">
            {skinLinesLoading && skinLines.length === 0 && !skinLinesError && (
              <div className="grid-status-message">Loading skin lines…</div>
            )}
            {skinLinesError && skinLines.length === 0 && (
              <div className="grid-status-message">{skinLinesError}</div>
            )}
            {filteredSkinLines.map((line, i) => {
              const preview = skinLinePreviews.get(line.id);
              const artSrc = preview ? getSplashArt(preview.championId, preview.skinNum) : undefined;
              const championCount = uniqueChampionIdsInSkinLine(line).size;
              return (
                <button
                  key={line.id}
                  type="button"
                  className="region-grid-card skinline-grid-card"
                  onClick={() => openSkinLineRoster(line)}
                  style={{ animationDelay: `${Math.min(i * 40, 600)}ms` }}
                >
                  {artSrc && (
                    <div className="region-grid-card-art">
                      <img
                        src={artSrc}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          if (!preview) return;
                          const fallback = getSplashArtFallback(preview.championId, preview.skinNum);
                          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                        }}
                      />
                    </div>
                  )}
                  <div className="region-grid-card-shade" />
                  <span className="region-grid-card-name">{line.name}</span>
                  <span className="region-grid-card-count">{championCount}</span>
                </button>
              );
            })}
            {!skinLinesLoading && filteredSkinLines.length === 0 && skinLines.length === 0 && !skinLinesError && (
              <div className="grid-status-message">No skin lines found.</div>
            )}
            {!skinLinesLoading && filteredSkinLines.length === 0 && skinLines.length > 0 && (
              <div className="grid-status-message">No skin lines match your search.</div>
            )}
          </div>
        ) : showingRegionGrid ? (
          <div className="champion-grid regions-grid">
            {regionsLoading && regions.length === 0 && !regionsError && (
              <div className="grid-status-message">Loading regions…</div>
            )}
            {regionsError && regions.length === 0 && (
              <div className="grid-status-message">{regionsError}</div>
            )}
            {filteredRegions.map((region, i) => {
              const preview = regionPreviews.get(region.id);
              const artSrc = region.imageUri ?? (preview ? getSplashArt(preview.championId, 0) : undefined);
              return (
                <button
                  key={region.id}
                  type="button"
                  className="region-grid-card"
                  onClick={() => openRegionRoster(region)}
                  style={{ animationDelay: `${Math.min(i * 40, 600)}ms` }}
                >
                  {artSrc && (
                    <div className="region-grid-card-art">
                      <img
                        src={artSrc}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          if (region.imageUri && preview) {
                            e.currentTarget.src = getSplashArt(preview.championId, 0);
                            return;
                          }
                          if (!preview) return;
                          const fallback = getSplashArtFallback(preview.championId, 0);
                          if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
                        }}
                      />
                    </div>
                  )}
                  <div className="region-grid-card-shade" />
                  <img
                    className="region-grid-card-logo"
                    src={REGION_LOGOS[region.name] ?? REGION_LOGOS.Runeterra}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      if (event.currentTarget.src !== REGION_LOGOS.Runeterra) {
                        event.currentTarget.src = REGION_LOGOS.Runeterra;
                      }
                    }}
                  />
                  <span className="region-grid-card-name">{region.name}</span>
                  <span className="region-grid-card-count">{region.members.length}</span>
                </button>
              );
            })}
            {!regionsLoading && filteredRegions.length === 0 && regions.length === 0 && !regionsError && (
              <div className="grid-status-message">No regions found.</div>
            )}
            {!regionsLoading && filteredRegions.length === 0 && regions.length > 0 && (
              <div className="grid-status-message">No regions match your search.</div>
            )}
          </div>
        ) : (
          <div className={`champion-grid${hoveredLetter && !showingCatalogRoster ? ' letter-highlight' : ''}`}>
            {grouped.map((group, gi) => [
              ...(selectedRole === 'All' && !showingCatalogRoster ? [
                <div
                  key={`letter-${group.letter}`}
                  className="letter-marker"
                  onMouseEnter={() => setHoveredLetter(group.letter)}
                  onMouseLeave={() => setHoveredLetter(null)}
                >
                  <div className="letter-marker-box">
                    <span>{group.letter}</span>
                  </div>
                  <span className="champion-card-name">&nbsp;</span>
                </div>
              ] : []),
              ...group.champions.map((champion, ci) => {
                const i = grouped.slice(0, gi).reduce((sum, g) => sum + g.champions.length, 0) + ci;
                const dimmed = hoveredLetter !== null && champion.name[0].toUpperCase() !== hoveredLetter;
                const skinMember = skinLineRosterMembers.get(champion.id.toLowerCase());
                const cardArtSrc = skinMember
                  ? getSkinPreviewArt(skinMember)
                  : getChampionIcon(champion.id, version);
                return (
                  <button
                    key={champion.id}
                    className={`champion-card${dimmed ? ' dimmed' : ''}`}
                    onClick={() => handleChampionCardClick(champion)}
                    style={{ animationDelay: `${Math.min(i * 12, 600)}ms` }}
                  >
                    <div className="champion-card-border" />
                    <div className="champion-card-image">
                      <img
                        src={cardArtSrc}
                        alt={champion.name}
                        loading="lazy"
                        onError={(event) => {
                          if (!skinMember) return;
                          const img = event.currentTarget;
                          const ddragonTile = getTileArt(skinMember.championId, skinMember.skinNum);
                          if (img.src !== ddragonTile) {
                            img.src = ddragonTile;
                            return;
                          }
                          const icon = getChampionIcon(champion.id, version);
                          if (img.src !== icon) img.src = icon;
                        }}
                      />
                    </div>
                    <span className="champion-card-name">{champion.name}</span>
                  </button>
                );
              }),
            ])}
          </div>
        )}
        {!showingRegionGrid && !showingSkinLineGrid && filteredChampions.length === 0 && (
          <div className="no-results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
              <path d="M8 11h6" />
            </svg>
            <p>No champions found</p>
            <span>Try a different search or filter</span>
          </div>
        )}
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}
