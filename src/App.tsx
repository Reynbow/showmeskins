import { useState, useEffect, useCallback, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Canvas, useFrame } from '@react-three/fiber';
import { AramWardrobePage } from './components/AramWardrobePage';
import { ChampionSelect } from './components/ChampionSelect';
import { ChampionViewer } from './components/ChampionViewer';
import { CompanionPage } from './components/CompanionPage';
import { DevPage, type AccountInfo, type CompanionLiveDebug } from './components/DevPage';
import { MatchHistoryPage } from './components/MatchHistoryPage';
import { RegionsPage } from './components/RegionsPage';
import { SkinLinesPage } from './components/SkinLinesPage';
import { SkinLineViewer } from './components/SkinLineViewer';
import { TeamSkinLinesPage } from './components/TeamSkinLinesPage';
import { getAramWardrobeCatalog, getChampions, getChampionDetail, getLatestVersion, getItems, getRegionCatalog, getSkinLineCatalog, getSplashArt, resolveLcuSkinNum, toUrlSlug, type RecentSkinSpotlight } from './api';
import type {
  AramWardrobeChampion,
  ChampionBasic,
  ChampionDetail,
  Skin,
  LiveGameData,
  LobbyData,
  LiveGamePlayer,
  LiveGameEvent,
  KillEvent,
  ItemInfo,
  KillEventPlayerSnapshot,
  LiveGameStats,
  RegionCategory,
  SkinLineCategory,
  SkinLineMember,
} from './types';
import { useSeoHead } from './hooks/useSeoHead';
import './App.css';
import * as THREE from 'three';

const MAX_DEBUG_LOGS = 800;
const MAX_MATCH_EVENTS = 2500;
const MAX_COMPLETED_MATCHES = 8;

/** Turn a skin name into a URL-friendly slug: "Dark Star Thresh" → "dark-star-thresh" */
function skinSlug(name: string): string {
  return toUrlSlug(name);
}

type ParsedRoute =
  | { mode: 'home' }
  | { mode: 'companion' }
  | { mode: 'history' }
  | { mode: 'dev' }
  | { mode: 'regions' }
  | { mode: 'aram-wardrobe' }
  | { mode: 'skin-lines' }
  | { mode: 'skin-line'; lineSlug: string; championId?: string; skinId?: string }
  | { mode: 'team-skin-lines' }
  | { mode: 'champion'; championId: string; skinSlug: string | null };

