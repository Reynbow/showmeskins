import { useState, useEffect, useCallback, useRef } from 'react';
import { ChampionSelect } from './components/ChampionSelect';
import { ChampionViewer } from './components/ChampionViewer';
import { getChampions, getChampionDetail, getLatestVersion } from './api';
import type { ChampionBasic, ChampionDetail, Skin } from './types';
import './App.css';

/** Turn a skin name into a URL-friendly slug: "Dark Star Thresh" → "dark-star-thresh" */
function skinSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Parse the current URL path into champion ID and optional skin slug. */
function parseUrl(): { championId: string | null; skinSlug: string | null } {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const championId = parts[0] || null;
  const slug = parts[1] || null;
  return { championId, skinSlug: slug };
}

/** Find a skin by its slug (case-insensitive). Falls back to matching by skin number for legacy URLs. */
function findSkinBySlug(skins: Skin[], slug: string): Skin | undefined {
  // Try matching by name slug first
  const match = skins.find((s) => skinSlug(s.name) === slug.toLowerCase());
  if (match) return match;
  // Fallback: try matching by skin number (for old numeric URLs)
  const num = Number(slug);
  if (!isNaN(num)) return skins.find((s) => s.num === num);
  return undefined;
}

function App() {
  const [champions, setChampions] = useState<ChampionBasic[]>([]);
  const [selectedChampion, setSelectedChampion] = useState<ChampionDetail | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<Skin | null>(null);
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'select' | 'viewer'>('select');

  // Track whether initial URL-based load has been attempted
  const initialLoadDone = useRef(false);

  // Refs for the companion-app WebSocket hook (avoids stale closures)
  const championsRef = useRef<ChampionBasic[]>([]);
  championsRef.current = champions;
  const lastCompanionKey = useRef('');

  // On first load: fetch champions, then check URL for deep-link
  useEffect(() => {
    async function load() {
      try {
        const [v, champs] = await Promise.all([getLatestVersion(), getChampions()]);
        setVersion(v);
        const champList = Object.values(champs).sort((a, b) => a.name.localeCompare(b.name));
        setChampions(champList);

        // Deep-link: if URL has a champion, load it
        const { championId, skinSlug: urlSkinSlug } = parseUrl();
        if (championId) {
          // Find the champion (case-insensitive match against id)
          const match = Object.values(champs).find(
            (c) => c.id.toLowerCase() === championId.toLowerCase(),
          );
          if (match) {
            const detail = await getChampionDetail(match.id);
            setSelectedChampion(detail);
            const skin = urlSkinSlug
              ? findSkinBySlug(detail.skins, urlSkinSlug) ?? detail.skins[0]
              : detail.skins[0];
            setSelectedSkin(skin);
            setViewMode('viewer');
            // Normalize the URL
            const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
            window.history.replaceState(null, '', `/${match.id}${skinPath}`);
          }
        }
      } catch (err) {
        console.error('Failed to load champions:', err);
      } finally {
        initialLoadDone.current = true;
        setLoading(false);
      }
    }
    load();
  }, []);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = async () => {
      const { championId, skinSlug: urlSkinSlug } = parseUrl();
      if (!championId) {
        // Back to champion select
        setViewMode('select');
        setSelectedChampion(null);
        setSelectedSkin(null);
        return;
      }
      // Load the champion from the URL
      setLoading(true);
      try {
        const detail = await getChampionDetail(championId);
        setSelectedChampion(detail);
        const skin = urlSkinSlug
          ? findSkinBySlug(detail.skins, urlSkinSlug) ?? detail.skins[0]
          : detail.skins[0];
        setSelectedSkin(skin);
        setViewMode('viewer');
      } catch (err) {
        console.error('Failed to load champion from URL:', err);
        setViewMode('select');
        setSelectedChampion(null);
        setSelectedSkin(null);
      } finally {
        setLoading(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleChampionSelect = useCallback(async (champion: ChampionBasic) => {
    setLoading(true);
    try {
      const detail = await getChampionDetail(champion.id);
      setSelectedChampion(detail);
      setSelectedSkin(detail.skins[0]);
      setViewMode('viewer');
      window.history.pushState(null, '', `/${champion.id}`);
    } catch (err) {
      console.error('Failed to load champion details:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleBack = useCallback(() => {
    setViewMode('select');
    setSelectedChampion(null);
    setSelectedSkin(null);
    window.history.pushState(null, '', '/');
  }, []);

  const handleSkinSelect = useCallback((skin: Skin) => {
    setSelectedSkin(skin);
    if (selectedChampion) {
      const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
      window.history.replaceState(null, '', `/${selectedChampion.id}${skinPath}`);
    }
  }, [selectedChampion]);

  const navigateChampion = useCallback(async (direction: 1 | -1) => {
    if (!selectedChampion || champions.length === 0) return;
    const idx = champions.findIndex((c) => c.id === selectedChampion.id);
    if (idx === -1) return;
    const nextIdx = (idx + direction + champions.length) % champions.length;
    const next = champions[nextIdx];
    setLoading(true);
    try {
      const detail = await getChampionDetail(next.id);
      setSelectedChampion(detail);
      setSelectedSkin(detail.skins[0]);
      window.history.pushState(null, '', `/${next.id}`);
    } catch (err) {
      console.error('Failed to load champion:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedChampion, champions]);

  const handlePrevChampion = useCallback(() => navigateChampion(-1), [navigateChampion]);
  const handleNextChampion = useCallback(() => navigateChampion(1), [navigateChampion]);

  // ── Companion app WebSocket integration ────────────────────────────
  // Connects to the local companion app (ws://localhost:8234) which
  // detects champion-select state from the League client and forwards
  // the selected champion + skin here in real time.
  useEffect(() => {
    const COMPANION_URL = 'ws://localhost:8234';
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let debounceTimer: ReturnType<typeof setTimeout>;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        ws = new WebSocket(COMPANION_URL);

        ws.onopen = () => console.log('[companion] Connected to companion app');

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);
            if (data.type === 'champSelectUpdate') {
              // De-duplicate on the website side too
              const key = `${data.championId}:${data.skinNum}`;
              if (key === lastCompanionKey.current) return;
              lastCompanionKey.current = key;

              // Debounce: wait 300ms of no change before navigating
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(async () => {
                const champs = championsRef.current;
                if (champs.length === 0) return;

                const match = champs.find(
                  (c) => c.id.toLowerCase() === data.championId.toLowerCase(),
                );
                if (!match) return;

                try {
                  const detail = await getChampionDetail(match.id);
                  const skin =
                    detail.skins.find((s) => s.num === data.skinNum) ?? detail.skins[0];
                  setSelectedChampion(detail);
                  setSelectedSkin(skin);
                  setViewMode('viewer');
                  const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
                  window.history.replaceState(null, '', `/${match.id}${skinPath}`);
                } catch (err) {
                  console.error('[companion] Failed to load champion:', err);
                }
              }, 300);
            }
          } catch {
            /* ignore malformed messages */
          }
        };

        ws.onclose = () => {
          ws = null;
          if (!disposed) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        };

        ws.onerror = () => {
          // Will trigger onclose → reconnect
          ws?.close();
        };
      } catch {
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(debounceTimer);
      ws?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-hex">
            <div className="loading-hex-inner" />
          </div>
          <span className="loading-text">Loading</span>
        </div>
      )}

      {viewMode === 'select' ? (
        <ChampionSelect
          champions={champions}
          version={version}
          onSelect={handleChampionSelect}
        />
      ) : selectedChampion && selectedSkin ? (
        <ChampionViewer
          champion={selectedChampion}
          selectedSkin={selectedSkin}
          onBack={handleBack}
          onSkinSelect={handleSkinSelect}
          onPrevChampion={handlePrevChampion}
          onNextChampion={handleNextChampion}
        />
      ) : null}
    </div>
  );
}

export default App;
