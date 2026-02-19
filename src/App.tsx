import { useState, useEffect, useCallback, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { ChampionSelect } from './components/ChampionSelect';
import { ChampionViewer } from './components/ChampionViewer';
import { CompanionPage } from './components/CompanionPage';
import { DevPage, type AccountInfo, type CompanionLiveDebug } from './components/DevPage';
import { LiveGamePage } from './components/LiveGamePage';
import { MatchHistoryPage } from './components/MatchHistoryPage';
import { PostGamePage } from './components/PostGamePage';
import { getChampions, getChampionDetail, getLatestVersion, getItems, resolveLcuSkinNum } from './api';
import { sampleLiveGameData, samplePostGameData } from './mockLiveGameData';
import type {
  ChampionBasic,
  ChampionDetail,
  Skin,
  LiveGameData,
  LiveGamePlayer,
  LiveGameEvent,
  KillEvent,
  ItemInfo,
  KillEventPlayerSnapshot,
  LiveGameStats,
} from './types';
import { useSeoHead } from './hooks/useSeoHead';
import './App.css';

const MAX_DEBUG_LOGS = 800;
const MAX_MATCH_EVENTS = 2500;
const MAX_COMPLETED_MATCHES = 8;

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

const ZERO_LIVE_STATS: LiveGameStats = {
  attackDamage: 0,
  abilityPower: 0,
  armor: 0,
  magicResist: 0,
  attackSpeed: 0,
  critChance: 0,
  critDamage: 0,
  moveSpeed: 0,
  maxHealth: 0,
  currentHealth: 0,
  resourceMax: 0,
  resourceValue: 0,
  resourceType: '',
  abilityHaste: 0,
  lifeSteal: 0,
  omnivamp: 0,
  physicalLethality: 0,
  magicLethality: 0,
  armorPenetrationFlat: 0,
  armorPenetrationPercent: 0,
  magicPenetrationFlat: 0,
  magicPenetrationPercent: 0,
  tenacity: 0,
  healShieldPower: 0,
  attackRange: 0,
  healthRegenRate: 0,
  resourceRegenRate: 0,
};

function readNumericField(raw: unknown, ...keys: string[]): number {
  if (!raw || typeof raw !== 'object') return 0;
  const source = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function readStringField(raw: unknown, ...keys: string[]): string {
  if (!raw || typeof raw !== 'object') return '';
  const source = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function normalizeLiveStats(raw: unknown): LiveGameStats {
  return {
    attackDamage: readNumericField(raw, 'attackDamage', 'AttackDamage'),
    abilityPower: readNumericField(raw, 'abilityPower', 'AbilityPower'),
    armor: readNumericField(raw, 'armor', 'Armor'),
    magicResist: readNumericField(raw, 'magicResist', 'MagicResist'),
    attackSpeed: readNumericField(raw, 'attackSpeed', 'AttackSpeed'),
    critChance: readNumericField(raw, 'critChance', 'CritChance'),
    critDamage: readNumericField(raw, 'critDamage', 'CritDamage'),
    moveSpeed: readNumericField(raw, 'moveSpeed', 'MoveSpeed'),
    maxHealth: readNumericField(raw, 'maxHealth', 'MaxHealth'),
    currentHealth: readNumericField(raw, 'currentHealth', 'CurrentHealth'),
    resourceMax: readNumericField(raw, 'resourceMax', 'ResourceMax'),
    resourceValue: readNumericField(raw, 'resourceValue', 'ResourceValue'),
    resourceType: readStringField(raw, 'resourceType', 'ResourceType'),
    abilityHaste: readNumericField(raw, 'abilityHaste', 'AbilityHaste'),
    lifeSteal: readNumericField(raw, 'lifeSteal', 'LifeSteal'),
    omnivamp: readNumericField(raw, 'omnivamp', 'Omnivamp'),
    physicalLethality: readNumericField(raw, 'physicalLethality', 'PhysicalLethality'),
    magicLethality: readNumericField(raw, 'magicLethality', 'MagicLethality'),
    armorPenetrationFlat: readNumericField(raw, 'armorPenetrationFlat', 'ArmorPenetrationFlat'),
    armorPenetrationPercent: readNumericField(raw, 'armorPenetrationPercent', 'ArmorPenetrationPercent'),
    magicPenetrationFlat: readNumericField(raw, 'magicPenetrationFlat', 'MagicPenetrationFlat'),
    magicPenetrationPercent: readNumericField(raw, 'magicPenetrationPercent', 'MagicPenetrationPercent'),
    tenacity: readNumericField(raw, 'tenacity', 'Tenacity'),
    healShieldPower: readNumericField(raw, 'healShieldPower', 'HealShieldPower'),
    attackRange: readNumericField(raw, 'attackRange', 'AttackRange'),
    healthRegenRate: readNumericField(raw, 'healthRegenRate', 'HealthRegenRate'),
    resourceRegenRate: readNumericField(raw, 'resourceRegenRate', 'ResourceRegenRate'),
  };
}

function normalizeActivePlayer(raw: unknown): LiveGameData['activePlayer'] {
  if (!raw || typeof raw !== 'object') {
    return {
      summonerName: '',
      level: 0,
      currentGold: 0,
      stats: { ...ZERO_LIVE_STATS },
    };
  }

  const source = raw as Record<string, unknown>;
  const statsRaw = source.stats ?? source.championStats ?? source.ChampionStats;

  return {
    summonerName: readStringField(source, 'summonerName', 'SummonerName'),
    level: readNumericField(source, 'level', 'Level'),
    currentGold: readNumericField(source, 'currentGold', 'CurrentGold'),
    stats: statsRaw ? normalizeLiveStats(statsRaw) : { ...ZERO_LIVE_STATS },
  };
}

/** Composite key for kill-event deduplication */
function killEventKey(k: KillEvent): string {
  return `${k.eventTime}:${k.killerChamp}:${k.victimChamp}`;
}

/** Composite key for live-event deduplication */
function liveEventKey(e: LiveGameEvent): string {
  return `${e.eventTime}:${e.eventName}:${e.killerName ?? ''}:${e.victimName ?? ''}:${e.turretKilled ?? ''}:${e.inhibKilled ?? ''}`;
}

function normalizeLiveGamePayload(raw: unknown, prev: LiveGameData | null): LiveGameData | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;

  const incomingPlayers = Array.isArray(source.players) ? (source.players as LiveGamePlayer[]) : [];
  const incomingKillFeed = Array.isArray(source.killFeed) ? (source.killFeed as LiveGameData['killFeed']) : [];
  const incomingLiveEvents = Array.isArray(source.liveEvents) ? (source.liveEvents as LiveGameData['liveEvents']) : [];
  const partyMembers = Array.isArray(source.partyMembers)
    ? source.partyMembers.filter((name): name is string => typeof name === 'string')
    : (prev?.partyMembers ?? []);
  const gameTime = readNumericField(source, 'gameTime', 'GameTime');

  // Detect new game session (game time jumped backwards significantly)
  const isNewGame = !prev || gameTime < prev.gameTime - 10;

  // Accumulate events across updates so that data survives API truncation
  // or WebSocket reconnections that cause intermediate updates to be missed.
  let killFeed: KillEvent[];
  let liveEvents: LiveGameEvent[];

  if (isNewGame) {
    killFeed = incomingKillFeed ?? [];
    liveEvents = incomingLiveEvents ?? [];
  } else {
    const prevKillKeys = new Set((prev.killFeed ?? []).map(killEventKey));
    const newKills = (incomingKillFeed ?? []).filter((k) => !prevKillKeys.has(killEventKey(k)));
    killFeed =
      newKills.length > 0
        ? [...(prev.killFeed ?? []), ...newKills].sort((a, b) => a.eventTime - b.eventTime)
        : (prev.killFeed ?? []);

    const prevEventKeys = new Set((prev.liveEvents ?? []).map(liveEventKey));
    const newEvents = (incomingLiveEvents ?? []).filter((e) => !prevEventKeys.has(liveEventKey(e)));
    liveEvents =
      newEvents.length > 0
        ? [...(prev.liveEvents ?? []), ...newEvents].sort((a, b) => a.eventTime - b.eventTime)
        : (prev.liveEvents ?? []);
  }

  // Carry over snapshots (reset only on new game, not on event-count fluctuation)
  const snapshots: Record<number, KillEventPlayerSnapshot> =
    isNewGame ? {} : { ...(prev?.killFeedSnapshots ?? {}) };

  for (const kill of killFeed) {
    if (!kill || typeof kill !== 'object') continue;
    const eventTime = (kill as { eventTime?: unknown }).eventTime;
    if (typeof eventTime !== 'number') continue;
    if (!(eventTime in snapshots)) {
      snapshots[eventTime] = snapshotPlayers(incomingPlayers);
    }
  }

  return {
    gameTime,
    gameMode: readStringField(source, 'gameMode', 'GameMode') || 'CLASSIC',
    gameResult: readStringField(source, 'gameResult', 'GameResult') || undefined,
    activePlayer: normalizeActivePlayer(source.activePlayer),
    players: incomingPlayers,
    partyMembers,
    killFeed,
    liveEvents,
    killFeedSnapshots: snapshots,
  };
}

function readHistoryRiotIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('riotId') ?? '';
}

function summarizeWsPayload(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const source = raw as Record<string, unknown>;
  const parts: string[] = [];
  const gameTime = readNumericField(source, 'gameTime', 'GameTime');
  if (gameTime > 0) parts.push(`t=${Math.floor(gameTime)}s`);
  const players = Array.isArray(source.players) ? source.players.length : 0;
  if (players > 0) parts.push(`players=${players}`);
  const kills = Array.isArray(source.killFeed) ? source.killFeed.length : 0;
  if (kills > 0) parts.push(`kills=${kills}`);
  const events = Array.isArray(source.liveEvents) ? source.liveEvents.length : 0;
  if (events > 0) parts.push(`events=${events}`);
  const result = readStringField(source, 'gameResult', 'GameResult');
  if (result) parts.push(`result=${result}`);
  return parts.join(' | ');
}

function normalizeErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface RiotPostgameResponse {
  source: string;
  region: string;
  matchId: string;
  data: unknown;
}

async function fetchRiotPostgameMaster(params: {
  puuid: string;
  platformId?: string;
  expectedDurationSec?: number;
  championName?: string;
}): Promise<RiotPostgameResponse> {
  const query = new URLSearchParams({ puuid: params.puuid });
  if (params.platformId) query.set('platformId', params.platformId);
  if (typeof params.expectedDurationSec === 'number' && Number.isFinite(params.expectedDurationSec)) {
    query.set('expectedDurationSec', String(Math.max(0, Math.floor(params.expectedDurationSec))));
  }
  if (params.championName) query.set('championName', params.championName);

  const res = await fetch(`/api/match-postgame?${query.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; details?: string };
    const reason = body.error || `HTTP ${res.status}`;
    const details = body.details ? ` (${body.details})` : '';
    throw new Error(`${reason}${details}`);
  }

  return await res.json() as RiotPostgameResponse;
}

function App() {
  const [champions, setChampions] = useState<ChampionBasic[]>([]);
  const [selectedChampion, setSelectedChampion] = useState<ChampionDetail | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<Skin | null>(null);
  const [companionChromaId, setCompanionChromaId] = useState<number | null>(null);
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'select' | 'viewer' | 'companion' | 'livegame' | 'postgame' | 'dev' | 'history'>('select');
  const [historyInitialRiotId, setHistoryInitialRiotId] = useState<string>('');
  const [stayOnDevDuringLive, setStayOnDevDuringLive] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('sms_stay_on_dev_during_live') === '1';
    } catch {
      return false;
    }
  });
  const [liveGameData, setLiveGameData] = useState<LiveGameData | null>(null);
  const [postGameData, setPostGameData] = useState<LiveGameData | null>(null);
  const [itemData, setItemData] = useState<Record<number, ItemInfo>>({});
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [liveDebug, setLiveDebug] = useState<CompanionLiveDebug>({
    companionConnected: false,
    lastMessageAt: null,
    lastMessageType: '',
    lastMessageSummary: '',
    messageCounts: {},
    parseErrorCount: 0,
    liveUpdateCount: 0,
    liveEndCount: 0,
    lastLiveUpdateAt: null,
    lastLiveUpdateIntervalMs: null,
    latestLivePayload: null,
    latestLiveEndPayload: null,
    logs: [],
    activeMatch: null,
    completedMatches: [],
    nextMatchId: 1,
  });

  const appendDebugLog = useCallback((
    level: 'info' | 'warn' | 'error',
    source: string,
    message: string,
    payload?: unknown,
  ) => {
    setLiveDebug((prev) => {
      const next = [...prev.logs, { ts: Date.now(), level, source, message, payload }];
      const ts = Date.now();
      const activeMatch = prev.activeMatch
        ? {
          ...prev.activeMatch,
          events: [
            ...prev.activeMatch.events,
            { ts, source: `app.${source}`, message: `${level}: ${message}`, payload },
          ].slice(-MAX_MATCH_EVENTS),
        }
        : prev.activeMatch;
      return {
        ...prev,
        logs: next.length > MAX_DEBUG_LOGS ? next.slice(next.length - MAX_DEBUG_LOGS) : next,
        activeMatch,
      };
    });
  }, []);

  // SEO: update document head (invisible to users; for search engines)
  const seoTitle = 'Show Me Skins!';
  const seoDesc = viewMode === 'select'
    ? 'Browse and view all League of Legends champion skins in 3D. Free LoL skin viewer.'
    : viewMode === 'history'
      ? 'Search Riot ID and view recent League of Legends match history.'
      : viewMode === 'companion'
        ? 'Companion app for Show Me Skins – connect your League of Legends client.'
        : selectedChampion && selectedSkin
          ? `View ${selectedChampion.name} ${selectedSkin.name} skin in 3D. League of Legends skin viewer.`
          : 'Browse and view League of Legends champion skins in 3D.';
  const seoPath = viewMode === 'history'
    ? '/history'
    : viewMode === 'companion'
      ? '/companion'
      : selectedChampion && selectedSkin
        ? `/${selectedChampion.id}${selectedSkin.num ? `/${skinSlug(selectedSkin.name)}` : ''}`
        : '/';
  useSeoHead({ title: seoTitle, description: seoDesc, path: seoPath });

  // Track whether we've already auto-navigated for this game session
  // (so we don't force the user back if they navigate away)
  const liveGameAutoNavDone = useRef(false);
  const viewModeRef = useRef(viewMode);
  const stayOnDevDuringLiveRef = useRef(stayOnDevDuringLive);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    stayOnDevDuringLiveRef.current = stayOnDevDuringLive;
    try {
      window.localStorage.setItem('sms_stay_on_dev_during_live', stayOnDevDuringLive ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  }, [stayOnDevDuringLive]);

  // Track whether initial URL-based load has been attempted
  const initialLoadDone = useRef(false);

  // Refs for the companion-app WebSocket hook (avoids stale closures)
  const championsRef = useRef<ChampionBasic[]>([]);
  championsRef.current = champions;
  const liveGameDataRef = useRef<LiveGameData | null>(liveGameData);
  liveGameDataRef.current = liveGameData;
  const accountInfoRef = useRef<AccountInfo | null>(accountInfo);
  accountInfoRef.current = accountInfo;
  const pendingChampSelectRef = useRef<{ championId?: string; championKey?: string; skinNum: number } | null>(null);
  const champSelectSeenSinceLastLiveGame = useRef(false);
  const companionWsRef = useRef<WebSocket | null>(null);

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
          const championId = pending.championId ?? '';
          const championKey = pending.championKey ?? '';
          const match = champList.find((c) =>
            (championId && c.id.toLowerCase() === championId.toLowerCase()) ||
            (championKey && c.key === championKey),
          );
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
        } else if (championId === 'history') {
          setViewMode('history');
          setHistoryInitialRiotId(readHistoryRiotIdFromUrl());
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
      if (championId === 'history') {
        setViewMode('history');
        setHistoryInitialRiotId(readHistoryRiotIdFromUrl());
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

  const handleOpenMatchHistory = useCallback((riotId: string) => {
    setViewMode('history');
    setHistoryInitialRiotId(riotId);
    const query = riotId.trim() ? `?riotId=${encodeURIComponent(riotId.trim())}` : '';
    window.history.pushState(null, '', `/history${query}`);
  }, []);

  const handleHistoryBack = useCallback(() => {
    setViewMode('select');
    window.history.pushState(null, '', '/');
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
    const ws = companionWsRef.current;
    const skinId = parseInt(skin.id, 10);
    if (ws && ws.readyState === WebSocket.OPEN && Number.isFinite(skinId) && skinId > 0) {
      ws.send(JSON.stringify({ type: 'setSkin', skinId }));
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

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      appendDebugLog('error', 'window.error', event.message || 'Unhandled error', {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      appendDebugLog('error', 'window.unhandledrejection', normalizeErrorMessage(event.reason), {
        reason: normalizeErrorMessage(event.reason),
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [appendDebugLog]);

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

        ws.onopen = () => {
          companionWsRef.current = ws;
          console.log('[companion] Connected to companion app');
          setLiveDebug((prev) => ({ ...prev, companionConnected: true }));
          appendDebugLog('info', 'ws', 'Connected to companion bridge');
        };

        ws.onmessage = (event) => {
          const now = Date.now();
          try {
            const data = JSON.parse(event.data as string);
            const msgType = typeof data?.type === 'string' ? data.type : 'unknown';
            const summary = summarizeWsPayload(data);
            setLiveDebug((prev) => {
              const nextCounts = { ...prev.messageCounts };
              nextCounts[msgType] = (nextCounts[msgType] ?? 0) + 1;
              return {
                ...prev,
                lastMessageAt: now,
                lastMessageType: msgType,
                lastMessageSummary: summary,
                messageCounts: nextCounts,
              };
            });
            appendDebugLog('info', 'ws.message', `type=${msgType}${summary ? ` | ${summary}` : ''}`, data);

            // ── Champion select ended: reset so next session's picks are processed
            if (data.type === 'champSelectEnd') {
              pendingChampSelectRef.current = null;
              return;
            }

            // ── Champion select updates ──
            if (data.type === 'champSelectUpdate') {
              const championId: string = data.championId ?? '';
              const championKey: string = data.championKey ?? '';
              const skinNum = data.skinNum ?? 0;
              if (!championId && !championKey) return;

              champSelectSeenSinceLastLiveGame.current = true;

              // Debounce: wait 300ms of no change before navigating
              clearTimeout(debounceTimer);
              debounceTimer = setTimeout(async () => {
                const champs = championsRef.current;
                if (champs.length === 0) {
                  pendingChampSelectRef.current = { championId, championKey, skinNum };
                  return;
                }

                const match = champs.find(
                  (c) =>
                    (championId && c.id.toLowerCase() === championId.toLowerCase()) ||
                    (championKey && c.key === championKey),
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
              setLiveDebug((prev) => {
                let activeMatch = prev.activeMatch;
                let nextMatchId = prev.nextMatchId;

                if (!activeMatch) {
                  activeMatch = {
                    id: nextMatchId,
                    startedAt: now,
                    endedAt: null,
                    events: [],
                  };
                  nextMatchId += 1;
                }

                const nextEvents = [
                  ...activeMatch.events,
                  {
                    ts: now,
                    source: 'liveGameUpdate',
                    message: summarizeWsPayload(data) || 'live update',
                    payload: data,
                  },
                ];

                return {
                  ...prev,
                  liveUpdateCount: prev.liveUpdateCount + 1,
                  lastLiveUpdateIntervalMs: prev.lastLiveUpdateAt ? now - prev.lastLiveUpdateAt : null,
                  lastLiveUpdateAt: now,
                  latestLivePayload: data,
                  activeMatch: {
                    ...activeMatch,
                    events: nextEvents.length > MAX_MATCH_EVENTS ? nextEvents.slice(nextEvents.length - MAX_MATCH_EVENTS) : nextEvents,
                  },
                  nextMatchId,
                };
              });
              // Reset champ-select dedup once a game is in progress.
              // If champ-select end is ever missed, the next lobby should still
              // be able to re-emit the same champion/skin combination.
              champSelectSeenSinceLastLiveGame.current = false;
              pendingChampSelectRef.current = null;

              setLiveGameData((prev) => {
                const next = normalizeLiveGamePayload(data, prev) ?? prev;
                liveGameDataRef.current = next;
                return next;
              });

              // Auto-navigate to the live game page on first detection
              const shouldStayOnDev = stayOnDevDuringLiveRef.current && viewModeRef.current === 'dev';
              if (!liveGameAutoNavDone.current && !shouldStayOnDev) {
                liveGameAutoNavDone.current = true;
                setViewMode('livegame');
                window.history.pushState(null, '', '/live');
              } else if (shouldStayOnDev) {
                appendDebugLog('info', 'nav', 'Suppressed auto-navigation to /live (Stay On Dev enabled)');
              }
            }

            // ── Game ended ── transition to post-game summary
            if (data.type === 'liveGameEnd') {
              setLiveDebug((prev) => {
                let activeMatch = prev.activeMatch;
                let nextMatchId = prev.nextMatchId;
                if (!activeMatch) {
                  activeMatch = {
                    id: nextMatchId,
                    startedAt: now,
                    endedAt: null,
                    events: [],
                  };
                  nextMatchId += 1;
                }

                const nextEvents = [
                  ...activeMatch.events,
                  {
                    ts: now,
                    source: 'liveGameEnd',
                    message: `liveGameEnd${typeof data.gameResult === 'string' && data.gameResult ? ` result=${data.gameResult}` : ''}`,
                    payload: data,
                  },
                ];

                const completed = {
                  ...activeMatch,
                  endedAt: now,
                  result: typeof data.gameResult === 'string' ? data.gameResult : activeMatch.result,
                  events: nextEvents.length > MAX_MATCH_EVENTS ? nextEvents.slice(nextEvents.length - MAX_MATCH_EVENTS) : nextEvents,
                };

                const completedMatches = [...prev.completedMatches, completed];
                return {
                  ...prev,
                  liveEndCount: prev.liveEndCount + 1,
                  latestLiveEndPayload: data,
                  activeMatch: null,
                  completedMatches: completedMatches.length > MAX_COMPLETED_MATCHES
                    ? completedMatches.slice(completedMatches.length - MAX_COMPLETED_MATCHES)
                    : completedMatches,
                  nextMatchId,
                };
              });
              // Ensure next champ-select session can emit the same champion/skin.
              if (champSelectSeenSinceLastLiveGame.current) {
                liveGameAutoNavDone.current = false;
                return;
              }
              pendingChampSelectRef.current = null;

              const endResult: string | undefined = data.gameResult || undefined;
              const lastSnapshot = liveGameDataRef.current;
              const endSnapshot = normalizeLiveGamePayload(data.finalUpdate, lastSnapshot);
              const baseSnapshot = endSnapshot ?? lastSnapshot;
              const fallbackPostgame = baseSnapshot
                ? {
                  ...baseSnapshot,
                  gameResult: endResult || baseSnapshot.gameResult,
                }
                : null;
              if (fallbackPostgame) {
                setPostGameData(fallbackPostgame);
                const shouldStayOnDev = stayOnDevDuringLiveRef.current && viewModeRef.current === 'dev';
                if (!shouldStayOnDev) {
                  setViewMode('postgame');
                  window.history.pushState(null, '', '/postgame');
                } else {
                  appendDebugLog('info', 'nav', 'Suppressed auto-navigation to /postgame (Stay On Dev enabled)');
                }
              }
              setLiveGameData(null);
              liveGameDataRef.current = null;

              const account = accountInfoRef.current;
              if (fallbackPostgame && account?.puuid) {
                void (async () => {
                  const activeChampion = fallbackPostgame.players.find((p) => p.isActivePlayer)?.championName;
                  try {
                    appendDebugLog('info', 'postgame.riot', 'Fetching Riot Match-v5 postgame master record', {
                      puuid: account.puuid,
                      platformId: account.platformId,
                      expectedDurationSec: fallbackPostgame.gameTime,
                      championName: activeChampion,
                    });

                    const riot = await fetchRiotPostgameMaster({
                      puuid: account.puuid,
                      platformId: account.platformId,
                      expectedDurationSec: fallbackPostgame.gameTime,
                      championName: activeChampion,
                    });

                    const normalized = normalizeLiveGamePayload(riot.data, fallbackPostgame);
                    if (!normalized) {
                      appendDebugLog('warn', 'postgame.riot', 'Riot postgame payload was unusable; keeping fallback');
                      return;
                    }

                    const merged: LiveGameData = {
                      ...normalized,
                      partyMembers: fallbackPostgame.partyMembers ?? normalized.partyMembers,
                      killFeed: (normalized.killFeed && normalized.killFeed.length > 0)
                        ? normalized.killFeed
                        : (fallbackPostgame.killFeed ?? []),
                      liveEvents: (normalized.liveEvents && normalized.liveEvents.length > 0)
                        ? normalized.liveEvents
                        : (fallbackPostgame.liveEvents ?? []),
                      killFeedSnapshots: (normalized.killFeedSnapshots && Object.keys(normalized.killFeedSnapshots).length > 0)
                        ? normalized.killFeedSnapshots
                        : (fallbackPostgame.killFeedSnapshots ?? {}),
                    };

                    setPostGameData(merged);
                    appendDebugLog('info', 'postgame.riot', `Applied Riot postgame master (${riot.matchId}, ${riot.region})`);
                  } catch (err) {
                    appendDebugLog('warn', 'postgame.riot', `Riot postgame unavailable; using fallback (${normalizeErrorMessage(err)})`);
                  }
                })();
              } else if (!account?.puuid) {
                appendDebugLog('warn', 'postgame.riot', 'Skipped Riot postgame fetch: missing account PUUID');
              }

              liveGameAutoNavDone.current = false;
            }
          } catch {
            setLiveDebug((prev) => ({ ...prev, parseErrorCount: prev.parseErrorCount + 1 }));
            appendDebugLog('error', 'ws.parse', 'Malformed WebSocket message', {
              raw: String(event.data ?? ''),
            });
          }
        };

        ws.onclose = () => {
          if (companionWsRef.current === ws) companionWsRef.current = null;
          ws = null;
          setLiveDebug((prev) => ({ ...prev, companionConnected: false }));
          appendDebugLog('warn', 'ws', 'Connection closed; reconnect scheduled');
          if (!disposed) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        };

        ws.onerror = () => {
          appendDebugLog('error', 'ws', 'WebSocket error event fired');
          ws?.close();
        };
      } catch {
        appendDebugLog('error', 'ws', 'Failed to create WebSocket; reconnect scheduled');
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
      companionWsRef.current = null;
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
          onOpenMatchHistory={handleOpenMatchHistory}
          hasLiveGame={!!liveGameData}
          onLiveGame={handleLiveGameNavigate}
        />
      ) : viewMode === 'history' ? (
        <MatchHistoryPage
          initialRiotId={historyInitialRiotId}
          onBack={handleHistoryBack}
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
        <DevPage
          accountInfo={accountInfo}
          liveDebug={liveDebug}
          stayOnDevDuringLive={stayOnDevDuringLive}
          onStayOnDevDuringLiveChange={setStayOnDevDuringLive}
          onBack={handleDevBack}
        />
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

