import { useState, useEffect } from 'react';
import './DevPage.css';

export interface AccountInfo {
  puuid: string;
  displayName: string;
  summonerId?: string;
  accountId?: number;
  platformId?: string;
}

export interface CompanionLiveDebug {
  companionConnected: boolean;
  lastMessageAt: number | null;
  lastMessageType: string;
  lastMessageSummary: string;
  messageCounts: Record<string, number>;
  parseErrorCount: number;
  liveUpdateCount: number;
  liveEndCount: number;
  lastLiveUpdateAt: number | null;
  lastLiveUpdateIntervalMs: number | null;
  latestLivePayload: unknown;
  latestLiveEndPayload: unknown;
  logs: CompanionLogEntry[];
  activeMatch: CompanionMatchTrace | null;
  completedMatches: CompanionMatchTrace[];
  nextMatchId: number;
}

export interface CompanionLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
  payload?: unknown;
}

export interface CompanionMatchEvent {
  ts: number;
  source: string;
  message: string;
  payload?: unknown;
}

export interface CompanionMatchTrace {
  id: number;
  startedAt: number;
  endedAt: number | null;
  result?: string;
  events: CompanionMatchEvent[];
}

interface Props {
  accountInfo: AccountInfo | null;
  liveDebug: CompanionLiveDebug;
  stayOnDevDuringLive: boolean;
  onStayOnDevDuringLiveChange: (enabled: boolean) => void;
  onBack: () => void;
}

interface MatchHistoryResponse {
  matchIds: string[];
  region: string;
}

function formatAgeMs(ms: number | null): string {
  if (ms === null) return 'Never';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function freshnessStatus(ageMs: number | null): 'ok' | 'warn' | 'error' {
  if (ageMs === null) return 'error';
  if (ageMs <= 6000) return 'ok';
  if (ageMs <= 15000) return 'warn';
  return 'error';
}

export function DevPage({
  accountInfo,
  liveDebug,
  stayOnDevDuringLive,
  onStayOnDevDuringLiveChange,
  onBack,
}: Props) {
  const [matchIds, setMatchIds] = useState<string[]>([]);
  const [region, setRegion] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const lastMsgAge = liveDebug.lastMessageAt ? now - liveDebug.lastMessageAt : null;
  const lastLiveAge = liveDebug.lastLiveUpdateAt ? now - liveDebug.lastLiveUpdateAt : null;
  const liveStatus = freshnessStatus(lastLiveAge);
  const latestCompletedMatch = liveDebug.completedMatches.length > 0
    ? liveDebug.completedMatches[liveDebug.completedMatches.length - 1]
    : null;

  const downloadJson = (filenamePrefix: string, payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenamePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadLogs = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
      accountInfo,
      liveDebug,
    };
    downloadJson('x9report-dev-log', report);
  };

  const handleDownloadActiveMatch = () => {
    if (!liveDebug.activeMatch) return;
    downloadJson(`x9report-match-${liveDebug.activeMatch.id}`, {
      generatedAt: new Date().toISOString(),
      match: liveDebug.activeMatch,
    });
  };

  const handleDownloadLatestCompletedMatch = () => {
    if (!latestCompletedMatch) return;
    downloadJson(`x9report-match-${latestCompletedMatch.id}`, {
      generatedAt: new Date().toISOString(),
      match: latestCompletedMatch,
    });
  };

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

        {/* Live API stream inspector */}
        <section className="dev-section">
          <h2>Live Broadcast Inspector</h2>
          <div className="dev-card dev-live-inspector">
            <div className="dev-live-grid">
              <div className="dev-row">
                <span className="dev-label">Companion Socket</span>
                <span className={`dev-badge ${liveDebug.companionConnected ? 'dev-badge--ok' : 'dev-badge--error'}`}>
                  {liveDebug.companionConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Live Update Freshness</span>
                <span className={`dev-badge ${liveStatus === 'ok' ? 'dev-badge--ok' : liveStatus === 'warn' ? 'dev-badge--warn' : 'dev-badge--error'}`}>
                  {formatAgeMs(lastLiveAge)} ago
                </span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Last Message Type</span>
                <span className="dev-value">{liveDebug.lastMessageType || 'None'}</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Last Message Age</span>
                <span className="dev-value">{formatAgeMs(lastMsgAge)} ago</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Live Update Count</span>
                <span className="dev-value">{liveDebug.liveUpdateCount}</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Live End Count</span>
                <span className="dev-value">{liveDebug.liveEndCount}</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Update Interval</span>
                <span className="dev-value">{formatAgeMs(liveDebug.lastLiveUpdateIntervalMs)}</span>
              </div>
              <div className="dev-row">
                <span className="dev-label">Parse Errors</span>
                <span className={`dev-value ${liveDebug.parseErrorCount > 0 ? 'dev-text-error' : 'dev-text-ok'}`}>
                  {liveDebug.parseErrorCount}
                </span>
              </div>
            </div>

            <div className="dev-row">
              <span className="dev-label">Last Message Summary</span>
              <code className="dev-code">{liveDebug.lastMessageSummary || '(no summary)'}</code>
            </div>

            <div className="dev-row dev-toggle-row">
              <span className="dev-label">Auto Navigation</span>
              <label className="dev-toggle">
                <input
                  type="checkbox"
                  checked={stayOnDevDuringLive}
                  onChange={(e) => onStayOnDevDuringLiveChange(e.target.checked)}
                />
                <span>Stay On Dev During Live</span>
              </label>
            </div>

            <div className="dev-log-actions">
              <button className="dev-log-btn dev-log-btn--primary" onClick={handleDownloadLogs}>
                Download Full Debug
              </button>
              <button
                className="dev-log-btn"
                onClick={handleDownloadActiveMatch}
                disabled={!liveDebug.activeMatch}
              >
                Download Active Match
              </button>
              <button
                className="dev-log-btn"
                onClick={handleDownloadLatestCompletedMatch}
                disabled={!latestCompletedMatch}
              >
                Download Last Completed Match
              </button>
            </div>

            <div className="dev-row">
              <span className="dev-label">Match Recorder</span>
              <span className="dev-value">
                {liveDebug.activeMatch
                  ? `Recording match #${liveDebug.activeMatch.id} (${liveDebug.activeMatch.events.length} events)`
                  : 'No active match recording'}
              </span>
              <span className="dev-value">
                Completed recordings: {liveDebug.completedMatches.length}
              </span>
            </div>

            <div className="dev-row">
              <span className="dev-label">Message Type Counts</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.messageCounts, null, 2)}</pre>
            </div>

            <div className="dev-row">
              <span className="dev-label">Latest liveGameUpdate Payload</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.latestLivePayload, null, 2)}</pre>
            </div>

            <div className="dev-row">
              <span className="dev-label">Latest liveGameEnd Payload</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.latestLiveEndPayload, null, 2)}</pre>
            </div>

            <div className="dev-row">
              <span className="dev-label">Runtime Logs ({liveDebug.logs.length})</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.logs, null, 2)}</pre>
            </div>

            <div className="dev-row">
              <span className="dev-label">Active Match Timeline</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.activeMatch, null, 2)}</pre>
            </div>

            <div className="dev-row">
              <span className="dev-label">Completed Match Timelines</span>
              <pre className="dev-json">{JSON.stringify(liveDebug.completedMatches, null, 2)}</pre>
            </div>
          </div>
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
