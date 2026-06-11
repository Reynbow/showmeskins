import { useCallback, useMemo, useState } from 'react';
import type { SkinLineCategory } from '../types';
import { getSplashArt, getSplashArtFallback } from '../api';
import { computeSharedSkinLines } from '../utils/skinLineCompare';
import { AmbientBackground } from './AmbientBackground';
import './SkinLinesPage.css';
import './TeamSkinLinesPage.css';

type Region =
  | 'br1' | 'eun1' | 'euw1' | 'jp1' | 'kr' | 'la1' | 'la2' | 'na1' | 'oc1' | 'tr1' | 'ru'
  | 'ph2' | 'sg2' | 'th2' | 'tw2' | 'vn2';

const REGIONS: { id: Region; label: string }[] = [
  { id: 'na1', label: 'NA' },
  { id: 'euw1', label: 'EUW' },
  { id: 'eun1', label: 'EUNE' },
  { id: 'kr', label: 'KR' },
  { id: 'br1', label: 'BR' },
  { id: 'oc1', label: 'OCE' },
  { id: 'jp1', label: 'JP' },
  { id: 'tr1', label: 'TR' },
  { id: 'la1', label: 'LAN' },
  { id: 'la2', label: 'LAS' },
];

const SLOT_COUNT = 5;
const MANUAL_SKINS_KEY = 'sms_manual_skin_ids';

interface PlayerSlot {
  gameName: string;
  tagLine: string;
}

interface PlayerSkinResult {
  slotIndex: number;
  gameName: string;
  tagLine: string;
  puuid: string;
  skinIds: string[];
  matchesScanned: number;
  error?: string;
}

interface Props {
  skinLines: SkinLineCategory[];
  onBack: () => void;
}

function splitRiotId(input: string): { gameName: string; tagLine: string } {
  const hash = input.indexOf('#');
  if (hash === -1) return { gameName: input.trim(), tagLine: '' };
  return {
    gameName: input.slice(0, hash).trim(),
    tagLine: input.slice(hash + 1).trim(),
  };
}

function loadManualSkins(puuid: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${MANUAL_SKINS_KEY}_${puuid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveManualSkins(puuid: string, skinIds: string[]): void {
  try {
    window.localStorage.setItem(`${MANUAL_SKINS_KEY}_${puuid}`, JSON.stringify(skinIds));
  } catch {
    // ignore
  }
}

async function readApiJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      'API returned an empty response. Run `npm run dev:api` alongside `npm run dev`.',
    );
  }
  return JSON.parse(text) as Record<string, unknown>;
}

