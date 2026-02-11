import { useState, useEffect } from 'react';
import './DevPage.css';

export interface AccountInfo {
  puuid: string;
  displayName: string;
  summonerId?: string;
  accountId?: number;
  platformId?: string;
}

interface Props {
  accountInfo: AccountInfo | null;
  onBack: () => void;
}

interface MatchHistoryResponse {
  matchIds: string[];
  region: string;
}

export function DevPage({ accountInfo, onBack }: Props) {
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
