import { useEffect, useMemo, useState } from 'react';
import './MatchHistoryPage.css';

type Region = 'americas' | 'europe' | 'asia' | 'sea';

interface MatchSummary {
  matchId: string;
  gameMode: string;
  gameDuration: number;
  gameEndTimestamp: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
}

interface HistoryResponse {
  region: Region;
  puuid: string;
  gameName: string;
  tagLine: string;
  matches: MatchSummary[];
}

interface Props {
  initialRiotId?: string;
  onBack: () => void;
}

function splitRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const idx = trimmed.indexOf('#');
  if (idx <= 0 || idx === trimmed.length - 1) return null;
  const gameName = trimmed.slice(0, idx).trim();
  const tagLine = trimmed.slice(idx + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

export function MatchHistoryPage({ initialRiotId = '', onBack }: Props) {
  const [riotId, setRiotId] = useState(initialRiotId);
  const [region, setRegion] = useState<Region>('americas');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryResponse | null>(null);

  useEffect(() => {
    setRiotId(initialRiotId);
  }, [initialRiotId]);

  const parsed = useMemo(() => splitRiotId(riotId), [riotId]);

  const runSearch = async () => {
    if (!parsed) {
      setError('Enter Riot ID as GameName#TagLine');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        gameName: parsed.gameName,
        tagLine: parsed.tagLine,
        region,
        count: '20',
      });
      const res = await fetch(`/api/riot-id-history?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        const msg = typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`;
        const details = typeof body?.details === 'string' && body.details ? `: ${body.details}` : '';
        throw new Error(`${msg}${details}`);
      }
      setResult(body as HistoryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch match history');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mh-page">
      <div className="mh-content">
        <button className="mh-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h1 className="mh-title">Match History</h1>
        <p className="mh-subtitle">Search any Riot ID to view recent matches</p>

        <div className="mh-form">
          <div className="mh-field">
            <label>Riot ID</label>
            <input
              type="text"
              value={riotId}
              onChange={(e) => setRiotId(e.target.value)}
              placeholder="GameName#TagLine"
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch();
              }}
            />
          </div>
          <div className="mh-field mh-field--region">
            <label>Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value as Region)}>
              <option value="americas">Americas</option>
              <option value="europe">Europe</option>
              <option value="asia">Asia</option>
              <option value="sea">SEA</option>
            </select>
          </div>
          <button className="mh-search-btn" onClick={runSearch} disabled={loading}>
            {loading ? 'Loading...' : 'Search'}
          </button>
        </div>

        {error && <p className="mh-error">{error}</p>}

        {result && (
          <>
            <div className="mh-summary">
              <span>{result.gameName}#{result.tagLine}</span>
              <span>{result.matches.length} matches</span>
              <span>{result.region}</span>
            </div>

            <div className="mh-list">
              {result.matches.map((m) => (
                <div key={m.matchId} className="mh-card">
                  <div className="mh-row">
                    <span className={`mh-result ${m.win ? 'mh-result--win' : 'mh-result--loss'}`}>
                      {m.win ? 'Win' : 'Loss'}
                    </span>
                    <span>{m.championName}</span>
                    <span>{m.kills}/{m.deaths}/{m.assists}</span>
                  </div>
                  <div className="mh-row mh-row--meta">
                    <span>{m.gameMode}</span>
                    <span>{formatDuration(m.gameDuration)}</span>
                    <span>{formatDate(m.gameEndTimestamp)}</span>
                  </div>
                  <code className="mh-id">{m.matchId}</code>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