/** Parse the current URL path into app routes. */
function parseRoute(): ParsedRoute {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { mode: 'home' };

  if (parts[0] === 'companion') return { mode: 'companion' };
  if (parts[0] === 'history') return { mode: 'history' };
  if (parts[0] === 'dev') return { mode: 'dev' };
  if (parts[0] === 'regions') return { mode: 'regions' };
  if (parts[0] === 'aram-wardrobe') return { mode: 'aram-wardrobe' };
  if (parts[0] === 'skin-lines') {
    if (!parts[1]) return { mode: 'skin-lines' };
    return { mode: 'skin-line', lineSlug: parts[1], championId: parts[2], skinId: parts[3] };
  }
  if (parts[0] === 'team-skin-lines') return { mode: 'team-skin-lines' };

  return { mode: 'champion', championId: parts[0], skinSlug: parts[1] || null };
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

function normalizeLobbyPayload(raw: unknown): LobbyData | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const lobbyRaw = (source.lobby && typeof source.lobby === 'object')
    ? (source.lobby as Record<string, unknown>)
    : source;

  const normalizeTeam = (value: unknown): LobbyData['myTeam'][number]['team'] => {
    if (typeof value !== 'string') return 'UNKNOWN';
    const upper = value.toUpperCase();
    if (upper === 'ORDER' || upper === 'CHAOS') return upper;
    return 'UNKNOWN';
  };

  const localPlayerCellId = readNumericField(lobbyRaw, 'localPlayerCellId', 'LocalPlayerCellId');

  const parseTeam = (value: unknown, fallbackTeam: 'ORDER' | 'CHAOS') => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        return {
          cellId: readNumericField(row, 'cellId', 'CellId'),
          team: normalizeTeam(row.team) === 'UNKNOWN' ? fallbackTeam : normalizeTeam(row.team),
          puuid: readStringField(row, 'puuid', 'Puuid') || undefined,
          summonerName: readStringField(row, 'summonerName', 'SummonerName') || undefined,
          championId: readNumericField(row, 'championId', 'ChampionId'),
          championKey: readStringField(row, 'championKey', 'ChampionKey') || undefined,
          championName: readStringField(row, 'championName', 'ChampionName') || undefined,
          selectedSkinId: readNumericField(row, 'selectedSkinId', 'SelectedSkinId') || undefined,
          isLocalPlayer: readNumericField(row, 'cellId', 'CellId') === localPlayerCellId,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  };

  const parseActions = (value: unknown, expectedType: 'pick' | 'ban') => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const row = entry as Record<string, unknown>;
        const rawType = readStringField(row, 'type', 'Type').toLowerCase();
        if (rawType !== expectedType) return null;
        return {
          type: expectedType,
          actorCellId: readNumericField(row, 'actorCellId', 'ActorCellId'),
          actorPuuid: readStringField(row, 'actorPuuid', 'ActorPuuid') || undefined,
          team: normalizeTeam(readStringField(row, 'team', 'Team')),
          championId: readNumericField(row, 'championId', 'ChampionId'),
          championKey: readStringField(row, 'championKey', 'ChampionKey') || undefined,
          championName: readStringField(row, 'championName', 'ChampionName') || undefined,
          completed: !!(row.completed ?? row.Completed),
          inProgress: !!(row.inProgress ?? row.InProgress),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => !!entry);
  };

  const myTeam = parseTeam(lobbyRaw.myTeam, 'ORDER');
  const theirTeam = parseTeam(lobbyRaw.theirTeam, 'CHAOS');
  const picks = parseActions(lobbyRaw.picks, 'pick');
  const bans = parseActions(lobbyRaw.bans, 'ban');

  // Backward-compatibility: older companions only send local champion fields.
  if (myTeam.length === 0 && theirTeam.length === 0 && picks.length === 0 && bans.length === 0) {
    const championKey = readStringField(source, 'championKey', 'ChampionKey');
    const championId = readNumericField(source, 'championId', 'ChampionId');
    const championName = readStringField(source, 'championName', 'ChampionName') || undefined;
    if (!championKey && championId <= 0) return null;
    return {
      phase: 'champ_select',
      localPlayerCellId: 0,
      myTeam: [],
      theirTeam: [],
      picks: [{
        type: 'pick',
        actorCellId: 0,
        team: 'ORDER',
        championId,
        championKey: championKey || undefined,
        championName,
        completed: false,
        inProgress: true,
      }],
      bans: [],
      updatedAt: Date.now(),
    };
  }

  return {
    phase: 'champ_select',
    localPlayerCellId,
    myTeam,
    theirTeam,
    picks,
    bans,
    updatedAt: Date.now(),
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

function AppLoadingModel() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = state.clock.elapsedTime * 1.5;
    meshRef.current.rotation.x = state.clock.elapsedTime * 0.7;
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.12;
  });
  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <octahedronGeometry args={[0.6, 0]} />
      <meshStandardMaterial color="#c8aa6e" wireframe emissive="#c8aa6e" emissiveIntensity={0.8} toneMapped={false} />
    </mesh>
  );
}