export function TeamSkinLinesPage({ skinLines, onBack }: Props) {
  const [region, setRegion] = useState<Region>('oc1');
  const [slots, setSlots] = useState<PlayerSlot[]>(() =>
    Array.from({ length: SLOT_COUNT }, () => ({ gameName: '', tagLine: '' })),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PlayerSkinResult[] | null>(null);
  const [manualDraft, setManualDraft] = useState<Record<string, string>>({});

  const updateSlot = (index: number, patch: Partial<PlayerSlot>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const fillFromRiotId = (index: number, riotId: string) => {
    const parsed = splitRiotId(riotId);
    updateSlot(index, parsed);
  };

  const fetchPlayerSkins = async (slot: PlayerSlot, index: number): Promise<PlayerSkinResult> => {
    const gameName = slot.gameName.trim();
    const tagLine = slot.tagLine.trim();
    if (!gameName || !tagLine) {
      return {
        slotIndex: index,
        gameName,
        tagLine,
        puuid: '',
        skinIds: [],
        matchesScanned: 0,
        error: 'Enter game name and tag',
      };
    }

    const params = new URLSearchParams({ region, gameName, tagLine, maxMatches: '25' });
    const res = await fetch(`/api/player-skins?${params.toString()}`);
    const body = await readApiJson(res);
    if (!res.ok) {
      const msg = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
      return {
        slotIndex: index,
        gameName,
        tagLine,
        puuid: '',
        skinIds: [],
        matchesScanned: 0,
        error: msg,
      };
    }

    const puuid = typeof body.puuid === 'string' ? body.puuid : '';
    const apiSkins = Array.isArray(body.skinIds)
      ? body.skinIds.filter((id): id is string => typeof id === 'string')
      : [];
    const manual = puuid ? loadManualSkins(puuid) : [];
    const merged = Array.from(new Set([...apiSkins, ...manual]));

    return {
      slotIndex: index,
      gameName: typeof body.gameName === 'string' ? body.gameName : gameName,
      tagLine: typeof body.tagLine === 'string' ? body.tagLine : tagLine,
      puuid,
      skinIds: merged,
      matchesScanned: typeof body.matchesScanned === 'number' ? body.matchesScanned : 0,
    };
  };

  const runCompare = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const filled = slots.filter((s) => s.gameName.trim() && s.tagLine.trim());
      if (filled.length < 2) {
        setError('Enter at least two Riot IDs (game name + tag).');
        return;
      }

      const playerResults = await Promise.all(
        slots.map((slot, index) => fetchPlayerSkins(slot, index)),
      );

      const failures = playerResults.filter((p) => p.error && p.gameName && p.tagLine);
      if (failures.length === playerResults.filter((p) => p.gameName && p.tagLine).length) {
        setError(failures[0]?.error ?? 'All lookups failed');
        setResults(playerResults);
        return;
      }

      setResults(playerResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comparison failed');
    } finally {
      setLoading(false);
    }
  }, [region, slots]);

  const comparison = useMemo(() => {
    if (!results) return null;
    const active = results.filter((p) => p.puuid && p.skinIds.length >= 0 && !p.error);
    const withSkins = results.filter((p) => p.puuid && !p.error);
    if (withSkins.length < 2) return null;
    return computeSharedSkinLines(
      skinLines,
      withSkins.map((p) => p.skinIds),
    );
  }, [results, skinLines]);

  const addManualSkin = (puuid: string, skinIdRaw: string) => {
    const skinId = skinIdRaw.trim();
    if (!skinId || !/^\d+$/.test(skinId)) return;
    const existing = loadManualSkins(puuid);
    if (existing.includes(skinId)) return;
    const next = [...existing, skinId];
    saveManualSkins(puuid, next);
    setResults((prev) => {
      if (!prev) return prev;
      return prev.map((p) =>
        p.puuid === puuid ? { ...p, skinIds: Array.from(new Set([...p.skinIds, skinId])) } : p,
      );
    });
    setManualDraft((prev) => ({ ...prev, [puuid]: '' }));
  };

  const activeCount = results?.filter((p) => p.puuid && !p.error).length ?? 0;

  return (
    <div className="team-skin-page skin-lines-page">
      <AmbientBackground />

      <div className="skin-lines-header">
        <button type="button" className="skin-lines-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="skin-lines-brand">
          <div className="skin-lines-logo">
            <svg viewBox="0 0 40 40" fill="none" className="skin-lines-logo-icon">
              <path d="M20 4L36 12V28L20 36L4 28V12L20 4Z" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <h1 className="skin-lines-title"><span className="skin-lines-title-x">x</span>9report.com</h1>
          <div className="skin-lines-subtitle">Team Skin Lines</div>
        </div>
      </div>

      <div className="team-skin-scroll">
        <p className="team-skin-note">
          Hidden team tool: enter five Riot IDs to find skin lines everyone shares. Skins are inferred from
          recent match history (Riot does not expose full inventories). Add missing skins manually with a
          skin ID if needed.
        </p>

        <div className="team-skin-region">
          <select value={region} onChange={(e) => setRegion(e.target.value as Region)} aria-label="Region">
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="team-skin-roster">
          {slots.map((slot, index) => (
            <div key={index} className="team-skin-row">
              <label>{index + 1}</label>
              <input
                type="text"
                placeholder="Game name"
                value={slot.gameName}
                onChange={(e) => updateSlot(index, { gameName: e.target.value })}
                onBlur={(e) => {
                  if (e.target.value.includes('#')) fillFromRiotId(index, e.target.value);
                }}
              />
              <input
                type="text"
                placeholder="Tag (or paste Name#TAG in game name)"
                value={slot.tagLine}
                onChange={(e) => updateSlot(index, { tagLine: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="team-skin-actions">
          <button
            type="button"
            className="team-skin-compare-btn"
            disabled={loading}
            onClick={() => void runCompare()}
          >
            {loading ? 'Scanning…' : 'Compare skin lines'}
          </button>
        </div>

        {error && <p className="team-skin-error">{error}</p>}

        {results && (
          <div className="team-skin-results">
            <h2>
              {comparison && comparison.fullTeam.length > 0
                ? `${comparison.fullTeam.length} skin line${comparison.fullTeam.length === 1 ? '' : 's'} shared by all ${activeCount} players`
                : 'No skin line shared by everyone'}
            </h2>

            {comparison?.fullTeam.map(({ line, byPlayer }) => {
              const preview = line.members[0];
              const withSkins = results.filter((p) => p.puuid && !p.error);
              return (
                <div key={line.id} className="team-skin-line-card">
                  <h3>{line.name}</h3>
                  {preview && (
                    <div className="skin-line-card-preview" style={{ maxWidth: 200, marginBottom: 12 }}>
                      <img
                        src={getSplashArt(preview.championId, preview.skinNum)}
                        alt=""
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = getSplashArtFallback(preview.championId, preview.skinNum);
                        }}
                      />
                    </div>
                  )}
                  <div className="team-skin-player-grid">
                    {results.map((player, colIndex) => {
                      const wsIndex = withSkins.findIndex((w) => w.puuid === player.puuid);
                      const owned = wsIndex >= 0 ? (byPlayer[wsIndex] ?? []) : [];
                      const label = player.gameName
                        ? `${player.gameName}#${player.tagLine}`
                        : `Player ${colIndex + 1}`;
                      return (
                        <div key={colIndex} className="team-skin-player-col">
                          <h4>{label}</h4>
                          {player.error ? (
                            <span className="none">{player.error}</span>
                          ) : owned.length === 0 ? (
                            <span className="none">No skin in this line</span>
                          ) : (
                            <ul>
                              {owned.map((m) => (
                                <li key={m.skinId}>{m.championName} — {m.skinName}</li>
                              ))}
                            </ul>
                          )}
                          {player.puuid && !player.error && (
                            <div className="team-skin-manual-add">
                              <input
                                type="text"
                                placeholder="Skin ID"
                                value={manualDraft[player.puuid] ?? ''}
                                onChange={(e) =>
                                  setManualDraft((prev) => ({ ...prev, [player.puuid]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    addManualSkin(player.puuid, manualDraft[player.puuid] ?? '');
                                  }
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => addManualSkin(player.puuid, manualDraft[player.puuid] ?? '')}
                              >
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {comparison && comparison.nearTeam.length > 0 && (
              <>
                <h2>Almost shared ({activeCount - 1} of {activeCount})</h2>
                <div className="team-skin-near">
                  {comparison.nearTeam.slice(0, 12).map(({ line, count, total }) => (
                    <span key={line.id} className="team-skin-near-chip">
                      {line.name} ({count}/{total})
                    </span>
                  ))}
                </div>
              </>
            )}

            <h2>Per-player scan</h2>
            {results.map((player) => (
              <div key={player.slotIndex} className="team-skin-line-card">
                <h3>
                  {player.gameName ? `${player.gameName}#${player.tagLine}` : `Slot ${player.slotIndex + 1}`}
                </h3>
                {player.error ? (
                  <p className="team-skin-player-status">{player.error}</p>
                ) : (
                  <p className="team-skin-player-status">
                    {player.skinIds.length} skins from {player.matchesScanned} recent matches
                    {loadManualSkins(player.puuid).length > 0
                      ? ` (+${loadManualSkins(player.puuid).length} manual)`
                      : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
