import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ChampionBasic } from '../types';
import { getChampionIcon } from '../api';
import './ChampionSelect.css';

interface Props {
  champions: ChampionBasic[];
  version: string;
  onSelect: (champion: ChampionBasic) => void;
  onCompanion: () => void;
  onOpenMatchHistory: (riotId: string) => void;
  hasLiveGame?: boolean;
  onLiveGame?: () => void;
}

const ROLES = ['All', 'Fighter', 'Tank', 'Mage', 'Assassin', 'Marksman', 'Support'];
const PLAYER_SEARCH_NAME_KEY = 'sms_player_search_name';
const PLAYER_SEARCH_TAG_KEY = 'sms_player_search_tag';

export function ChampionSelect({ champions, version, onSelect, onCompanion, onOpenMatchHistory, hasLiveGame, onLiveGame }: Props) {
  const [search, setSearch] = useState('');
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

  const filtered = useMemo(() => {
    return champions.filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
      const matchesRole = selectedRole === 'All' || c.tags.includes(selectedRole);
      return matchesSearch && matchesRole;
    });
  }, [champions, search, selectedRole]);

  /** Group filtered champions by starting letter for dividers */
  const grouped = useMemo(() => {
    const groups: { letter: string; champions: ChampionBasic[] }[] = [];
    let currentLetter = '';
    for (const champ of filtered) {
      const letter = champ.name[0].toUpperCase();
      if (letter !== currentLetter) {
        currentLetter = letter;
        groups.push({ letter, champions: [champ] });
      } else {
        groups[groups.length - 1].champions.push(champ);
      }
    }
    return groups;
  }, [filtered]);

  const submitRiotHistory = useCallback(() => {
    const gameName = riotGameNameSearch.trim();
    const tagLine = riotTagSearch.trim();
    if (!gameName || !tagLine) return;
    onOpenMatchHistory(`${gameName}#${tagLine}`);
  }, [onOpenMatchHistory, riotGameNameSearch, riotTagSearch]);

  return (
    <div className="champion-select">
      {/* Background decorations */}
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

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
              placeholder="Search champions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
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
                onChange={e => setRiotGameNameSearch(e.target.value)}
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
                onChange={e => setRiotTagSearch(e.target.value)}
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

        <div className="role-filters">
          {ROLES.map(role => (
            <button
              key={role}
              className={`role-btn ${selectedRole === role ? 'active' : ''}`}
              onClick={() => setSelectedRole(role)}
            >
              {role}
            </button>
          ))}
        </div>

        <div className="champion-count">
          {filtered.length} Champion{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className={`champion-grid-wrapper${scrolled ? ' scrolled' : ''}`} onScroll={handleGridScroll}>
        <div className={`champion-grid${hoveredLetter ? ' letter-highlight' : ''}`}>
          {grouped.map((group, gi) => [
            ...(selectedRole === 'All' ? [
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
              return (
                <button
                  key={champion.id}
                  className={`champion-card${dimmed ? ' dimmed' : ''}`}
                  onClick={() => onSelect(champion)}
                  style={{ animationDelay: `${Math.min(i * 12, 600)}ms` }}
                >
                  <div className="champion-card-border" />
                  <div className="champion-card-image">
                    <img
                      src={getChampionIcon(champion.id, version)}
                      alt={champion.name}
                      loading="lazy"
                    />
                  </div>
                  <span className="champion-card-name">{champion.name}</span>
                </button>
              );
            }),
          ])}
        </div>
        {filtered.length === 0 && (
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

      {/* Bottom decorative border */}
      <div className="cs-bottom-border" />
    </div>
  );
}