function App() {
  const [champions, setChampions] = useState<ChampionBasic[]>([]);
  const [selectedChampion, setSelectedChampion] = useState<ChampionDetail | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<Skin | null>(null);
  const [companionChromaId, setCompanionChromaId] = useState<number | null>(null);
  const [version, setVersion] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'select' | 'viewer' | 'companion' | 'dev' | 'history' | 'regions' | 'aram-wardrobe' | 'skin-lines' | 'skin-line-viewer' | 'team-skin-lines'>('select');
  const [historyInitialRiotId, setHistoryInitialRiotId] = useState<string>('');
  const [regions, setRegions] = useState<RegionCategory[]>([]);
  const [aramWardrobe, setAramWardrobe] = useState<AramWardrobeChampion[]>([]);
  const [skinLines, setSkinLines] = useState<SkinLineCategory[]>([]);
  const [activeSkinLine, setActiveSkinLine] = useState<SkinLineCategory | null>(null);
  const [activeSkinLineMember, setActiveSkinLineMember] = useState<SkinLineMember | null>(null);
  const [stayOnDevDuringLive, setStayOnDevDuringLive] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('sms_stay_on_dev_during_live') === '1';
    } catch {
      return false;
    }
  });
  const [liveGameData, setLiveGameData] = useState<LiveGameData | null>(null);
  const [lobbyData, setLobbyData] = useState<LobbyData | null>(null);
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
  const seoTitle = viewMode === 'viewer' && selectedChampion && selectedSkin
    ? `${selectedChampion.name} — ${selectedSkin.num === 0 ? selectedChampion.name : selectedSkin.name} | x9report.com`
    : 'x9report.com';
  const seoDesc = viewMode === 'select'
    ? 'Browse and view all League of Legends champion skins in 3D. Free LoL skin viewer.'
    : viewMode === 'history'
      ? 'Search Riot ID and view recent League of Legends match history.'
      : viewMode === 'regions'
        ? 'Browse League of Legends champions grouped by their Runeterra regions.'
      : viewMode === 'aram-wardrobe'
        ? 'Browse every skin included in the ARAM Wardrobe subscription, grouped by champion.'
      : viewMode === 'skin-lines'
        ? 'Browse League of Legends skin lines and discover champions by theme.'
        : viewMode === 'team-skin-lines'
          ? 'Compare skin lines owned across your five-player team.'
        : viewMode === 'skin-line-viewer' && activeSkinLine
          ? `Explore ${activeSkinLine.name} skins and champions in 3D.`
      : viewMode === 'companion'
        ? 'Companion app for x9report.com – connect your League of Legends client.'
        : selectedChampion && selectedSkin
          ? `View ${selectedChampion.name} ${selectedSkin.name} skin in 3D. League of Legends skin viewer.`
          : 'Browse and view League of Legends champion skins in 3D.';
  const seoPath = viewMode === 'history'
    ? '/history'
    : viewMode === 'regions'
      ? '/regions'
    : viewMode === 'aram-wardrobe'
      ? '/aram-wardrobe'
    : viewMode === 'skin-lines'
      ? '/skin-lines'
      : viewMode === 'team-skin-lines'
        ? '/team-skin-lines'
      : viewMode === 'skin-line-viewer' && activeSkinLine && activeSkinLineMember
        ? `/skin-lines/${activeSkinLine.slug}/${activeSkinLineMember.championId}/${activeSkinLineMember.skinId}`
    : viewMode === 'companion'
      ? '/companion'
      : selectedChampion && selectedSkin
        ? `/${selectedChampion.id}${selectedSkin.num ? `/${skinSlug(selectedSkin.name)}` : ''}`
        : '/';
  const seoImage =
    viewMode === 'viewer' && selectedChampion && selectedSkin
      ? getSplashArt(selectedChampion.id, selectedSkin.num)
      : viewMode === 'skin-line-viewer' && activeSkinLineMember
        ? getSplashArt(activeSkinLineMember.championId, activeSkinLineMember.skinNum)
        : undefined;
  useSeoHead({ title: seoTitle, description: seoDesc, path: seoPath, imageUrl: seoImage });

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
  const inChampSelectRef = useRef(false);
  const lastLiveGameUpdateAtRef = useRef<number | null>(null);
  const liveSessionEndedRef = useRef(true);
  const lastWsRecoveryAttemptAtRef = useRef(0);
  const postGameClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        const route = parseRoute();
        if (route.mode === 'companion') {
          setViewMode('companion');
        } else if (route.mode === 'history') {
          setViewMode('history');
          setHistoryInitialRiotId(readHistoryRiotIdFromUrl());
        } else if (route.mode === 'dev') {
          if (import.meta.env.DEV) {
            setViewMode('dev');
          } else {
            window.history.replaceState(null, '', '/companion');
            setViewMode('companion');
          }
        } else if (route.mode === 'regions') {
          const championsByKey = Object.fromEntries(champList.map((champ) => [champ.key, champ]));
          const regionCatalog = await getRegionCatalog(championsByKey);
          setRegions(regionCatalog);
          setViewMode('regions');
        } else if (route.mode === 'aram-wardrobe') {
          const wardrobe = await getAramWardrobeCatalog();
          setAramWardrobe(wardrobe);
          setViewMode('aram-wardrobe');
        } else if (route.mode === 'team-skin-lines') {
          const championsByKey = Object.fromEntries(champList.map((champ) => [champ.key, champ]));
          const lines = await getSkinLineCatalog(championsByKey);
          setSkinLines(lines);
          setViewMode('team-skin-lines');
        } else if (route.mode === 'skin-lines' || route.mode === 'skin-line') {
          const championsByKey = Object.fromEntries(champList.map((champ) => [champ.key, champ]));
          const lines = await getSkinLineCatalog(championsByKey);
          setSkinLines(lines);

          if (route.mode === 'skin-line') {
            const line = lines.find((item) => item.slug === route.lineSlug) ?? null;
            if (!line) {
              setViewMode('skin-lines');
              window.history.replaceState(null, '', '/skin-lines');
            } else {
              setActiveSkinLine(line);
              if (!route.championId || !route.skinId) {
                const firstMember = line.members[0];
                if (!firstMember) {
                  setViewMode('skin-lines');
                  window.history.replaceState(null, '', '/skin-lines');
                  return;
                }
                const detail = await getChampionDetail(firstMember.championId);
                const skin = detail.skins.find((s) => s.id === firstMember.skinId) ?? detail.skins[0];
                setSelectedChampion(detail);
                setSelectedSkin(skin);
                setActiveSkinLineMember(firstMember);
                setViewMode('skin-line-viewer');
                window.history.replaceState(null, '', `/skin-lines/${line.slug}/${firstMember.championId}/${firstMember.skinId}`);
                return;
              }
              const targetMember = route.championId && route.skinId
                ? line.members.find((member) => member.championId.toLowerCase() === route.championId!.toLowerCase() && member.skinId === route.skinId)
                : line.members[0];
              if (!targetMember) {
                setViewMode('skin-lines');
                window.history.replaceState(null, '', '/skin-lines');
              } else {
                const detail = await getChampionDetail(targetMember.championId);
                const skin = detail.skins.find((s) => s.id === targetMember.skinId) ?? detail.skins[0];
                setSelectedChampion(detail);
                setSelectedSkin(skin);
                setActiveSkinLineMember(targetMember);
                setViewMode('skin-line-viewer');
                window.history.replaceState(null, '', `/skin-lines/${line.slug}/${targetMember.championId}/${targetMember.skinId}`);
              }
            }
          } else {
            setViewMode('skin-lines');
          }
        } else if (route.mode === 'champion') {
          // Find the champion (case-insensitive match against id)
          const match = Object.values(champs).find(
            (c) => c.id.toLowerCase() === route.championId.toLowerCase(),
          );
          if (match) {
            const detail = await getChampionDetail(match.id);
            setSelectedChampion(detail);
            const skin = route.skinSlug
              ? findSkinBySlug(detail.skins, route.skinSlug) ?? detail.skins[0]
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
      const route = parseRoute();
      if (route.mode === 'home') {
        // Back to champion select
        setViewMode('select');
        setSelectedChampion(null);
        setSelectedSkin(null);
        return;
      }
      if (route.mode === 'companion') {
        setViewMode('companion');
        return;
      }
      if (route.mode === 'history') {
        setViewMode('history');
        setHistoryInitialRiotId(readHistoryRiotIdFromUrl());
        return;
      }
      if (route.mode === 'dev') {
        if (import.meta.env.DEV) {
          setViewMode('dev');
        } else {
          window.history.replaceState(null, '', '/companion');
          setViewMode('companion');
        }
        return;
      }
      if (route.mode === 'regions') {
        try {
          if (regions.length === 0 && champions.length > 0) {
            const regionCatalog = await getRegionCatalog(Object.fromEntries(champions.map((champ) => [champ.key, champ])));
            setRegions(regionCatalog);
          }
          setViewMode('regions');
        } catch (err) {
          console.error('Failed to load region route:', err);
          setViewMode('select');
        }
        return;
      }
      if (route.mode === 'aram-wardrobe') {
        try {
          if (aramWardrobe.length === 0) {
            const wardrobe = await getAramWardrobeCatalog();
            setAramWardrobe(wardrobe);
          }
          setViewMode('aram-wardrobe');
        } catch (err) {
          console.error('Failed to load ARAM wardrobe route:', err);
          setViewMode('select');
        }
        return;
      }
      if (route.mode === 'team-skin-lines') {
        try {
          if (skinLines.length === 0 && champions.length > 0) {
            const championsByKey = Object.fromEntries(champions.map((champ) => [champ.key, champ]));
            const lines = await getSkinLineCatalog(championsByKey);
            setSkinLines(lines);
          }
          setViewMode('team-skin-lines');
        } catch (err) {
          console.error('Failed to load team skin lines route:', err);
          setViewMode('select');
        }
        return;
      }
      if (route.mode === 'skin-lines' || route.mode === 'skin-line') {
        try {
          if (skinLines.length === 0 && champions.length > 0) {
            const championsByKey = Object.fromEntries(champions.map((champ) => [champ.key, champ]));
            const lines = await getSkinLineCatalog(championsByKey);
            setSkinLines(lines);
          }
          const lines = skinLines.length > 0
            ? skinLines
            : await getSkinLineCatalog(Object.fromEntries(champions.map((champ) => [champ.key, champ])));
          if (route.mode === 'skin-lines') {
            setViewMode('skin-lines');
            setActiveSkinLine(null);
            setActiveSkinLineMember(null);
            return;
          }
          const line = lines.find((item) => item.slug === route.lineSlug);
          if (!line) {
            setViewMode('skin-lines');
            return;
          }
          setActiveSkinLine(line);
          if (!route.championId || !route.skinId) {
            const firstMember = line.members[0];
            if (!firstMember) {
              setViewMode('skin-lines');
              return;
            }
            const detail = await getChampionDetail(firstMember.championId);
            const skin = detail.skins.find((s) => s.id === firstMember.skinId) ?? detail.skins[0];
            setSelectedChampion(detail);
            setSelectedSkin(skin);
            setActiveSkinLineMember(firstMember);
            setViewMode('skin-line-viewer');
            window.history.replaceState(null, '', `/skin-lines/${line.slug}/${firstMember.championId}/${firstMember.skinId}`);
            return;
          }
          const targetMember = route.championId && route.skinId
            ? line.members.find((member) => member.championId.toLowerCase() === route.championId!.toLowerCase() && member.skinId === route.skinId)
            : line.members[0];
          if (!targetMember) {
            setViewMode('skin-lines');
            return;
          }
          const detail = await getChampionDetail(targetMember.championId);
          const skin = detail.skins.find((s) => s.id === targetMember.skinId) ?? detail.skins[0];
          setSelectedChampion(detail);
          setSelectedSkin(skin);
          setActiveSkinLineMember(targetMember);
          setViewMode('skin-line-viewer');
        } catch (err) {
          console.error('Failed to load skin line route:', err);
          setViewMode('skin-lines');
        }
        return;
      }
      if (route.mode !== 'champion') return;
      // Load the champion from the URL
      setLoading(true);
      try {
        const detail = await getChampionDetail(route.championId);
        setSelectedChampion(detail);
        const skin = route.skinSlug
          ? findSkinBySlug(detail.skins, route.skinSlug) ?? detail.skins[0]
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
  }, [champions, regions, aramWardrobe, skinLines]);

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

  const handleOpenSkinSpotlight = useCallback(async (spotlight: RecentSkinSpotlight) => {
    setLoading(true);
    try {
      const detail = await getChampionDetail(spotlight.championId);
      const skin = detail.skins.find((s) => s.id === spotlight.skinId)
        ?? findSkinBySlug(detail.skins, spotlight.skinSlug)
        ?? detail.skins[0];
      setSelectedChampion(detail);
      setSelectedSkin(skin);
      setCompanionChromaId(null);
      setViewMode('viewer');
      const skinPath = skin.num === 0 ? '' : `/${skinSlug(skin.name)}`;
      window.history.pushState(null, '', `/${spotlight.championId}${skinPath}`);
    } catch (err) {
      console.error('Failed to open skin spotlight:', err);
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

  const handleOpenRegions = useCallback(async () => {
    try {
      if (regions.length === 0 && champions.length > 0) {
        setLoading(true);
        const regionCatalog = await getRegionCatalog(Object.fromEntries(champions.map((champ) => [champ.key, champ])));
        setRegions(regionCatalog);
      }
      setViewMode('regions');
      window.history.pushState(null, '', '/regions');
    } catch (err) {
      console.error('Failed to load regions:', err);
    } finally {
      setLoading(false);
    }
  }, [champions, regions]);

  const handleRegionsBack = useCallback(() => {
    setViewMode('select');
    window.history.pushState(null, '', '/');
  }, []);

  const handleOpenAramWardrobe = useCallback(async () => {
    try {
      if (aramWardrobe.length === 0) {
        setLoading(true);
        const wardrobe = await getAramWardrobeCatalog();
        setAramWardrobe(wardrobe);
      }
      setViewMode('aram-wardrobe');
      window.history.pushState(null, '', '/aram-wardrobe');
    } catch (err) {
      console.error('Failed to load ARAM wardrobe:', err);
    } finally {
      setLoading(false);
    }
  }, [aramWardrobe]);

  const handleAramWardrobeBack = useCallback(() => {
    setViewMode('select');
    window.history.pushState(null, '', '/');
  }, []);

  const handleTeamSkinLinesBack = useCallback(() => {
    setViewMode('select');
    window.history.pushState(null, '', '/');
  }, []);

  const handleOpenSkinLines = useCallback(async () => {
    try {
      if (skinLines.length === 0 && champions.length > 0) {
        setLoading(true);
        const championsByKey = Object.fromEntries(champions.map((champ) => [champ.key, champ]));
        const lines = await getSkinLineCatalog(championsByKey);
        setSkinLines(lines);
      }
      setViewMode('skin-lines');
      setActiveSkinLine(null);
      setActiveSkinLineMember(null);
      window.history.pushState(null, '', '/skin-lines');
    } catch (err) {
      console.error('Failed to load skin lines:', err);
    } finally {
      setLoading(false);
    }
  }, [champions, skinLines]);

  const handleSkinLinesBack = useCallback(() => {
    setViewMode('select');
    setActiveSkinLine(null);
    setActiveSkinLineMember(null);
    window.history.pushState(null, '', '/');
  }, []);

  const handleOpenSkinLine = useCallback(async (line: SkinLineCategory) => {
    const firstMember = line.members[0];
    if (!firstMember) return;
    setLoading(true);
    try {
      const detail = await getChampionDetail(firstMember.championId);
      const skin = detail.skins.find((item) => item.id === firstMember.skinId) ?? detail.skins[0];
      setSelectedChampion(detail);
      setSelectedSkin(skin);
      setActiveSkinLine(line);
      setActiveSkinLineMember(firstMember);
      setViewMode('skin-line-viewer');
      window.history.pushState(null, '', `/skin-lines/${line.slug}/${firstMember.championId}/${firstMember.skinId}`);
    } catch (err) {
      console.error('Failed to load skin line:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSkinLineMemberSelect = useCallback(async (line: SkinLineCategory, member: SkinLineMember) => {
    setLoading(true);
    try {
      const detail = await getChampionDetail(member.championId);
      const skin = detail.skins.find((item) => item.id === member.skinId) ?? detail.skins[0];
      setSelectedChampion(detail);
      setSelectedSkin(skin);
      setActiveSkinLine(line);
      setActiveSkinLineMember(member);
      setViewMode('skin-line-viewer');
      window.history.pushState(null, '', `/skin-lines/${line.slug}/${member.championId}/${member.skinId}`);
    } catch (err) {
      console.error('Failed to load skin line member:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSkinLineViewerBack = useCallback(() => {
    setViewMode('skin-lines');
    window.history.pushState(null, '', '/skin-lines');
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
    setViewMode('history');
    window.history.pushState(null, '', '/history');
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
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        ws = new WebSocket(COMPANION_URL);

        ws.onopen = () => {
          companionWsRef.current = ws;
          console.log('[companion] Connected to companion app');
          setLiveDebug((prev) => ({
            ...prev,
            companionConnected: true,
            // New socket session: reset live packet clock to avoid carrying
            // a stale timestamp from a previous match/session.
            lastLiveUpdateAt: null,
          }));
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
              if (postGameClearTimerRef.current) {
                clearTimeout(postGameClearTimerRef.current);
                postGameClearTimerRef.current = null;
              }
              const hasRecentLive = !!lastLiveGameUpdateAtRef.current && (now - lastLiveGameUpdateAtRef.current) < 25000;
              if (!!liveGameDataRef.current && hasRecentLive) {
                // Ignore stale champ-select end while a clearly active live stream exists.
                return;
              }
              pendingChampSelectRef.current = null;
              inChampSelectRef.current = false;
              liveSessionEndedRef.current = true;
              lastLiveGameUpdateAtRef.current = null;
              setLiveDebug((prev) => ({
                ...prev,
                lastLiveUpdateAt: null,
              }));
              setLobbyData(null);
              return;
            }

            // ── Champion select updates ──
            if (data.type === 'champSelectUpdate') {
              if (postGameClearTimerRef.current) {
                clearTimeout(postGameClearTimerRef.current);
                postGameClearTimerRef.current = null;
              }
              const hasRecentLive = !!lastLiveGameUpdateAtRef.current && (now - lastLiveGameUpdateAtRef.current) < 25000;
              // Ignore stale champ-select noise while a live session is active.
              // Only allow lobby mode when no live data is active, or once liveGameEnd occurred.
              if (!liveSessionEndedRef.current && !!liveGameDataRef.current && hasRecentLive) {
                return;
              }
              champSelectSeenSinceLastLiveGame.current = true;
              inChampSelectRef.current = true;
              liveSessionEndedRef.current = true;
              lastLiveGameUpdateAtRef.current = null;
              setLiveDebug((prev) => ({
                ...prev,
                lastLiveUpdateAt: null,
              }));
              setLiveGameData(null);
              liveGameDataRef.current = null;

              const nextLobby = normalizeLobbyPayload(data);
              if (nextLobby) {
                setLobbyData(nextLobby);
              }

              // Show lobby/champ-select in match history instead of forcing model viewer.
              if (viewModeRef.current !== 'history') {
                setViewMode('history');
                window.history.pushState(null, '', '/history');
              }
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
              if (postGameClearTimerRef.current) {
                clearTimeout(postGameClearTimerRef.current);
                postGameClearTimerRef.current = null;
              }
              // Some clients miss champSelectEnd; a valid live update should
              // always transition us out of champ-select mode.
              inChampSelectRef.current = false;
              lastLiveGameUpdateAtRef.current = now;
              liveSessionEndedRef.current = false;
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
              setLobbyData(null);

              // Auto-navigate to history page on first live game detection
              if (!liveGameAutoNavDone.current) {
                liveGameAutoNavDone.current = true;
                if (viewModeRef.current !== 'history') {
                  setViewMode('history');
                  window.history.pushState(null, '', '/history');
                }
              }
            }

            // ── Game ended ── transition to post-game summary
            if (data.type === 'liveGameEnd') {
              liveSessionEndedRef.current = true;
              lastLiveGameUpdateAtRef.current = null;
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
                  lastLiveUpdateAt: null,
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
              const finalUpdateRaw = (data && typeof data === 'object')
                ? (data as Record<string, unknown>).finalUpdate
                : undefined;
              const finalizedSnapshot =
                normalizeLiveGamePayload(finalUpdateRaw, liveGameDataRef.current) ?? liveGameDataRef.current;
              if (finalizedSnapshot) {
                setLiveGameData(finalizedSnapshot);
                liveGameDataRef.current = finalizedSnapshot;
              }
              if (postGameClearTimerRef.current) clearTimeout(postGameClearTimerRef.current);
              postGameClearTimerRef.current = setTimeout(() => {
                // ARAM: Mayhem can miss spectator completion; retire companion snapshot after a grace period.
                setLiveGameData(null);
                liveGameDataRef.current = null;
                postGameClearTimerRef.current = null;
              }, 120000);
              setLobbyData(null);
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
      if (postGameClearTimerRef.current) {
        clearTimeout(postGameClearTimerRef.current);
        postGameClearTimerRef.current = null;
      }
      ws?.close();
      companionWsRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket watchdog: if live updates stall mid-game, force a reconnect.
  useEffect(() => {
    const timer = setInterval(() => {
      const ws = companionWsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (inChampSelectRef.current) return;
      const snapshot = liveGameDataRef.current;
      if (!snapshot) return;
      const snapshotHasEnded = typeof snapshot.gameResult === 'string' && snapshot.gameResult.trim().length > 0;
      const lastUpdateAt = lastLiveGameUpdateAtRef.current;
      const now = Date.now();
      if (!lastUpdateAt) {
        // We have a live snapshot but no packet timestamp; this can happen when
        // stale end-state flags are out of sync. Force a reconnect to recover.
        if (!snapshotHasEnded && now - lastWsRecoveryAttemptAtRef.current >= 45_000) {
          lastWsRecoveryAttemptAtRef.current = now;
          appendDebugLog('warn', 'ws.watchdog', 'Missing lastLiveGameUpdateAt while live snapshot exists; reconnecting websocket');
          try {
            ws.close();
          } catch {
            // no-op
          }
        }
        return;
      }

      const staleForMs = now - lastUpdateAt;
      const staleThresholdMs = snapshotHasEnded ? 120_000 : 30_000;
      if (staleForMs < staleThresholdMs) return;
      if (now - lastWsRecoveryAttemptAtRef.current < 45_000) return;

      lastWsRecoveryAttemptAtRef.current = now;
      appendDebugLog(
        'warn',
        'ws.watchdog',
        `No liveGameUpdate for ${Math.round(staleForMs / 1000)}s (ended=${snapshotHasEnded}); reconnecting companion websocket`,
      );
      // If we're clearly stale but still showing a non-final live snapshot,
      // drop the stale overlay and let Riot spectator data carry the page.
      if (!snapshotHasEnded && staleForMs >= 120_000) {
        setLiveGameData(null);
        liveGameDataRef.current = null;
      }
      try {
        ws.close();
      } catch {
        // no-op
      }
    }, 10_000);

    return () => clearInterval(timer);
  }, [appendDebugLog]);

  return (
    <div className="app">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-model-canvas">
            <Canvas camera={{ position: [0, 0, 3], fov: 50 }}>
              <ambientLight intensity={0.8} color="#f0e6d2" />
              <pointLight position={[2, 2, 3]} intensity={1.1} color="#c8aa6e" />
              <AppLoadingModel />
            </Canvas>
          </div>
          <span className="loading-text">Loading</span>
        </div>
      )}

      {viewMode === 'select' ? (
        <ChampionSelect
          champions={champions}
          version={version}
          onSelect={handleChampionSelect}
          onOpenSkin={handleOpenSkinSpotlight}
          onCompanion={handleCompanion}
          onRegions={handleOpenRegions}
          onAramWardrobe={handleOpenAramWardrobe}
          onSkinLines={handleOpenSkinLines}
          onOpenMatchHistory={handleOpenMatchHistory}
          hasLiveGame={!!liveGameData}
          onLiveGame={handleLiveGameNavigate}
        />
      ) : viewMode === 'regions' ? (
        <RegionsPage
          regions={regions}
          champions={champions}
          version={version}
          onBack={handleRegionsBack}
          onSelectChampion={handleChampionSelect}
        />
      ) : viewMode === 'aram-wardrobe' ? (
        <AramWardrobePage
          champions={aramWardrobe}
          onBack={handleAramWardrobeBack}
        />
      ) : viewMode === 'team-skin-lines' ? (
        <TeamSkinLinesPage
          skinLines={skinLines}
          onBack={handleTeamSkinLinesBack}
        />
      ) : viewMode === 'skin-lines' ? (
        <SkinLinesPage
          skinLines={skinLines}
          version={version}
          champions={champions}
          onBack={handleSkinLinesBack}
          onOpenLine={handleOpenSkinLine}
          onOpenMember={handleSkinLineMemberSelect}
        />
      ) : viewMode === 'skin-line-viewer' && activeSkinLine && activeSkinLineMember && selectedChampion && selectedSkin ? (
        <SkinLineViewer
          skinLine={activeSkinLine}
          selectedMember={activeSkinLineMember}
          champion={selectedChampion}
          skin={selectedSkin}
          onBackToLines={handleSkinLineViewerBack}
          onSelectMember={(member) => handleSkinLineMemberSelect(activeSkinLine, member)}
        />
      ) : viewMode === 'history' ? (
        <MatchHistoryPage
          initialRiotId={historyInitialRiotId}
          onBack={handleHistoryBack}
          companionLiveData={liveGameData}
          companionLobbyData={lobbyData}
          companionConnected={liveDebug.companionConnected}
          companionLastLiveUpdateAt={liveDebug.lastLiveUpdateAt}
          companionAccount={accountInfo}
        />
      ) : viewMode === 'companion' ? (
        <CompanionPage
          onBack={handleCompanionBack}
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
