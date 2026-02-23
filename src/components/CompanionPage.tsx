import './CompanionPage.css';

interface Props {
  onBack: () => void;
  onDev?: () => void;
  hasLiveGame?: boolean;
  onLiveGame?: () => void;
}

const DOWNLOAD_URL =
  'https://github.com/Reynbow/showmeskins/releases/latest/download/x9report.Companion.Setup.exe';

export function CompanionPage({ onBack, onDev, hasLiveGame, onLiveGame }: Props) {
  return (
    <div className="companion-page">
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

      <div className="companion-content">
        {/* Header */}
        <div className="companion-header-row">
          <button className="companion-back" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          {hasLiveGame && onLiveGame && (
            <button className="companion-live-game-btn" onClick={onLiveGame} title="View live game">
              <span className="companion-live-game-dot" />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="companion-live-game-icon">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Live Game
            </button>
          )}
        </div>

        <div className="companion-header">
          <div className="companion-logo">
            <svg viewBox="0 0 40 40" fill="none" className="companion-logo-icon">
              <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            </svg>
          </div>
          <h1 className="companion-title">Companion App <span className="companion-beta-badge">Beta</span></h1>
          <p className="companion-subtitle">
            Enhance your match history with real-time game data
          </p>
        </div>

        {/* Download section */}
        <div className="companion-download-section">
          <a
            href={DOWNLOAD_URL}
            className="companion-download-btn"
            download
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="download-icon">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download
          </a>
          <span className="companion-version">v0.4.0 Beta &middot; Windows 10/11</span>
        </div>

        {/* What it does */}
        <div className="companion-section">
          <h2 className="companion-section-title">What does it do?</h2>
          <p className="companion-section-text">
            The companion app runs in your system tray and connects to your League of Legends 
            client, feeding live data directly into your match history page on x9report.com.
          </p>
          <ul className="companion-feature-list">
            <li>
              <strong>Champion Select Sync:</strong> Detects your champion and skin pick in 
              real time and opens the 3D model viewer automatically.
            </li>
            <li>
              <strong>Live Game Data:</strong> While you play, the companion streams real-time 
              KDA, items, CS, levels, ward score, and summoner spells for all players directly 
              into the match history scoreboard.
            </li>
            <li>
              <strong>Auto-detect &amp; Navigate:</strong> When a game starts, x9report.com 
              automatically opens the match history page with your account loaded and the 
              live scoreboard expanded.
            </li>
            <li>
              <strong>Fill Missing Data:</strong> The Riot web API can&apos;t provide 
              everything during a live game. The companion fills in player positions, items, 
              CS, levels, kill/death status, and more that the API can&apos;t access.
            </li>
          </ul>
        </div>

        {/* How it works */}
        <div className="companion-section">
          <h2 className="companion-section-title">How it works</h2>
          <div className="companion-steps">
            <div className="companion-step">
              <div className="companion-step-number">1</div>
              <div className="companion-step-content">
                <h3>Install &amp; launch</h3>
                <p>Run the installer and the app starts in your system tray. Look for the hexagon icon.</p>
              </div>
            </div>
            <div className="companion-step">
              <div className="companion-step-number">2</div>
              <div className="companion-step-content">
                <h3>Open x9report.com</h3>
                <p>The website detects the companion automatically - no setup required. A connection indicator appears when linked.</p>
              </div>
            </div>
            <div className="companion-step">
              <div className="companion-step-number">3</div>
              <div className="companion-step-content">
                <h3>Play a game</h3>
                <p>Start a match in League of Legends. The website navigates to your match history and opens a live scoreboard with real-time stats powered by the companion.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="companion-section">
          <h2 className="companion-section-title">Details</h2>
          <div className="companion-details">
            <div className="companion-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
              </svg>
              <div>
                <h3>System tray only</h3>
                <p>No application window. Right-click the tray icon for options including an auto-start toggle.</p>
              </div>
            </div>
            <div className="companion-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <h3>Safe &amp; non-intrusive</h3>
                <p>Uses the League client&apos;s local API. Does not modify game files or provide any gameplay changes.</p>
              </div>
            </div>
            <div className="companion-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 14a1 1 0 01-.78-1.63l9.9-10.2a.5.5 0 01.86.46l-1.92 6.02A1 1 0 0013 10h7a1 1 0 01.78 1.63l-9.9 10.2a.5.5 0 01-.86-.46l1.92-6.02A1 1 0 0011 14z" />
              </svg>
              <div>
                <h3>Optional start on login</h3>
                <p>Choose during install or toggle from the tray menu. The website works normally without it.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Dev tools link */}
        {onDev && (
          <div className="companion-section">
            <button
              type="button"
              className="companion-dev-btn"
              onClick={onDev}
            >
              Dev: Account &amp; Match History
            </button>
          </div>
        )}

        {/* Source code link */}
        <div className="companion-section companion-source">
          <a
            href="https://github.com/Reynbow/showmeskins/tree/main/companion"
            target="_blank"
            rel="noopener noreferrer"
            className="companion-source-link"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View source code on GitHub
          </a>
        </div>
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}
