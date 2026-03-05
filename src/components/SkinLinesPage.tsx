import { useMemo, useState } from 'react';
import { getChampionIcon, getSplashArt, getSplashArtFallback } from '../api';
import type { ChampionBasic, SkinLineCategory, SkinLineMember } from '../types';
import './SkinLinesPage.css';

interface Props {
  skinLines: SkinLineCategory[];
  version: string;
  champions: ChampionBasic[];
  onBack: () => void;
  onOpenLine: (line: SkinLineCategory) => void;
  onOpenMember: (line: SkinLineCategory, member: SkinLineMember) => void;
}

export function SkinLinesPage({
  skinLines,
  version,
  champions,
  onBack,
  onOpenLine,
  onOpenMember,
}: Props) {
  const [search, setSearch] = useState('');
  const [drawerLine, setDrawerLine] = useState<SkinLineCategory | null>(null);
  const [drawerSearch, setDrawerSearch] = useState('');
  const [drawerRole, setDrawerRole] = useState('All');
  const previewMembers = useMemo(() => {
    const byLine = new Map<number, SkinLineMember>();
    for (const line of skinLines) {
      if (line.members.length === 0) continue;
      const idx = Math.floor(Math.random() * line.members.length);
      byLine.set(line.id, line.members[idx]);
    }
    return byLine;
  }, [skinLines]);
  const championById = useMemo(
    () => Object.fromEntries(champions.map((champ) => [champ.id.toLowerCase(), champ])),
    [champions],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return skinLines;
    return skinLines.filter((line) => line.name.toLowerCase().includes(term));
  }, [search, skinLines]);

  const drawerChampions = useMemo(() => {
    if (!drawerLine) return [];
    const grouped = new Map<string, {
      championId: string;
      championName: string;
      roles: string[];
      skinCount: number;
      firstMember: SkinLineMember;
    }>();
    for (const member of drawerLine.members) {
      const key = member.championId.toLowerCase();
      const champion = championById[key];
      if (!grouped.has(key)) {
        grouped.set(key, {
          championId: member.championId,
          championName: member.championName,
          roles: champion?.tags ?? [],
          skinCount: 1,
          firstMember: member,
        });
      } else {
        grouped.get(key)!.skinCount += 1;
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.championName.localeCompare(b.championName));
  }, [drawerLine, championById]);

  const drawerRoleOptions = useMemo(() => {
    const roles = new Set<string>();
    for (const champ of drawerChampions) {
      for (const role of champ.roles) roles.add(role);
    }
    return ['All', ...Array.from(roles).sort((a, b) => a.localeCompare(b))];
  }, [drawerChampions]);

  const filteredDrawerChampions = useMemo(() => {
    const term = drawerSearch.trim().toLowerCase();
    return drawerChampions.filter((champ) => {
      const matchesRole = drawerRole === 'All' || champ.roles.includes(drawerRole);
      const matchesSearch = !term || champ.championName.toLowerCase().includes(term);
      return matchesRole && matchesSearch;
    });
  }, [drawerChampions, drawerRole, drawerSearch]);

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
          <button
            key={line.id}
            className="skin-line-card"
            onClick={() => onOpenLine(line)}
          >
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
            <button
              className="skin-line-card-count"
              onClick={(event) => {
                event.stopPropagation();
                setDrawerLine(line);
                setDrawerSearch('');
                setDrawerRole('All');
              }}
              aria-label={`View champions in ${line.name}`}
            >
              {line.members.length}
            </button>
          </button>
        ))}
      </div>

      {drawerLine && (
        <div className="skin-line-drawer-overlay" onClick={() => setDrawerLine(null)}>
          <aside className="skin-line-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="skin-line-drawer-head">
              <div className="skin-line-drawer-title-wrap">
                <span className="skin-line-drawer-kicker">Champion Roster</span>
                <h3>{drawerLine.name}</h3>
              </div>
              <button className="skin-line-drawer-close" onClick={() => setDrawerLine(null)} aria-label="Close roster">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="skin-line-drawer-controls">
              <input
                className="skin-line-drawer-search"
                placeholder="Search champions..."
                value={drawerSearch}
                onChange={(event) => setDrawerSearch(event.target.value)}
              />
              <div className="skin-line-drawer-roles">
                {drawerRoleOptions.map((role) => (
                  <button
                    key={role}
                    className={`skin-line-drawer-role-btn${drawerRole === role ? ' active' : ''}`}
                    onClick={() => setDrawerRole(role)}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            <div className="skin-line-drawer-list">
              {filteredDrawerChampions.map((champ) => (
                <button
                  key={`${drawerLine.id}-${champ.championId}`}
                  className="skin-line-drawer-row"
                  onClick={() => onOpenMember(drawerLine, champ.firstMember)}
                >
                  <img
                    src={getChampionIcon(champ.championId, version)}
                    alt={champ.championName}
                    loading="lazy"
                  />
                  <div className="skin-line-drawer-row-main">
                    <span className="skin-line-drawer-row-name">{champ.championName}</span>
                    <span className="skin-line-drawer-row-meta">
                      {champ.roles.length > 0 ? champ.roles.join(' / ') : 'Champion'}
                    </span>
                  </div>
                  <span className="skin-line-drawer-row-count">{champ.skinCount}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
