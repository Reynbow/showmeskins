import './CompanionPage.css';

interface Props {
  onBack: () => void;
}

const DOWNLOAD_URL =
  'https://github.com/aaronlol/show-me-skins-companion/releases/latest/download/Show.Me.Skins.Companion.Setup.0.1.0.exe';

export function CompanionPage({ onBack }: Props) {
  return (
    <div className="companion-page">
      {/* Background decorations (same as champion select) */}
      <div className="cs-bg-glow" />
      <div className="cs-bg-lines" />

      <div className="companion-content">
        {/* Header */}
        <button className="companion-back" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <div className="companion-header">
          <div className="companion-logo">
            <svg viewBox="0 0 40 40" fill="none" className="companion-logo-icon">
              <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
            </svg>
          </div>
          <h1 className="companion-title">Companion App <span className="companion-beta-badge">Beta</span></h1>
          <p className="companion-subtitle">
            Automatically sync your champion select with Show Me Skins
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
            Download for Windows
          </a>
          <span className="companion-version">v0.1 Beta &middot; Windows 10/11</span>
        </div>

        {/* What it does */}
        <div className="companion-section">
          <h2 className="companion-section-title">What does it do?</h2>
          <p className="companion-section-text">
            The companion app is a small utility that runs in your system tray and connects 
            to your League of Legends client. When you enter champion select, it detects which 
            champion and skin you&apos;re selecting and automatically opens the 3D model on this 
            website in real time.
          </p>
        </div>

        {/* How it works */}
        <div className="companion-section">
          <h2 className="companion-section-title">How it works</h2>
          <div className="companion-steps">
            <div className="companion-step">
              <div className="companion-step-number">1</div>
              <div className="companion-step-content">
                <h3>Install &amp; launch</h3>
                <p>Run the installer and the app starts in your system tray. Look for the black and white hexagon icon.</p>
              </div>
            </div>
            <div className="companion-step">
              <div className="companion-step-number">2</div>
              <div className="companion-step-content">
                <h3>Open the website</h3>
                <p>Keep <strong>showmeskins.com</strong> open in your browser. The website connects to the companion automatically.</p>
              </div>
            </div>
            <div className="companion-step">
              <div className="companion-step-number">3</div>
              <div className="companion-step-content">
                <h3>Enter champion select</h3>
                <p>Start a game in League of Legends. As you pick a champion and browse skins, the website updates live.</p>
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
      </div>

      <div className="cs-bottom-border" />
    </div>
  );
}
