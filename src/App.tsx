import { useState, useEffect, useCallback, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { ChampionSelect } from './components/ChampionSelect';
import { ChampionViewer } from './components/ChampionViewer';
import { CompanionPage } from './components/CompanionPage';
import { DevPage, type AccountInfo } from './components/DevPage';
import { LiveGamePage } from './components/LiveGamePage';
import { PostGamePage } from './components/PostGamePage';
import { getChampions, getChampionDetail, getLatestVersion, getItems, resolveLcuSkinNum } from './api';
import { sampleLiveGameData, samplePostGameData } from './mockLiveGameData';
import type { ChampionBasic, ChampionDetail, Skin, LiveGameData, LiveGamePlayer, ItemInfo, KillEventPlayerSnapshot } from './types';
import { useSeoHead } from './hooks/useSeoHead';
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

function snapshotPlayers(players: LiveGamePlayer[]): KillEventPlayerSnapshot {
  const byName: Record<string, LiveGamePlayer> = {};
  const byChamp: Record<string, LiveGamePlayer> = {};

  for (const player of players) {
    const frozen = { ...player, items: player.items.map((item) => ({ ...item })) };
    byName[player.summonerName] = frozen;
    byChamp[player.championName] = frozen;
  }

  return { byName, byChamp };
}

function App() {
  const [champions, setChampions] = useState<ChampionBasic[]>([]);
  const [selectedChampion, setSelectedChampion] = useState<ChampionDetail | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<Skin | null>(null);
  const [companionChromaId, setCompanionChromaId] = useState<number | null>(null);
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'select' | 'viewer' | 'companion' | 'livegame' | 'postgame' | 'dev'>('select');
  const [liveGameData, setLiveGameData] = useState<LiveGameData | null>(null);
  const [postGameData, setPostGameData] = useState<LiveGameData | null>(null);
  const [itemData, setItemData] = useState<Record<number, ItemInfo>>({});
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);

  // SEO: update document head (invisible to users; for search engines)
  const seoTitle = 'Show Me Skins!';
  const seoDesc = viewMode === 'select'
    ? 'Browse and view all League of Legends champion skins in 3D. Free LoL skin viewer.'
    : viewMode === 'companion'
      ? 'Companion app for Show Me Skins – connect your League of Legends client.'
      : selectedChampion && selectedSkin
        ? `View ${selectedChampion.name} ${selectedSkin.name} skin in 3D. League of Legends skin viewer.`
        : 'Browse and view League of Legends champion skins in 3D.';
  const seoPath = viewMode === 'companion'
    ? '/companion'
    : selectedChampion && selectedSkin
      ? `/${selectedChampion.id}${selectedSkin.num ? `/${skinSlug(selectedSkin.name)}` : ''}`
      : '/';
  useSeoHead({ title: seoTitle, description: seoDesc, path: seoPath });

  // Track whether we've already auto-navigated for this game session
  // (so we don't force the user back if they navigate away)
  const liveGameAutoNavDone = useRef(false);

  // Track whether initial URL-based load has been attempted
  const initialLoadDone = useRef(false);

  // Refs for the companion-app WebSocket hook (avoids stale closures)
  const championsRef = useRef<ChampionBasic[]>([]);
  championsRef.current = champions;
  const lastCompanionKey = useRef('');
  const pendingChampSelectRef = useRef<{ championId: string; skinNum: number } | null>(null);

  // On first load: fetch champions, then check URL for deep-link
  useEffect(() => {
    async function load() {
      try {
        const [v, champs, items] = await Promise.all([getLatestVersion(), getChampions(), getItems()]);
        setVersion(v);
        setItemData(items);
        const champList = Object.values(champs).sort((a, b) => a.name.localeCompare(b.name));
        setChampions(champList);

        // Process any champ select update that arrived before champions loaded
        const pending = pendingChampSelectRef.current;
        if (pending) {
          pendingChampSelectRef.current = null;
          const match = champList.find((c) => c.id.toLowerCase() === pending.championId.toLowerCase());
          if (match) {
            try {
              const detail = await getChampionDetail(match.id);
              const resolution = await resolveLcuSkinNum(match.key, pending.skinNum);
              let skin: Skin;
              let chromaId: number | null = null;
              if (resolution) {
                skin =
                  detail.skins.find((s) => s.id === resolution.baseSkinId) ??
                  detail.skins.find((s) => s.num === (parseInt(resolution.baseSkinId, 10) % 1000)) ??
                  detail.skins[0];
                chromaId = resolution.chromaId;
              } else {
                skin = detail.skins.find((s) => s.num === pending.skinNum) ?? detail.skins[0];
              }
              setSelectedChampion(detail);
              setSelectedSkin(skin);
              setCompanionChromaId(chromaId);
              setViewMode('viewer');
              const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
              window.history.replaceState(null, '', `/${match.id}${skinPath}`);
            } catch (err) {
              console.error('[companion] Failed to load champion (pending):', err);
            }
          }
        }

        // Deep-link: check URL
        const { championId, skinSlug: urlSkinSlug } = parseUrl();
        if (championId === 'companion') {
          setViewMode('companion');
        } else if (championId === 'dev') {
          if (import.meta.env.DEV) {
            setViewMode('dev');
          } else {
            window.history.replaceState(null, '', '/companion');
            setViewMode('companion');
          }
        } else if (championId === 'live' || championId === 'postgame') {
          // /live and /postgame require active session data from the companion.
          // If opened directly with no session, redirect to home.
          setViewMode('select');
          window.history.replaceState(null, '', '/');
        } else if (championId) {
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

  // Redirect to home if on /live or /postgame without session data
  useEffect(() => {
    if (viewMode === 'livegame' && !liveGameData) {
      setViewMode('select');
      window.history.replaceState(null, '', '/');
    } else if (viewMode === 'postgame' && !postGameData) {
      setViewMode('select');
      window.history.replaceState(null, '', '/');
    }
  }, [viewMode, liveGameData, postGameData]);

  // Dev page is development-only; redirect /dev to companion in production
  useEffect(() => {
    if (viewMode === 'dev' && import.meta.env.PROD) {
      setViewMode('companion');
      window.history.replaceState(null, '', '/companion');
    }
  }, [viewMode]);

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
      if (championId === 'companion') {
        setViewMode('companion');
        return;
      }
      if (championId === 'dev') {
        if (import.meta.env.DEV) {
          setViewMode('dev');
        } else {
          window.history.replaceState(null, '', '/companion');
          setViewMode('companion');
        }
        return;
      }
      if (championId === 'live') {
        setViewMode('livegame');
        return;
      }
      if (championId === 'postgame') {
        setViewMode('postgame');
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
    setCompanionChromaId(null);
    window.history.pushState(null, '', '/');
  }, []);

  const handleCompanion = useCallback(() => {
    setViewMode('companion');
    window.history.pushState(null, '', '/companion');
  }, []);

  const handleLiveGameNavigate = useCallback(() => {
    setViewMode('livegame');
    window.history.pushState(null, '', '/live');
  }, []);

  const handleCompanionBack = useCallback(() => {
    setViewMode('select');
    window.history.pushState(null, '', '/');
  }, []);

  const handleDev = useCallback(() => {
    setViewMode('dev');
    window.history.pushState(null, '', '/dev');
  }, []);

  const handleDevBack = useCallback(() => {
    setViewMode('companion');
    window.history.pushState(null, '', '/companion');
  }, []);

  const isSamplePreview = useRef(false);

  const handleLiveGameBack = useCallback(() => {
    setLiveGameData(null);
    if (isSamplePreview.current) {
      isSamplePreview.current = false;
      setViewMode('companion');
      window.history.pushState(null, '', '/companion');
    } else {
      setViewMode('select');
      window.history.pushState(null, '', '/');
    }
  }, []);

  const handlePostGameBack = useCallback(() => {
    setPostGameData(null);
    if (isSamplePreview.current) {
      isSamplePreview.current = false;
      setViewMode('companion');
      window.history.pushState(null, '', '/companion');
    } else {
      setViewMode('select');
      window.history.pushState(null, '', '/');
    }
  }, []);

  const handleSampleLive = useCallback(() => {
    isSamplePreview.current = true;
    setLiveGameData(sampleLiveGameData);
    setViewMode('livegame');
    window.history.pushState(null, '', '/live');
  }, []);

  const handleSamplePostGame = useCallback(() => {
    isSamplePreview.current = true;
    setPostGameData(samplePostGameData);
    setViewMode('postgame');
    window.history.pushState(null, '', '/postgame');
  }, []);

  const handleSkinSelect = useCallback((skin: Skin) => {
    setSelectedSkin(skin);
    setCompanionChromaId(null);
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
      setCompanionChromaId(null);
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

            // ── Champion select ended: reset so next session's picks are processed
            if (data.type === 'champSelectEnd') {
              lastCompanionKey.current = '';
              pendingChampSelectRef.current = null;
              return;
            }

            // ── Champion select updates ──
            if (data.type === 'champSelectUpdate') {
              const championId = data.championId;
              const skinNum = data.skinNum ?? 0;

              // De-duplicate on the website side too
              const key = `${championId}:${skinNum}`;
              if (key === lastCompanionKey.current) return;
              lastCompanionKey.current = key;

              // Debounce: wait 300ms of no change before navigating
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(async () => {
                const champs = championsRef.current;
                if (champs.length === 0) {
                  pendingChampSelectRef.current = { championId, skinNum };
                  return;
                }

                const match = champs.find(
                  (c) => c.id.toLowerCase() === championId.toLowerCase(),
                );
                if (!match) return;

                try {
                  const detail = await getChampionDetail(match.id);
                  const resolution = await resolveLcuSkinNum(match.key, skinNum);
                  let skin: Skin;
                  let chromaId: number | null = null;
                  if (resolution) {
                    skin =
                      detail.skins.find((s) => s.id === resolution.baseSkinId) ??
                      detail.skins.find((s) => s.num === (parseInt(resolution.baseSkinId, 10) % 1000)) ??
                      detail.skins[0];
                    chromaId = resolution.chromaId;
                  } else {
                    skin = detail.skins.find((s) => s.num === skinNum) ?? detail.skins[0];
                  }
                  setSelectedChampion(detail);
                  setSelectedSkin(skin);
                  setCompanionChromaId(chromaId);
                  setViewMode('viewer');
                  const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
                  window.history.replaceState(null, '', `/${match.id}${skinPath}`);
                } catch (err) {
                  console.error('[companion] Failed to load champion:', err);
                }
              }, 300);
            }

            // ── Account info (PUUID, etc. for match history) ──
            if (data.type === 'accountInfo' && data.puuid) {
              setAccountInfo({
                puuid: data.puuid,
                displayName: data.displayName ?? '',
                summonerId: data.summonerId,
                accountId: data.accountId,
                platformId: data.platformId,
              });
            }

            // ── Live game updates (full scoreboard) ──
            if (data.type === 'liveGameUpdate') {
              setLiveGameData((prev) => {
                const players = data.players ?? [];
                const killFeed = data.killFeed ?? [];
                const gameTime = data.gameTime ?? 0;

                const isNewTimeline =
                  !prev ||
                  gameTime < prev.gameTime ||
                  killFeed.length < (prev.killFeed?.length ?? 0);
                const snapshots: Record<number, KillEventPlayerSnapshot> =
                  isNewTimeline ? {} : { ...(prev.killFeedSnapshots ?? {}) };

                for (const kill of killFeed) {
                  if (!(kill.eventTime in snapshots)) {
                    snapshots[kill.eventTime] = snapshotPlayers(players);
                  }
                }

                return {
                  gameTime,
                  gameMode: data.gameMode ?? 'CLASSIC',
                  gameResult: data.gameResult || undefined,
                  activePlayer: data.activePlayer ?? {},
                  players,
                  partyMembers: data.partyMembers ?? prev?.partyMembers ?? [],
                  killFeed,
                  killFeedSnapshots: snapshots,
                };
              });

              // Auto-navigate to the live game page on first detection
              if (!liveGameAutoNavDone.current) {
                liveGameAutoNavDone.current = true;
                setViewMode('livegame');
                window.history.pushState(null, '', '/live');
              }
            }

            // ── Game ended ── transition to post-game summary
            if (data.type === 'liveGameEnd') {
              const endResult: string | undefined = data.gameResult || undefined;
              // Capture the final snapshot before clearing live data
              setLiveGameData((lastSnapshot) => {
                if (lastSnapshot) {
                  // Merge the game result — prefer the end message's result,
                  // then fall back to whatever the last update had.
                  const finalData = {
                    ...lastSnapshot,
                    gameResult: endResult || lastSnapshot.gameResult,
                  };
                  setPostGameData(finalData);
                  setViewMode('postgame');
                  window.history.pushState(null, '', '/postgame');
                }
                return null;
              });
              liveGameAutoNavDone.current = false;
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

      {viewMode === 'postgame' && postGameData ? (
        <PostGamePage
          data={postGameData}
          champions={champions}
          version={version}
          itemData={itemData}
          onBack={handlePostGameBack}
          backLabel={isSamplePreview.current ? 'Back' : 'Continue'}
        />
      ) : viewMode === 'livegame' && liveGameData ? (
        <LiveGamePage
          data={liveGameData}
          champions={champions}
          version={version}
          itemData={itemData}
          onBack={handleLiveGameBack}
        />
      ) : viewMode === 'select' ? (
        <ChampionSelect
          champions={champions}
          version={version}
          onSelect={handleChampionSelect}
          onCompanion={handleCompanion}
          hasLiveGame={!!liveGameData}
          onLiveGame={handleLiveGameNavigate}
        />
      ) : viewMode === 'companion' ? (
        <CompanionPage
          onBack={handleCompanionBack}
          onSampleLive={handleSampleLive}
          onSamplePostGame={handleSamplePostGame}
          onDev={import.meta.env.DEV ? handleDev : undefined}
          hasLiveGame={!!liveGameData}
          onLiveGame={handleLiveGameNavigate}
        />
      ) : viewMode === 'dev' && import.meta.env.DEV ? (
        <DevPage accountInfo={accountInfo} champions={champions} onBack={handleDevBack} />
      ) : selectedChampion && selectedSkin ? (
        <ChampionViewer
          champion={selectedChampion}
          selectedSkin={selectedSkin}
          initialChromaId={companionChromaId}
          onBack={handleBack}
          onSkinSelect={handleSkinSelect}
          onPrevChampion={handlePrevChampion}
          onNextChampion={handleNextChampion}
          hasLiveGame={!!liveGameData}
          onLiveGame={handleLiveGameNavigate}
        />
      ) : null}
      <Analytics />
    </div>
  );
}

export default App;
