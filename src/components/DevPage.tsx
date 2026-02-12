import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ChampionBasic, LiveGamePlayer } from '../types';
import { PregameHeroFormation, BLUE_FORMATION_POSITIONS, RED_FORMATION_POSITIONS, DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_FOV, DEFAULT_LOOK_AT_Y } from './LiveGamePage';
import { sampleLiveGameData } from '../mockLiveGameData';
import './DevPage.css';

export interface AccountInfo {
  puuid: string;
  displayName: string;
  summonerId?: string;
  accountId?: number;
  platformId?: string;
}

const ROLE_ORDER: Record<string, number> = {
  TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4,
};

function sortByRole<T extends { position: string }>(players: T[]): T[] {
  return [...players].sort((a, b) => (ROLE_ORDER[a.position] ?? 99) - (ROLE_ORDER[b.position] ?? 99));
}

const SLOT_LABELS = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

/** Tool to manually adjust formation positions and copy the result for LiveGamePage.tsx */
function FormationPositionTool({
  blueTeam,
  redTeam,
  champions,
}: {
  blueTeam: LiveGamePlayer[];
  redTeam: LiveGamePlayer[];
  champions: ChampionBasic[];
}) {
  const [bluePos, setBluePos] = useState<[number, number, number][]>(() => BLUE_FORMATION_POSITIONS.map((p) => [p[0], p[1], p[2]]));
  const [redPos, setRedPos] = useState<[number, number, number][]>(() => RED_FORMATION_POSITIONS.map((p) => [p[0], p[1], p[2]]));
  const [camPos, setCamPos] = useState<[number, number, number]>(() => [...DEFAULT_CAMERA_POSITION]);
  const [camFov, setCamFov] = useState(DEFAULT_CAMERA_FOV);
  const [lookAtY, setLookAtY] = useState(DEFAULT_LOOK_AT_Y);
  const [showPanel, setShowPanel] = useState(false);
  const [copied, setCopied] = useState(false);

  const updateBlue = useCallback((i: number, axis: 0 | 1 | 2, value: number) => {
    setBluePos((prev) => {
      const next = prev.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
      next[i][axis] = value;
      return next;
    });
  }, []);

  const updateRed = useCallback((i: number, axis: 0 | 1 | 2, value: number) => {
    setRedPos((prev) => {
      const next = prev.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
      next[i][axis] = value;
      return next;
    });
  }, []);

  const updateCamPos = useCallback((axis: 0 | 1 | 2, value: number) => {
    setCamPos((prev) => {
      const next = [...prev];
      next[axis] = value;
      return next as [number, number, number];
    });
  }, []);

  const resetPositions = useCallback(() => {
    setBluePos(BLUE_FORMATION_POSITIONS.map((p) => [p[0], p[1], p[2]]));
    setRedPos(RED_FORMATION_POSITIONS.map((p) => [p[0], p[1], p[2]]));
    setCamPos([...DEFAULT_CAMERA_POSITION]);
    setCamFov(DEFAULT_CAMERA_FOV);
    setLookAtY(DEFAULT_LOOK_AT_Y);
  }, []);

  const copyToClipboard = useCallback(() => {
    const roleComments = ['/* Top */', '/* Jungle */', '/* Mid */', '/* Bot */', '/* Support */'];
    const lines = [
      '// Formation by role: [0]=Top, [1]=Jungle, [2]=Mid, [3]=Bot, [4]=Support',
      'const BLUE_FORMATION_POSITIONS: [number, number, number][] = [',
      ...bluePos.map((p, i) => `  [${p.map((n) => n.toFixed(2)).join(', ')}], ${roleComments[i]}`),
      '];',
      'const RED_FORMATION_POSITIONS: [number, number, number][] = [',
      ...redPos.map((p, i) => `  [${p.map((n) => n.toFixed(2)).join(', ')}], ${roleComments[i]}`),
      '];',
      '',
      '// Camera',
      `export const DEFAULT_CAMERA_POSITION: [number, number, number] = [${camPos.map((n) => n.toFixed(2)).join(', ')}];`,
      `export const DEFAULT_CAMERA_FOV = ${camFov};`,
      `export const DEFAULT_LOOK_AT_Y = ${lookAtY.toFixed(3)};`,
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [bluePos, redPos, camPos, camFov, lookAtY]);

  return (
    <>
      <div className="dev-hero-formation-wrap">
        <PregameHeroFormation
          blueTeam={blueTeam}
          redTeam={redTeam}
          champions={champions}
          bluePositions={bluePos}
          redPositions={redPos}
          cameraPosition={camPos}
          cameraFov={camFov}
          lookAtY={lookAtY}
        />
      </div>
      <div className="dev-formation-tool">
        <button
          type="button"
          className="dev-formation-tool-toggle"
          onClick={() => setShowPanel((s) => !s)}
          aria-expanded={showPanel}
        >
          {showPanel ? '▼' : '▶'} Formation Position Tool
        </button>
        {showPanel && (
          <div className="dev-formation-tool-panel">
            <p className="dev-formation-tool-desc">
              Positions are by role: Top, Jungle, Mid, Bot, Support. Adjust X (left/right), Y (up/down), Z (back/forward) for each role. Blue = left (negative X), Red = right (positive X).
            </p>
            <div className="dev-formation-tool-camera">
              <strong>Camera</strong>
              <div className="dev-formation-tool-camera-row">
                <span className="dev-formation-tool-label">Position</span>
                <label className="dev-formation-tool-slider-row">
                  <span>X</span>
                  <input type="range" min={-5} max={5} step={0.1} value={camPos[0]} onChange={(e) => updateCamPos(0, parseFloat(e.target.value))} />
                  <span className="dev-formation-tool-value">{camPos[0].toFixed(1)}</span>
                </label>
                <label className="dev-formation-tool-slider-row">
                  <span>Y</span>
                  <input type="range" min={0} max={4} step={0.1} value={camPos[1]} onChange={(e) => updateCamPos(1, parseFloat(e.target.value))} />
                  <span className="dev-formation-tool-value">{camPos[1].toFixed(1)}</span>
                </label>
                <label className="dev-formation-tool-slider-row">
                  <span>Z</span>
                  <input type="range" min={1} max={8} step={0.1} value={camPos[2]} onChange={(e) => updateCamPos(2, parseFloat(e.target.value))} />
                  <span className="dev-formation-tool-value">{camPos[2].toFixed(1)}</span>
                </label>
              </div>
              <div className="dev-formation-tool-camera-row">
                <span className="dev-formation-tool-label">FOV</span>
                <label className="dev-formation-tool-slider-row">
                  <input type="range" min={20} max={70} step={1} value={camFov} onChange={(e) => setCamFov(parseFloat(e.target.value))} />
                  <span className="dev-formation-tool-value">{camFov}°</span>
                </label>
              </div>
              <div className="dev-formation-tool-camera-row">
                <span className="dev-formation-tool-label">Look-at Y</span>
                <label className="dev-formation-tool-slider-row">
                  <input type="range" min={-1} max={3} step={0.1} value={lookAtY} onChange={(e) => setLookAtY(parseFloat(e.target.value))} />
                  <span className="dev-formation-tool-value">{lookAtY.toFixed(1)}</span>
                </label>
              </div>
            </div>
            <div className="dev-formation-tool-grid">
              <div className="dev-formation-tool-team">
                <strong>Blue (left)</strong>
                {bluePos.map((p, i) => (
                  <div key={`b-${i}`} className="dev-formation-tool-slot">
                    <span className="dev-formation-tool-label">{SLOT_LABELS[i]}</span>
                    <label className="dev-formation-tool-slider-row">
                      <span>X</span>
                      <input type="range" min={-7} max={7} step={0.1} value={p[0]} onChange={(e) => updateBlue(i, 0, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[0].toFixed(1)}</span>
                    </label>
                    <label className="dev-formation-tool-slider-row">
                      <span>Y</span>
                      <input type="range" min={-1} max={1} step={0.1} value={p[1]} onChange={(e) => updateBlue(i, 1, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[1].toFixed(1)}</span>
                    </label>
                    <label className="dev-formation-tool-slider-row">
                      <span>Z</span>
                      <input type="range" min={-3} max={2} step={0.1} value={p[2]} onChange={(e) => updateBlue(i, 2, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[2].toFixed(1)}</span>
                    </label>
                  </div>
                ))}
              </div>
              <div className="dev-formation-tool-team">
                <strong>Red (right)</strong>
                {redPos.map((p, i) => (
                  <div key={`r-${i}`} className="dev-formation-tool-slot">
                    <span className="dev-formation-tool-label">{SLOT_LABELS[i]}</span>
                    <label className="dev-formation-tool-slider-row">
                      <span>X</span>
                      <input type="range" min={-7} max={7} step={0.1} value={p[0]} onChange={(e) => updateRed(i, 0, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[0].toFixed(1)}</span>
                    </label>
                    <label className="dev-formation-tool-slider-row">
                      <span>Y</span>
                      <input type="range" min={-1} max={1} step={0.1} value={p[1]} onChange={(e) => updateRed(i, 1, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[1].toFixed(1)}</span>
                    </label>
                    <label className="dev-formation-tool-slider-row">
                      <span>Z</span>
                      <input type="range" min={-3} max={2} step={0.1} value={p[2]} onChange={(e) => updateRed(i, 2, parseFloat(e.target.value))} />
                      <span className="dev-formation-tool-value">{p[2].toFixed(1)}</span>
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div className="dev-formation-tool-actions">
              <button type="button" className="dev-formation-tool-btn" onClick={resetPositions}>
                Reset to default
              </button>
              <button type="button" className="dev-formation-tool-btn dev-formation-tool-btn--primary" onClick={copyToClipboard}>
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
            </div>
            <p className="dev-formation-tool-hint">
              Paste the copied code into LiveGamePage.tsx to replace BLUE_FORMATION_POSITIONS, RED_FORMATION_POSITIONS, and camera constants.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

interface Props {
  accountInfo: AccountInfo | null;
  champions: ChampionBasic[];
  onBack: () => void;
}

interface MatchHistoryResponse {
  matchIds: string[];
  region: string;
}

export function DevPage({ accountInfo, champions, onBack }: Props) {
  const sampleBlueTeam = useMemo(
    () => sortByRole(sampleLiveGameData.players.filter((p) => p.team === 'ORDER')),
    [],
  );
  const sampleRedTeam = useMemo(
    () => sortByRole(sampleLiveGameData.players.filter((p) => p.team === 'CHAOS')),
    [],
  );
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [region, setRegion] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountInfo?.puuid) {
      setMatchIds([]);
      setRegion('');
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      puuid: accountInfo.puuid,
      count: '20',
    });
    if (accountInfo.platformId) params.set('platformId', accountInfo.platformId);

    fetch(`/api/match-history?${params}`)
      .then((res) => res.json())
      .then((data: MatchHistoryResponse | { error?: string; details?: string }) => {
        if (cancelled) return;
        if ('error' in data && data.error) {
          setError(data.error + (data.details ? `: ${data.details}` : ''));
          setMatchIds([]);
        } else {
          const ok = data as MatchHistoryResponse;
          setMatchIds(ok.matchIds ?? []);
          setRegion(ok.region ?? '');
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch match history');
          setMatchIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [accountInfo?.puuid, accountInfo?.platformId]);

  return (
    <div className="dev-page">
      <div className="dev-bg-glow" />
      <div className="dev-content">
        <button className="dev-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h1 className="dev-title">Dev</h1>
        <p className="dev-subtitle">Companion & Riot API data for development</p>

        {/* Account info from companion */}
        <section className="dev-section">
          <h2>Account (from Companion)</h2>
          {accountInfo ? (
            <div className="dev-card dev-account">
              <div className="dev-row">
                <span className="dev-label">Display Name</span>
                <span className="dev-value">{accountInfo.displayName}</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">PUUID</span>
                <code className="dev-code">{accountInfo.puuid}</code>
              </div>
              {accountInfo.platformId && (
                <div className="dev-row">
                  <span className="dev-label">Platform</span>
                  <span className="dev-value">{accountInfo.platformId}</span>
                </div>
              )}
              {accountInfo.summonerId && (
                <div className="dev-row">
                  <span className="dev-label">Summoner ID</span>
                  <code className="dev-code">{accountInfo.summonerId}</code>
                </div>
              )}
            </div>
          ) : (
            <p className="dev-empty">
              No account data. Start the Companion app and have the League client open (logged in) to receive PUUID and display name.
            </p>
          )}
        </section>

        {/* Match history from Riot API */}
        <section className="dev-section">
          <h2>Match History (Riot Match-v5)</h2>
          {accountInfo?.puuid ? (
            <>
              {loading && <p className="dev-loading">Loading match IDs…</p>}
              {error && <p className="dev-error">{error}</p>}
              {!loading && !error && (
                <div className="dev-card">
                  {region && (
                    <div className="dev-row">
                      <span className="dev-label">Region</span>
                      <span className="dev-value">{region}</span>
                    </div>
                  )}
                  <div className="dev-row">
                    <span className="dev-label">Match IDs</span>
                    <span className="dev-value">{matchIds.length} recent</span>
                  </div>
                  {matchIds.length > 0 ? (
                    <ul className="dev-match-list">
                      {matchIds.map((id) => (
                        <li key={id} className="dev-match-id">
                          <code>{id}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dev-empty-inline">No matches returned.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="dev-empty">
              Account PUUID required. Connect the Companion app with the League client open.
            </p>
          )}
        </section>

        {/* Pregame hero formation sample */}
        <section className="dev-section">
          <h2>Pregame Hero Formation (Sample)</h2>
          <p className="dev-hero-desc">
            Preview of the pregame lineup shown on the live page before the match starts. All 10 champions in a V formation.
          </p>
          <FormationPositionTool
            blueTeam={sampleBlueTeam}
            redTeam={sampleRedTeam}
            champions={champions}
          />
        </section>

        {/* API key reminder */}
        <section className="dev-section dev-api-note">
          <h2>API Key</h2>
          <p>
            Match history uses a Riot API key. Set <code>RIOT_API_KEY</code> in Vercel Environment Variables for production, or in <code>.env.local</code> when running locally with <code>vercel dev</code>.
          </p>
        </section>
      </div>
    </div>
  );
}
