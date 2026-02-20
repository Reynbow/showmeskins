import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemInfo } from '../types';
import { getItems, getLatestVersion } from '../api';
import { ItemTooltip } from './ItemTooltip';
import { TextTooltip } from './TextTooltip';
import './MatchHistoryPage.css';

type Region =
  | 'br1'
  | 'eun1'
  | 'euw1'
  | 'jp1'
  | 'kr'
  | 'la1'
  | 'la2'
  | 'na1'
  | 'oc1'
  | 'tr1'
  | 'ru'
  | 'ph2'
  | 'sg2'
  | 'th2'
  | 'tw2'
  | 'vn2';

interface MatchSummary {
  matchId: string;
  gameMode: string;
  queueId?: number;
  gameDuration: number;
  gameEndTimestamp: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  totalDamageDealtToChampions?: number;
  items?: number[];
  win: boolean;
}

interface HistoryResponse {
  region: Region;
  routingRegion?: 'americas' | 'europe' | 'asia' | 'sea';
  accountRoutingRegion?: 'americas' | 'europe' | 'asia';
  platformRegion?: Region;
  puuid: string;
  gameName: string;
  tagLine: string;
  profile?: {
    summonerLevel: number;
    profileIconId: number;
    ranked: Array<{
      queueType: string;
      tier: string;
      rank: string;
      leaguePoints: number;
      wins: number;
      losses: number;
    }>;
    topMastery?: Array<{
      championId: number;
      championName: string;
      championLevel: number;
      championPoints: number;
    }>;
  } | null;
  matchIds?: string[];
  matches: MatchSummary[];
}

interface MatchParticipant {
  puuid: string;
  summonerName?: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  teamId: number;
  teamPosition?: string;
  championName: string;
  champLevel: number;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  visionScore: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  summoner1Id: number;
  summoner2Id: number;
  win: boolean;
  rankedTier?: string;
  rankedRank?: string;
}

interface MatchDetailResponse {
  matchId: string;
  match?: MatchSummary;
  detail?: {
    queueId: number;
    gameDuration?: number;
    playerTeamId?: number;
    participants: MatchParticipant[];
  };
}

interface MhKillEvent {
  timestamp: number;
  killerChamp: string;
  killerName: string;
  victimChamp: string;
  victimName: string;
  assistChamps: string[];
  killerTeamId: number;
  victimTeamId: number;
  firstBlood?: boolean;
  multiKill?: 'double' | 'triple' | 'quadra' | 'penta';
  killStreak?: string;
  shutdown?: boolean;
  execute?: boolean;
}

interface TimelineResponse {
  matchId: string;
  puuidByParticipantId: Record<number, string>;
  killEvents: Array<{
    timestamp: number;
    killerId: number;
    victimId: number;
    assistingParticipantIds: number[];
    bounty: number;
    shutdownBounty: number;
    multiKillLength: number;
    killStreakLength: number;
  }>;
}

interface MatchSlot {
  matchId: string;
  status: 'loading' | 'ready' | 'failed';
  match?: MatchSummary;
  detail?: MatchDetailResponse['detail'];
  killFeed?: MhKillEvent[];
  killFeedStatus?: 'idle' | 'loading' | 'ready' | 'failed';
}

interface Props {
  initialRiotId?: string;
  onBack: () => void;
}

interface RegionOption {
  value: Region;
  label: string;
  flag: string;
}

const REGION_OPTIONS: RegionOption[] = [
  { value: 'oc1', label: 'Oceania', flag: '\u{1F1E6}\u{1F1FA}' },
  { value: 'br1', label: 'Brazil', flag: '\u{1F1E7}\u{1F1F7}' },
  { value: 'eun1', label: 'Europe Nordic & East', flag: '\u{1F1EA}\u{1F1FA}' },
  { value: 'euw1', label: 'Europe West', flag: '\u{1F1EA}\u{1F1FA}' },
  { value: 'jp1', label: 'Japan', flag: '\u{1F1EF}\u{1F1F5}' },
  { value: 'kr', label: 'Korea', flag: '\u{1F1F0}\u{1F1F7}' },
  { value: 'la1', label: 'Latin America North', flag: '\u{1F1F2}\u{1F1FD}' },
  { value: 'la2', label: 'Latin America South', flag: '\u{1F1E6}\u{1F1F7}' },
  { value: 'na1', label: 'North America', flag: '\u{1F1FA}\u{1F1F8}' },
  { value: 'tr1', label: 'Turkey', flag: '\u{1F1F9}\u{1F1F7}' },
  { value: 'ru', label: 'Russia', flag: '\u{1F1F7}\u{1F1FA}' },
  { value: 'ph2', label: 'Philippines', flag: '\u{1F1F5}\u{1F1ED}' },
  { value: 'sg2', label: 'Singapore', flag: '\u{1F1F8}\u{1F1EC}' },
  { value: 'th2', label: 'Thailand', flag: '\u{1F1F9}\u{1F1ED}' },
  { value: 'tw2', label: 'Taiwan', flag: '\u{1F1F9}\u{1F1FC}' },
  { value: 'vn2', label: 'Vietnam', flag: '\u{1F1FB}\u{1F1F3}' },
];

function splitRiotId(input: string): { gameName: string; tagLine: string } {
  const trimmed = input.trim();
  const idx = trimmed.indexOf('#');
  if (idx <= 0 || idx === trimmed.length - 1) {
    return { gameName: trimmed, tagLine: '' };
  }
  return {
    gameName: trimmed.slice(0, idx).trim(),
    tagLine: trimmed.slice(idx + 1).trim(),
  };
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

function formatRelative(ts: number): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatQueue(queueId: number | undefined, gameMode: string): string {
  const map: Record<number, string> = {
    420: 'Ranked Solo/Duo',
    440: 'Ranked Flex',
    400: 'Normal Draft',
    430: 'Normal Blind',
    450: 'ARAM',
    1700: 'Arena',
  };
  return (queueId ? map[queueId] : undefined) || gameMode || 'Match';
}

function formatProfileIcon(profileIconId: number): string {
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`;
}

function formatItemIcon(itemId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/15.4.1/img/item/${itemId}.png`;
}

function getItemIconUrl(version: string, itemId: number): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
}

function formatChampionFaceIcon(championName: string, version: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
}

function formatRankIcon(tier: string): string {
  const t = tier.toLowerCase();
  if (t === 'unranked') {
    return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/unranked.svg`;
  }
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${t}.png`;
}

const TIER_COLORS: Record<string, string> = {
  IRON: '#86736a',
  BRONZE: '#b08d5b',
  SILVER: '#9ea4ab',
  GOLD: '#f0b548',
  PLATINUM: '#4eb8b2',
  EMERALD: '#2dba72',
  DIAMOND: '#6b7ff5',
  MASTER: '#b55df0',
  GRANDMASTER: '#ef4747',
  CHALLENGER: '#f4c874',
};

const SPELL_DATA: Record<number, { file: string; name: string }> = {
  1: { file: 'SummonerBoost', name: 'Cleanse' },
  3: { file: 'SummonerExhaust', name: 'Exhaust' },
  4: { file: 'SummonerFlash', name: 'Flash' },
  6: { file: 'SummonerHaste', name: 'Ghost' },
  7: { file: 'SummonerHeal', name: 'Heal' },
  11: { file: 'SummonerSmite', name: 'Smite' },
  12: { file: 'SummonerTeleport', name: 'Teleport' },
  13: { file: 'SummonerMana', name: 'Clarity' },
  14: { file: 'SummonerDot', name: 'Ignite' },
  21: { file: 'SummonerBarrier', name: 'Barrier' },
  32: { file: 'SummonerSnowball', name: 'Mark' },
};

function formatSummonerSpell(spellId: number): string {
  const file = SPELL_DATA[spellId]?.file ?? `Summoner${spellId}`;
  return `https://ddragon.leagueoflegends.com/cdn/15.4.1/img/spell/${file}.png`;
}

function getSpellName(spellId: number): string {
  return SPELL_DATA[spellId]?.name ?? `Spell ${spellId}`;
}

function formatGold(gold: number): string {
  if (gold >= 1000) return `${(gold / 1000).toFixed(1)}k`;
  return String(Math.floor(gold));
}

const RANK_SHORT: Record<string, string> = {
  I: '1', II: '2', III: '3', IV: '4',
};

function formatRankShort(tier?: string, rank?: string): string {
  if (!tier) return '';
  const t = tier.charAt(0).toUpperCase();
  const r = rank ? (RANK_SHORT[rank] ?? rank) : '';
  return `${t}${r}`;
}

function formatRankMiniIcon(tier: string): string {
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${tier.toLowerCase()}.svg`;
}

function kdaColor(kda: number): string {
  const clamped = Math.min(Math.max(kda, 0), 6);
  const hue = (clamped / 6) * 120;
  return `hsl(${hue}, 70%, 55%)`;
}

function formatChampionSplash(championName: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_0.jpg`;
}

const MH_MULTI_KILL_TOOLTIPS: Record<string, string> = {
  double: '2 kills within ~10 seconds',
  triple: '3 kills within ~10 seconds',
  quadra: '4 kills within ~10 seconds',
  penta: '5 kills within ~10 seconds (Ace)',
};

const MH_KILL_STREAK_TOOLTIPS: Record<string, string> = {
  killing_spree: '3 kills without dying',
  rampage: '4 kills without dying',
  unstoppable: '5 kills without dying',
  godlike: '6 kills without dying',
  legendary: '7+ kills without dying',
};

function mhMvpScore(p: MatchParticipant): number {
  const cs = p.totalMinionsKilled + p.neutralMinionsKilled;
  return p.kills * 3 + p.assists * 1.5 - p.deaths * 1.2 + cs * 0.012;
}

function getMhMvpBreakdown(p: MatchParticipant) {
  const cs = p.totalMinionsKilled + p.neutralMinionsKilled;
  const killScore = p.kills * 3;
  const assistScore = p.assists * 1.5;
  const deathPenalty = p.deaths * 1.2;
  const csScore = cs * 0.012;
  const total = killScore + assistScore - deathPenalty + csScore;
  return (
    <div className="mvp-breakdown">
      <div className="mvp-breakdown-header">
        <span className="mvp-breakdown-title">MVP Score</span>
        <span className="mvp-breakdown-total">{total.toFixed(1)}</span>
      </div>
      <div className="mvp-breakdown-rows">
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Kills</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.kills}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">3</span>
          </span>
          <span className="mvp-breakdown-value">+{killScore.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Assists</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.assists}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">1.5</span>
          </span>
          <span className="mvp-breakdown-value">+{assistScore.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">Deaths</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{p.deaths}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">1.2</span>
          </span>
          <span className="mvp-breakdown-value mvp-breakdown-value--penalty">-{deathPenalty.toFixed(1)}</span>
        </div>
        <div className="mvp-breakdown-row">
          <span className="mvp-breakdown-key">CS</span>
          <span className="mvp-breakdown-calc">
            <span className="mvp-breakdown-calc-value">{cs}</span>
            <span className="mvp-breakdown-calc-op"> x </span>
            <span className="mvp-breakdown-calc-mult">0.012</span>
          </span>
          <span className="mvp-breakdown-value">+{csScore.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

const MH_SPECIAL_KILL_TOOLTIPS: Record<string, string> = {
  first_blood: 'First champion-vs-champion kill of the match',
  shutdown: 'Ended a 3+ kill streak',
  execute: 'Killed by a non-champion source (turret, minion, etc.)',
};

function processTimeline(
  timeline: TimelineResponse,
  participants: MatchParticipant[],
): MhKillEvent[] {
  const puuidToParticipant: Record<string, MatchParticipant> = {};
  for (const p of participants) puuidToParticipant[p.puuid] = p;

  const idToParticipant: Record<number, MatchParticipant | undefined> = {};
  for (const [idStr, puuid] of Object.entries(timeline.puuidByParticipantId)) {
    idToParticipant[Number(idStr)] = puuidToParticipant[puuid];
  }

  let hadFirstBlood = false;

  const MULTI_KILL_WINDOW = 10_000;
  const MULTI_KILL_NAMES: Record<number, MhKillEvent['multiKill']> = {
    2: 'double', 3: 'triple', 4: 'quadra', 5: 'penta',
  };

  const lastKillTime: Record<number, number> = {};
  const multiChain: Record<number, number> = {};
  const deathStreakReset: Record<number, number> = {};

  const events: MhKillEvent[] = [];
  for (const raw of timeline.killEvents) {
    const killer = idToParticipant[raw.killerId];
    const victim = idToParticipant[raw.victimId];
    const isExecute = raw.killerId === 0;

    const killerChamp = killer?.championName ?? (isExecute ? '_execute' : '_unknown');
    const killerName = killer?.riotIdGameName ?? killer?.summonerName ?? (isExecute ? 'Executed' : 'Unknown');
    const victimChamp = victim?.championName ?? '_unknown';
    const victimName = victim?.riotIdGameName ?? victim?.summonerName ?? 'Unknown';
    const assistChamps = raw.assistingParticipantIds
      .map((id) => idToParticipant[id]?.championName)
      .filter(Boolean) as string[];

    let multiKill: MhKillEvent['multiKill'];
    if (raw.multiKillLength >= 2) {
      multiKill = MULTI_KILL_NAMES[Math.min(raw.multiKillLength, 5)];
    } else if (!isExecute && raw.killerId > 0) {
      const prev = lastKillTime[raw.killerId];
      if (prev !== undefined && raw.timestamp - prev < MULTI_KILL_WINDOW) {
        multiChain[raw.killerId] = (multiChain[raw.killerId] ?? 1) + 1;
      } else {
        multiChain[raw.killerId] = 1;
      }
      lastKillTime[raw.killerId] = raw.timestamp;
      multiKill = MULTI_KILL_NAMES[Math.min(multiChain[raw.killerId], 5)];
    }

    let killStreak: string | undefined;
    if (raw.killStreakLength >= 3) {
      const s = raw.killStreakLength;
      if (s >= 7) killStreak = 'legendary';
      else if (s === 6) killStreak = 'godlike';
      else if (s === 5) killStreak = 'unstoppable';
      else if (s === 4) killStreak = 'rampage';
      else killStreak = 'killing_spree';
    } else if (!isExecute && raw.killerId > 0) {
      deathStreakReset[raw.killerId] = (deathStreakReset[raw.killerId] ?? 0) + 1;
      if (raw.victimId > 0) deathStreakReset[raw.victimId] = 0;
      const streak = deathStreakReset[raw.killerId];
      if (streak >= 7) killStreak = 'legendary';
      else if (streak === 6) killStreak = 'godlike';
      else if (streak === 5) killStreak = 'unstoppable';
      else if (streak === 4) killStreak = 'rampage';
      else if (streak === 3) killStreak = 'killing_spree';
    }

    let firstBlood = false;
    if (!hadFirstBlood && !isExecute) {
      hadFirstBlood = true;
      firstBlood = true;
    }

    events.push({
      timestamp: raw.timestamp,
      killerChamp,
      killerName,
      victimChamp,
      victimName,
      assistChamps,
      killerTeamId: killer?.teamId ?? 0,
      victimTeamId: victim?.teamId ?? 0,
      firstBlood: firstBlood || undefined,
      multiKill,
      killStreak,
      shutdown: raw.shutdownBounty > 0 ? true : undefined,
      execute: isExecute ? true : undefined,
    });
  }
  return events;
}

function formatMasteryPoints(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`;
  if (points >= 1_000) return `${(points / 1_000).toFixed(0)}K`;
  return String(points);
}

export function MatchHistoryPage({ initialRiotId = '', onBack }: Props) {
  const initialParsed = splitRiotId(initialRiotId);
  const [gameName, setGameName] = useState(initialParsed.gameName);
  const [tagLine, setTagLine] = useState(initialParsed.tagLine);
  const [region, setRegion] = useState<Region>('oc1');
  const [regionOpen, setRegionOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [matchSlots, setMatchSlots] = useState<MatchSlot[]>([]);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<'scoreboard' | 'killfeed'>('scoreboard');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [pendingSearch, setPendingSearch] = useState(0);
  const searchPuuidRef = useRef<string>('');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<() => void>(() => {});
  const [itemData, setItemData] = useState<Record<number, ItemInfo>>({});
  const [spellInfo, setSpellInfo] = useState<Record<number, { name: string; description: string; cooldown: number; file: string }>>({});
  const [champInfo, setChampInfo] = useState<Record<string, { name: string; title: string; blurb: string; tags: string[] }>>({});
  const [ddragonVersion, setDdragonVersion] = useState('16.4.1');
  const regionPickerRef = useRef<HTMLDivElement | null>(null);
  const lastAutoSearchKeyRef = useRef<string>('');
  const searchRequestIdRef = useRef(0);
  const selectedRegion = REGION_OPTIONS.find((opt) => opt.value === region) ?? REGION_OPTIONS[0];
  const loadedMatches = matchSlots.filter((slot) => slot.status === 'ready').length;
  const totalMatches = matchSlots.length;

  const rankedSolo = result?.profile?.ranked.find((r) => String(r.queueType).toUpperCase() === 'RANKED_SOLO_5X5');
  const rankedFlex = result?.profile?.ranked.find((r) => String(r.queueType).toUpperCase() === 'RANKED_FLEX_SR');
  const primaryRank = rankedSolo ?? rankedFlex ?? result?.profile?.ranked[0];

  const topMastery = result?.profile?.topMastery ?? [];
  const profileBgChampion = topMastery.length > 0 ? topMastery[0].championName : null;

  useEffect(() => {
    Promise.all([getItems(), getLatestVersion()]).then(async ([items, ver]) => {
      setItemData(items);
      setDdragonVersion(ver);
      try {
        const [spellRes, champRes] = await Promise.all([
          fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/summoner.json`),
          fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/championFull.json`),
        ]);
        const spellJson = await spellRes.json() as { data: Record<string, { key: string; id: string; name: string; description: string; cooldown: number[] }> };
        const spellMap: Record<number, { name: string; description: string; cooldown: number; file: string }> = {};
        for (const spell of Object.values(spellJson.data)) {
          spellMap[Number(spell.key)] = {
            name: spell.name,
            description: spell.description,
            cooldown: spell.cooldown?.[0] ?? 0,
            file: spell.id,
          };
        }
        setSpellInfo(spellMap);

        const champJson = await champRes.json() as { data: Record<string, { id: string; name: string; title: string; lore: string; blurb: string; tags: string[] }> };
        const champMap: Record<string, { name: string; title: string; blurb: string; tags: string[] }> = {};
        for (const c of Object.values(champJson.data)) {
          champMap[c.id] = { name: c.name, title: c.title, blurb: c.lore || c.blurb, tags: c.tags };
        }
        setChampInfo(champMap);
      } catch { /* supplementary data is optional */ }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const parsed = splitRiotId(initialRiotId);
    setGameName(parsed.gameName);
    setTagLine(parsed.tagLine);
  }, [initialRiotId]);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const riotId = params.get('riotId') ?? '';
      if (!riotId) return;
      const parsed = splitRiotId(riotId);
      if (parsed.gameName && parsed.tagLine) {
        const key = `${parsed.gameName.toLowerCase()}#${parsed.tagLine.toLowerCase()}|${region}`;
        lastAutoSearchKeyRef.current = key;
        setGameName(parsed.gameName);
        setTagLine(parsed.tagLine);
        searchPuuidRef.current = '';
        setPendingSearch((n) => n + 1);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [region]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!regionPickerRef.current) return;
      if (!regionPickerRef.current.contains(event.target as Node)) {
        setRegionOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  const PROFILE_CACHE_PREFIX = 'mh_profile_';
  const PROFILE_TTL = 5 * 60 * 1000;

  function getProfileCacheKey(name: string, tag: string, reg: string): string {
    return PROFILE_CACHE_PREFIX + `${name.toLowerCase()}#${tag.toLowerCase()}@${reg}`;
  }

  function getCachedProfile(name: string, tag: string, reg: string): HistoryResponse | null {
    try {
      const raw = localStorage.getItem(getProfileCacheKey(name, tag, reg));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts: number; data: HistoryResponse };
      if (Date.now() - parsed.ts > PROFILE_TTL) {
        localStorage.removeItem(getProfileCacheKey(name, tag, reg));
        return null;
      }
      return parsed.data;
    } catch { return null; }
  }

  function cacheProfile(name: string, tag: string, reg: string, data: HistoryResponse) {
    try {
      localStorage.setItem(getProfileCacheKey(name, tag, reg), JSON.stringify({ ts: Date.now(), data }));
    } catch { /* storage full or unavailable */ }
  }

  const MATCH_CACHE_PREFIX = 'mh_match_';
  const MAX_CACHE_ENTRIES = 200;

  function getCachedMatch(matchId: string): MatchSlot | null {
    try {
      const raw = localStorage.getItem(MATCH_CACHE_PREFIX + matchId);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { match: MatchSummary; detail: MatchDetailResponse['detail'] };
      if (!parsed.match) return null;
      return { matchId, status: 'ready', match: parsed.match, detail: parsed.detail };
    } catch { return null; }
  }

  function cacheMatch(matchId: string, match: MatchSummary, detail: MatchDetailResponse['detail']) {
    try {
      localStorage.setItem(MATCH_CACHE_PREFIX + matchId, JSON.stringify({ match, detail }));
      pruneMatchCache();
    } catch { /* storage full or unavailable */ }
  }

  function pruneMatchCache() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(MATCH_CACHE_PREFIX)) keys.push(k);
      }
      if (keys.length > MAX_CACHE_ENTRIES) {
        keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach((k) => localStorage.removeItem(k));
      }
    } catch { /* ignore */ }
  }

  const runSearch = async () => {
    const trimmedGameName = gameName.trim();
    const trimmedTagLine = tagLine.trim();
    const lookupPuuid = searchPuuidRef.current;
    searchPuuidRef.current = '';

    if (!lookupPuuid && (!trimmedGameName || !trimmedTagLine)) {
      setError('Enter both Riot game name and tag.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setMatchSlots([]);
    setExpandedMatchId(null);
    setHasMore(false);
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;

    try {
      const cachedProfile = (!lookupPuuid && trimmedGameName && trimmedTagLine)
        ? getCachedProfile(trimmedGameName, trimmedTagLine, region)
        : null;

      let initial: HistoryResponse;
      if (cachedProfile) {
        initial = cachedProfile;
      } else {
        const params = new URLSearchParams({ region, count: '10', summaryOnly: '1' });
        if (lookupPuuid) {
          params.set('puuid', lookupPuuid);
        }
        if (trimmedGameName) params.set('gameName', trimmedGameName);
        if (trimmedTagLine) params.set('tagLine', trimmedTagLine);
        const res = await fetch(`/api/riot-id-history?${params.toString()}`);
        const body = await res.json();
        if (!res.ok) {
          const msg = typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`;
          const details = typeof body?.details === 'string' && body.details ? `: ${body.details}` : '';
          throw new Error(`${msg}${details}`);
        }
        initial = body as HistoryResponse;
        if (initial.gameName && initial.tagLine) {
          setGameName(initial.gameName);
          setTagLine(initial.tagLine);
          cacheProfile(initial.gameName, initial.tagLine, region, initial);
        }
      }

      if (initial.gameName && initial.tagLine) {
        const riotId = `${initial.gameName}#${initial.tagLine}`;
        const newUrl = `/history?riotId=${encodeURIComponent(riotId)}`;
        if (window.location.pathname + window.location.search !== newUrl) {
          window.history.pushState(null, '', newUrl);
        }
      }

      const matchIds = Array.isArray(initial.matchIds) ? initial.matchIds : [];
      if (searchRequestIdRef.current !== requestId) return;

      setResult({ ...initial, matches: [] });
      setMatchSlots(matchIds.map((id) => ({ matchId: id, status: 'loading' as const })));
      setHasMore(matchIds.length >= 10);

      for (let i = 0; i < matchIds.length; i++) {
        const id = matchIds[i];

        const cached = getCachedMatch(id);
        if (cached) {
          if (searchRequestIdRef.current !== requestId) return;
          setMatchSlots((prev) => {
            const next = [...prev];
            if (i < next.length) next[i] = cached;
            return next;
          });
          continue;
        }

        const detailParams = new URLSearchParams({
          region,
          puuid: initial.puuid,
          matchId: id,
        });
        try {
          const detailRes = await fetch(`/api/riot-id-history?${detailParams.toString()}`);
          const detailBody = (await detailRes.json()) as MatchDetailResponse;
          const slot: MatchSlot = detailRes.ok && detailBody.match
            ? { matchId: id, status: 'ready', match: detailBody.match, detail: detailBody.detail }
            : { matchId: id, status: 'failed' };
          if (detailRes.ok && detailBody.match) {
            cacheMatch(id, detailBody.match, detailBody.detail);
          }
          if (searchRequestIdRef.current !== requestId) return;
          setMatchSlots((prev) => {
            const next = [...prev];
            if (i < next.length) next[i] = slot;
            return next;
          });
        } catch {
          if (searchRequestIdRef.current !== requestId) return;
          setMatchSlots((prev) => {
            const next = [...prev];
            if (i < next.length) next[i] = { matchId: id, status: 'failed' };
            return next;
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch match history');
    } finally {
      setLoading(false);
    }
  };

  const fetchKillFeed = async (matchId: string) => {
    setMatchSlots((prev) => prev.map((s) =>
      s.matchId === matchId ? { ...s, killFeedStatus: 'loading' } : s,
    ));
    try {
      const params = new URLSearchParams({ matchId, region, timeline: '1' });
      const res = await fetch(`/api/riot-id-history?${params.toString()}`);
      if (!res.ok) throw new Error('Timeline fetch failed');
      const body = await res.json() as TimelineResponse;
      setMatchSlots((prev) => prev.map((s) => {
        if (s.matchId !== matchId || !s.detail) return s;
        const killFeed = processTimeline(body, s.detail.participants);
        return { ...s, killFeed, killFeedStatus: 'ready' };
      }));
    } catch {
      setMatchSlots((prev) => prev.map((s) =>
        s.matchId === matchId ? { ...s, killFeedStatus: 'failed' } : s,
      ));
    }
  };

  const loadMore = async () => {
    if (!result || loadingMore) return;
    setLoadingMore(true);
    const currentCount = matchSlots.length;

    try {
      const params = new URLSearchParams({
        gameName: result.gameName,
        tagLine: result.tagLine,
        region,
        count: '5',
        start: String(currentCount),
        summaryOnly: '1',
      });
      const res = await fetch(`/api/riot-id-history?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Failed to load more matches');

      const moreIds: string[] = Array.isArray(body.matchIds) ? body.matchIds : [];
      if (moreIds.length === 0) {
        setHasMore(false);
        return;
      }
      setHasMore(moreIds.length >= 5);

      const newSlots: MatchSlot[] = moreIds.map((id) => ({ matchId: id, status: 'loading' as const }));
      setMatchSlots((prev) => [...prev, ...newSlots]);

      for (let i = 0; i < moreIds.length; i++) {
        const id = moreIds[i];
        const slotIndex = currentCount + i;

        const cached = getCachedMatch(id);
        if (cached) {
          setMatchSlots((prev) => {
            const next = [...prev];
            if (slotIndex < next.length) next[slotIndex] = cached;
            return next;
          });
          continue;
        }

        const detailParams = new URLSearchParams({
          region,
          puuid: result.puuid,
          matchId: id,
        });
        try {
          const detailRes = await fetch(`/api/riot-id-history?${detailParams.toString()}`);
          const detailBody = (await detailRes.json()) as MatchDetailResponse;
          const slot: MatchSlot = detailRes.ok && detailBody.match
            ? { matchId: id, status: 'ready', match: detailBody.match, detail: detailBody.detail }
            : { matchId: id, status: 'failed' };
          if (detailRes.ok && detailBody.match) {
            cacheMatch(id, detailBody.match, detailBody.detail);
          }
          setMatchSlots((prev) => {
            const next = [...prev];
            if (slotIndex < next.length) next[slotIndex] = slot;
            return next;
          });
        } catch {
          setMatchSlots((prev) => {
            const next = [...prev];
            if (slotIndex < next.length) next[slotIndex] = { matchId: id, status: 'failed' };
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Load more failed:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  loadMoreRef.current = loadMore;

  // Infinite scroll: trigger loadMore when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMoreRef.current();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [result, hasMore, loading]);

  const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.dataset.retried) {
      img.dataset.retried = '1';
      const src = img.src;
      img.src = '';
      setTimeout(() => { img.src = src; }, 500);
    } else {
      img.style.visibility = 'hidden';
    }
  }, []);

  useEffect(() => {
    const fromUrl = initialRiotId.trim();
    if (!fromUrl) return;
    const parsed = splitRiotId(fromUrl);
    if (!parsed.gameName || !parsed.tagLine) return;
    const key = `${parsed.gameName.toLowerCase()}#${parsed.tagLine.toLowerCase()}|${region}`;
    if (lastAutoSearchKeyRef.current === key) return;
    lastAutoSearchKeyRef.current = key;
    runSearch();
  }, [initialRiotId, region]);

  useEffect(() => {
    if (pendingSearch > 0) runSearch();
  }, [pendingSearch]);

  return (
    <div className="mh-page">
      <div className="mh-bg-glow" />
      <div className="mh-bg-lines" />
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
            <div className="mh-riot-id-inputs">
              <input
                type="text"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
                placeholder="Game Name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
              <span className="mh-riot-separator" aria-hidden="true">#</span>
              <input
                type="text"
                value={tagLine}
                onChange={(e) => setTagLine(e.target.value)}
                placeholder="Tag"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
              />
            </div>
          </div>
          <div className="mh-field mh-field--region">
            <label>Region</label>
            <div className="mh-region-picker" ref={regionPickerRef}>
              <button
                type="button"
                className="mh-region-trigger"
                onClick={() => setRegionOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={regionOpen}
              >
                <span className="mh-region-selected">
                  <span className="mh-region-icon" aria-hidden="true">{selectedRegion.flag}</span>
                  <span>{selectedRegion.label}</span>
                </span>
                <span className="mh-region-caret">{'\u25BE'}</span>
              </button>
              {regionOpen && (
                <div className="mh-region-menu" role="listbox">
                  {REGION_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === region}
                      className={`mh-region-option${option.value === region ? ' is-selected' : ''}`}
                      onClick={() => {
                        setRegion(option.value);
                        setRegionOpen(false);
                      }}
                    >
                      <span className="mh-region-icon" aria-hidden="true">{option.flag}</span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button className="mh-search-btn" onClick={runSearch} disabled={loading}>
            {loading ? 'Loading...' : 'Search'}
          </button>
        </div>

        {error && <p className="mh-error">{error}</p>}

        {loading && !result && (
          <>
            <div className="mh-profile-card mh-skeleton-card">
              <div className="mh-profile-head">
                <div className="mh-skeleton mh-skeleton-icon" />
                <div className="mh-profile-info">
                  <div className="mh-skeleton mh-skeleton-name" />
                  <div className="mh-skeleton mh-skeleton-meta" />
                </div>
                <div className="mh-mastery-section" style={{ position: 'static', transform: 'none' }}>
                  <div className="mh-mastery-list">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="mh-mastery-item">
                        <div className="mh-skeleton mh-skeleton-mastery-portrait" />
                        <div className="mh-skeleton mh-skeleton-mastery-name" />
                        <div className="mh-skeleton mh-skeleton-mastery-pts" />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mh-profile-rank">
                  <div className="mh-skeleton mh-skeleton-rank-emblem" />
                  <div className="mh-rank-details">
                    <div className="mh-skeleton mh-skeleton-rank-line" />
                    <div className="mh-skeleton mh-skeleton-rank-line mh-skeleton-rank-line--short" />
                    <div className="mh-skeleton mh-skeleton-rank-bar" />
                  </div>
                </div>
              </div>
            </div>
            <div className="mh-list">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="mh-card mh-skeleton-match">
                  <div className="mh-card-main">
                    <div className="mh-skeleton mh-skeleton-match-champ" />
                    <div className="mh-card-body">
                      <div className="mh-skeleton mh-skeleton-match-topline" />
                      <div className="mh-skeleton mh-skeleton-match-midline" />
                    </div>
                    <div className="mh-skeleton mh-skeleton-match-items" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {result && (
          <>
            <div className="mh-profile-card">
              {profileBgChampion && (
                <img
                  className="mh-profile-bg"
                  src={formatChampionSplash(profileBgChampion)}
                  alt=""
                  loading="lazy"
                  onError={handleImgError}
                />
              )}
              <div className="mh-profile-bg-fade" />
              <div className="mh-profile-head">
                <img
                  className="mh-profile-icon"
                  src={formatProfileIcon(result.profile?.profileIconId ?? 29)}
                  alt={`${result.gameName} profile icon`}
                  loading="lazy"
                  onError={handleImgError}
                />
                <div className="mh-profile-info">
                  <div className="mh-profile-name">{result.gameName}<span className="mh-profile-tag">#{result.tagLine}</span></div>
                  <div className="mh-profile-meta">
                    Level {result.profile?.summonerLevel ?? '-'}
                    <span className="mh-profile-region">{REGION_OPTIONS.find((opt) => opt.value === result.region)?.label ?? result.region}</span>
                  </div>
                </div>
                {topMastery.length > 0 && (
                  <div className="mh-mastery-section">
                    <div className="mh-mastery-list">
                      {topMastery.map((m) => (
                        <div key={m.championId} className="mh-mastery-item">
                          <div className="mh-mastery-portrait">
                            <img
                              className="mh-mastery-champ-img"
                              src={formatChampionFaceIcon(m.championName, ddragonVersion)}
                              alt={m.championName}
                              loading="lazy"
                              onError={handleImgError}
                            />
                            <span className="mh-mastery-level-badge">{m.championLevel}</span>
                          </div>
                          <div className="mh-mastery-champ-name">{m.championName}</div>
                          <div className="mh-mastery-points">{formatMasteryPoints(m.championPoints)} pts</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mh-profile-rank">
                  {primaryRank ? (() => {
                    const tierColor = TIER_COLORS[primaryRank.tier.toUpperCase()] ?? '#c8aa6e';
                    const winRate = (primaryRank.wins / Math.max(1, primaryRank.wins + primaryRank.losses)) * 100;
                    return (
                      <>
                        <div className="mh-rank-badge">
                          <img
                            className={`mh-rank-emblem${['PLATINUM', 'EMERALD'].includes(primaryRank.tier.toUpperCase()) ? ' mh-rank-emblem--oversized' : ''}`}
                            src={formatRankIcon(primaryRank.tier)}
                            alt={`${primaryRank.tier} emblem`}
                            loading="lazy"
                          />
                        </div>
                        <div className="mh-rank-details">
                          <div className="mh-rank-queue">{String(primaryRank.queueType).toUpperCase() === 'RANKED_SOLO_5X5' ? 'Ranked Solo' : 'Ranked Flex'}</div>
                          <div className="mh-rank-tier-row">
                            <span className="mh-rank-tier" style={{ color: tierColor }}>{primaryRank.tier} {primaryRank.rank}</span>
                            <span className="mh-rank-lp">{primaryRank.leaguePoints} LP</span>
                          </div>
                          <div className="mh-rank-bar">
                            <div className="mh-rank-bar-fill" style={{ width: `${primaryRank.leaguePoints}%`, backgroundColor: tierColor }} />
                          </div>
                          <div className="mh-rank-record">
                            <span className="mh-rank-wr">{winRate.toFixed(1)}% WR</span>
                            <span className="mh-rank-wl">{primaryRank.wins}W - {primaryRank.losses}L</span>
                          </div>
                        </div>
                      </>
                    );
                  })() : (
                    <>
                      <div className="mh-rank-badge">
                        <img
                          className="mh-rank-emblem"
                          src={formatRankIcon('unranked')}
                          alt="Unranked emblem"
                          loading="lazy"
                        />
                      </div>
                      <div className="mh-rank-details">
                        <div className="mh-rank-tier" style={{ color: '#7a7a7a' }}>Unranked</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>


            <div className="mh-list">
              {matchSlots.map((slot) => {
                if (slot.status !== 'ready' || !slot.match) {
                  return (
                    <div key={slot.matchId} className={`mh-card mh-skeleton-match${slot.status === 'failed' ? ' mh-skeleton-match--failed' : ''}`}>
                      <div className="mh-card-main">
                        <div className="mh-skeleton mh-skeleton-match-champ" />
                        <div className="mh-card-body">
                          <div className="mh-skeleton mh-skeleton-match-topline" />
                          <div className="mh-skeleton mh-skeleton-match-midline" />
                        </div>
                        <div className="mh-skeleton mh-skeleton-match-items" />
                      </div>
                      {slot.status === 'failed' && (
                        <div className="mh-skeleton-fail-label">Match unavailable</div>
                      )}
                    </div>
                  );
                }

                const player = slot.detail?.participants.find((p) => p.puuid === result.puuid);
                const kills = player?.kills ?? slot.match.kills;
                const deaths = player?.deaths ?? slot.match.deaths;
                const assists = player?.assists ?? slot.match.assists;
                const kdaRatio = deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : 'Perfect';
                const damage = player?.totalDamageDealtToChampions ?? slot.match.totalDamageDealtToChampions ?? 0;
                const build = player
                  ? [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5, player.item6]
                  : (slot.match.items ?? []);

                const csPerMin = slot.match.gameDuration > 0
                  ? ((player?.totalMinionsKilled ?? 0) + (player?.neutralMinionsKilled ?? 0)) / (slot.match.gameDuration / 60)
                  : 0;
                const totalCs = (player?.totalMinionsKilled ?? 0) + (player?.neutralMinionsKilled ?? 0);
                const queueLabel = slot.detail ? formatQueue(slot.detail.queueId, slot.match.gameMode) : slot.match.gameMode;

                const isExpanded = expandedMatchId === slot.matchId;
                const participants = slot.detail?.participants ?? [];
                const playerTeamId = participants.find((p) => p.puuid === result.puuid)?.teamId ?? 100;
                const team1 = participants.filter((p) => p.teamId === 100);
                const team2 = participants.filter((p) => p.teamId === 200);
                const team1Win = team1[0]?.win ?? false;
                const team2Win = team2[0]?.win ?? false;

                const mvpPlayer = participants.length > 0
                  ? participants.reduce((best, p) => mhMvpScore(p) > mhMvpScore(best) ? p : best, participants[0])
                  : undefined;
                const youAreMvp = mvpPlayer && mvpPlayer.puuid === result.puuid;

                return (
                  <div key={slot.matchId} className={`mh-card ${slot.match.win ? 'mh-card--win' : 'mh-card--loss'}`}>
                    <div className="mh-card-accent" />
                    <div
                      className="mh-card-main mh-card-clickable"
                      onClick={() => { setExpandedMatchId(isExpanded ? null : slot.matchId); setExpandedTab('scoreboard'); }}
                    >
                      <TextTooltip className="mh-champion-face-wrap" variant="spell" content={(() => {
                        const ci = champInfo[slot.match.championName];
                        return (
                          <>
                            <div className="item-tooltip-header">
                              <img className="item-tooltip-icon" src={formatChampionFaceIcon(slot.match.championName, ddragonVersion)} alt="" />
                              <div className="item-tooltip-title">
                                <span className="item-tooltip-name">{ci?.name ?? slot.match.championName}</span>
                                {ci?.title && <span className="mh-champ-tooltip-title">{ci.title}</span>}
                              </div>
                              {ci?.tags && ci.tags.length > 0 && <span className="item-tooltip-gold">{ci.tags.join(' / ')}</span>}
                            </div>
                            {ci?.blurb && <div className="item-tooltip-body">{ci.blurb}</div>}
                          </>
                        );
                      })()}>
                        <img
                          className="mh-champion-face"
                          src={formatChampionFaceIcon(slot.match.championName, ddragonVersion)}
                          alt={slot.match.championName}
                          loading="lazy"
                          onError={handleImgError}
                        />
                      </TextTooltip>
                      <div className="mh-card-body">
                        <div className="mh-card-topline">
                          <span className={`mh-result ${slot.match.win ? 'mh-result--win' : 'mh-result--loss'}`}>
                            {slot.match.win ? 'Victory' : 'Defeat'}
                          </span>
                          <span className="mh-card-sep">&middot;</span>
                          <span className="mh-card-meta">{queueLabel}</span>
                          <span className="mh-card-sep">&middot;</span>
                          <span className="mh-card-meta">{formatDuration(slot.match.gameDuration)}</span>
                          <span className="mh-card-sep">&middot;</span>
                          <span className="mh-card-meta">{formatRelative(slot.match.gameEndTimestamp)}</span>
                          {youAreMvp && mvpPlayer && (
                            <TextTooltip content={getMhMvpBreakdown(mvpPlayer)} variant="mvp" className="mh-mvp-badge-wrap">
                              <span className="mh-mvp-badge">MVP</span>
                            </TextTooltip>
                          )}
                        </div>
                        <div className="mh-card-midline">
                          <div className="mh-card-stat">
                            <span className="mh-card-stat-value">{kdaRatio} KDA</span>
                            <span className="mh-card-stat-detail">{kills} / {deaths} / {assists}</span>
                          </div>
                          <div className="mh-card-stat">
                            <span className="mh-card-stat-value">{csPerMin.toFixed(1)} CS/Min.</span>
                            <span className="mh-card-stat-detail">{totalCs} CS</span>
                          </div>
                          <div className="mh-card-stat">
                            <span className="mh-card-stat-value">{(damage / 1000).toFixed(1)}K</span>
                            <span className="mh-card-stat-detail">Damage</span>
                          </div>
                          <div className="mh-build-inline">
                            {build.map((item, idx) => {
                              if (!item) return <span key={`${slot.matchId}-self-item-${idx}`} className="mh-icon mh-icon--empty" />;
                              const info = itemData[item];
                              return (
                                <ItemTooltip
                                  key={`${slot.matchId}-self-item-${idx}`}
                                  itemId={item}
                                  itemDisplayName={info?.name ?? ''}
                                  itemPrice={info?.goldTotal ?? 0}
                                  itemCount={1}
                                  info={info}
                                  version={ddragonVersion}
                                  getItemIconUrl={getItemIconUrl}
                                  className="mh-icon mh-icon--item"
                                >
                                  <img src={getItemIconUrl(ddragonVersion, item)} alt={info?.name ?? ''} loading="lazy" />
                                </ItemTooltip>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <span className={`mh-card-chevron ${isExpanded ? 'mh-card-chevron--open' : ''}`}>&#9662;</span>
                    </div>
                    {isExpanded && participants.length > 0 && (() => {
                      const maxDmg = Math.max(1, ...participants.map((p) => p.totalDamageDealtToChampions));
                      return (
                        <div className="mh-expanded-panel">
                          <div className="mh-expanded-tabs">
                            <button
                              className={`mh-expanded-tab${expandedTab === 'scoreboard' ? ' mh-expanded-tab--active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setExpandedTab('scoreboard'); }}
                            >Scoreboard</button>
                            <button
                              className={`mh-expanded-tab${expandedTab === 'killfeed' ? ' mh-expanded-tab--active' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedTab('killfeed');
                                if (!slot.killFeed && slot.killFeedStatus !== 'loading') {
                                  fetchKillFeed(slot.matchId);
                                }
                              }}
                            >Kill Feed</button>
                          </div>
                          {expandedTab === 'scoreboard' && (
                        <div className="mh-scoreboard">
                          {[{ team: team1, label: team1Win ? 'Victory' : 'Defeat', isPlayerTeam: playerTeamId === 100, win: team1Win },
                            { team: team2, label: team2Win ? 'Victory' : 'Defeat', isPlayerTeam: playerTeamId === 200, win: team2Win }].map(({ team, label, isPlayerTeam, win }) => (
                            <div key={label + (isPlayerTeam ? '-you' : '')} className={`mh-sb-team ${win ? 'mh-sb-team--win' : 'mh-sb-team--loss'}`}>
                              <div className="mh-sb-team-header">
                                <span className={`mh-sb-team-result ${win ? 'mh-result--win' : 'mh-result--loss'}`}>{label}</span>
                                {isPlayerTeam && <span className="mh-sb-team-you">Your Team</span>}
                              </div>
                              <div className="mh-sb-header-row">
                                <span className="mh-sb-col-champ">Champion</span>
                                <span className="mh-sb-col-rank">Rank</span>
                                <span className="mh-sb-col-spells">Spells</span>
                                <span className="mh-sb-col-kda">KDA</span>
                                <span className="mh-sb-col-cs">CS</span>
                                <span className="mh-sb-col-dmg">Damage</span>
                                <span className="mh-sb-col-gold">Gold</span>
                                <span className="mh-sb-col-items">Items</span>
                              </div>
                              {team.map((p) => {
                                const pKdaNum = p.deaths > 0 ? (p.kills + p.assists) / p.deaths : p.kills + p.assists;
                                const pKdaLabel = p.deaths > 0 ? pKdaNum.toFixed(1) : 'Perfect';
                                const pCs = p.totalMinionsKilled + p.neutralMinionsKilled;
                                const pItems = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6];
                                const isYou = p.puuid === result.puuid;
                                const displayName = p.riotIdGameName || p.summonerName || 'Unknown';
                                const dmgPct = (p.totalDamageDealtToChampions / maxDmg) * 100;
                                const dmgBarColor = win ? '#83e1a3' : '#ef9b9b';
                                const rankLabel = formatRankShort(p.rankedTier, p.rankedRank);
                                const rankTierColor = p.rankedTier ? (TIER_COLORS[p.rankedTier.toUpperCase()] ?? '#888') : '#555';
                                const isMvp = mvpPlayer?.puuid === p.puuid;
                                return (
                                  <div key={p.puuid} className={`mh-sb-row ${isYou ? 'mh-sb-row--you' : ''}`}>
                                    <div className="mh-sb-col-champ">
                                      <TextTooltip className={`mh-sb-champ-wrap${isMvp ? ' mh-sb-champ-wrap--mvp' : ''}`} variant="spell" content={(() => {
                                        const ci = champInfo[p.championName];
                                        return (
                                          <>
                                            <div className="item-tooltip-header">
                                              <img className="item-tooltip-icon" src={formatChampionFaceIcon(p.championName, ddragonVersion)} alt="" />
                                              <div className="item-tooltip-title">
                                                <span className="item-tooltip-name">{ci?.name ?? p.championName}</span>
                                                {ci?.title && <span className="mh-champ-tooltip-title">{ci.title}</span>}
                                              </div>
                                              {ci?.tags && ci.tags.length > 0 && <span className="item-tooltip-gold">{ci.tags.join(' / ')}</span>}
                                            </div>
                                            {ci?.blurb && <div className="item-tooltip-body">{ci.blurb}</div>}
                                          </>
                                        );
                                      })()}>
                                        <img className="mh-sb-champ-icon" src={formatChampionFaceIcon(p.championName, ddragonVersion)} alt={p.championName} loading="lazy" onError={handleImgError} />
                                      </TextTooltip>
                                      <div className="mh-sb-player-info">
                                        <button
                                          className="mh-sb-player-link"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const tag = p.riotIdTagline ?? '';
                                            const name = p.riotIdGameName ?? p.summonerName ?? '';
                                            if (name || p.puuid) {
                                              setGameName(name);
                                              setTagLine(tag);
                                              searchPuuidRef.current = p.puuid;
                                              setExpandedMatchId(null);
                                              setPendingSearch((n) => n + 1);
                                            }
                                          }}
                                        >
                                          {displayName}
                                        </button>
                                        <span className="mh-sb-champ-name">{p.championName}</span>
                                      </div>
                                      {isMvp && (
                                        <TextTooltip content={getMhMvpBreakdown(p)} variant="mvp" className="mh-sb-mvp-wrap">
                                          <span className="mh-mvp-badge">MVP</span>
                                        </TextTooltip>
                                      )}
                                    </div>
                                    <div className="mh-sb-col-rank">
                                      {p.rankedTier ? (
                                        <>
                                          <img className="mh-sb-rank-icon" src={formatRankMiniIcon(p.rankedTier)} alt={p.rankedTier} loading="lazy" />
                                          <span className="mh-sb-rank-label" style={{ color: rankTierColor }}>{rankLabel}</span>
                                        </>
                                      ) : (
                                        <span className="mh-sb-rank-label" style={{ color: '#555' }}>-</span>
                                      )}
                                    </div>
                                    <div className="mh-sb-col-spells">
                                      {[p.summoner1Id, p.summoner2Id].filter((id) => id > 0).map((spellId) => {
                                        const si = spellInfo[spellId];
                                        return (
                                          <TextTooltip key={spellId} className="mh-sb-spell-wrap" variant="spell" content={
                                            <>
                                              <div className="item-tooltip-header">
                                                <img className="item-tooltip-icon" src={formatSummonerSpell(spellId)} alt="" />
                                                <div className="item-tooltip-title">
                                                  <span className="item-tooltip-name">{si?.name ?? getSpellName(spellId)}</span>
                                                </div>
                                                {si && si.cooldown > 0 && (
                                                  <span className="item-tooltip-gold">{si.cooldown}s CD</span>
                                                )}
                                              </div>
                                              {si?.description && <div className="item-tooltip-body">{si.description}</div>}
                                            </>
                                          }>
                                            <img className="mh-sb-spell" src={formatSummonerSpell(spellId)} alt={si?.name ?? ''} loading="lazy" />
                                          </TextTooltip>
                                        );
                                      })}
                                    </div>
                                    <div className="mh-sb-col-kda">
                                      <span className="mh-sb-kda-score">{p.kills} / {p.deaths} / {p.assists}</span>
                                      <span className="mh-sb-kda-ratio" style={{ color: kdaColor(pKdaNum) }}>{pKdaLabel} KDA</span>
                                    </div>
                                    <div className="mh-sb-col-cs">{pCs}</div>
                                    <div className="mh-sb-col-dmg">
                                      <span>{(p.totalDamageDealtToChampions / 1000).toFixed(1)}K</span>
                                      <div className="mh-sb-dmg-bar">
                                        <div className="mh-sb-dmg-bar-fill" style={{ width: `${dmgPct}%`, backgroundColor: dmgBarColor }} />
                                      </div>
                                    </div>
                                    <div className="mh-sb-col-gold">{formatGold(p.goldEarned)}</div>
                                    <div className="mh-sb-col-items">
                                      {pItems.map((it, i) => {
                                        if (it <= 0) return <span key={i} className="mh-sb-item mh-sb-item--empty" />;
                                        const itInfo = itemData[it];
                                        return (
                                          <ItemTooltip
                                            key={i}
                                            itemId={it}
                                            itemDisplayName={itInfo?.name ?? ''}
                                            itemPrice={itInfo?.goldTotal ?? 0}
                                            itemCount={1}
                                            info={itInfo}
                                            version={ddragonVersion}
                                            getItemIconUrl={getItemIconUrl}
                                            className="mh-sb-item"
                                          >
                                            <img src={getItemIconUrl(ddragonVersion, it)} alt={itInfo?.name ?? ''} loading="lazy" />
                                          </ItemTooltip>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                          )}
                          {expandedTab === 'killfeed' && (
                            <div className="mh-killfeed">
                              {slot.killFeedStatus === 'loading' && (
                                <div className="mh-killfeed-loading">Loading kill feed...</div>
                              )}
                              {slot.killFeedStatus === 'failed' && (
                                <div className="mh-killfeed-loading">Kill feed unavailable</div>
                              )}
                              {slot.killFeed && slot.killFeed.length > 0 && (
                                <>
                                  <div className="mh-killfeed-header">
                                    <span className="mh-killfeed-title">Kill Feed</span>
                                    <span className="mh-killfeed-count">{slot.killFeed.length} kills</span>
                                  </div>
                                  <div className="mh-killfeed-list">
                                    {slot.killFeed.map((kill, ki) => {
                                      const killerSide = kill.killerTeamId === 100 ? 'blue' : kill.killerTeamId === 200 ? 'red' : 'neutral';
                                      const victimSide = kill.victimTeamId === 100 ? 'blue' : kill.victimTeamId === 200 ? 'red' : 'neutral';
                                      const isYourKill = kill.killerName === (result.gameName ?? '');
                                      const mins = Math.floor(kill.timestamp / 60000);
                                      const secs = Math.floor((kill.timestamp % 60000) / 1000);
                                      const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
                                      return (
                                        <div key={ki} className={`mh-kf-entry${isYourKill ? ' mh-kf-entry--your-kill' : ''}${kill.multiKill === 'penta' ? ' mh-kf-entry--penta' : ''}`}>
                                          <span className="mh-kf-time">{timeStr}</span>
                                          {kill.execute ? (
                                            <span className="mh-kf-entity-icon mh-kf-icon--neutral">⚔</span>
                                          ) : (
                                            <img className={`mh-kf-portrait mh-kf-icon--${killerSide}`} src={formatChampionFaceIcon(kill.killerChamp, ddragonVersion)} alt={kill.killerChamp} onError={handleImgError} />
                                          )}
                                          <span className={`mh-kf-name mh-kf-name--${killerSide}`}>{kill.execute ? 'Executed' : kill.killerChamp}</span>
                                          <span className="mh-kf-assist-icons">
                                            {kill.assistChamps.length > 0 ? (
                                              <>
                                                <span className="mh-kf-assist-plus">+</span>
                                                {kill.assistChamps.map((ac) => (
                                                  <img key={ac} className={`mh-kf-assist-mini mh-kf-icon--${killerSide}`} src={formatChampionFaceIcon(ac, ddragonVersion)} alt={ac} title={ac} onError={handleImgError} />
                                                ))}
                                              </>
                                            ) : null}
                                          </span>
                                          <svg className="mh-kf-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M5 12h14M13 5l6 7-6 7" />
                                          </svg>
                                          <img className={`mh-kf-portrait mh-kf-icon--${victimSide}`} src={formatChampionFaceIcon(kill.victimChamp, ddragonVersion)} alt={kill.victimChamp} onError={handleImgError} />
                                          <span className={`mh-kf-name mh-kf-name--${victimSide}`}>{kill.victimChamp}</span>
                                          <span className="mh-kf-badges">
                                            {kill.firstBlood && (
                                              <TextTooltip text={MH_SPECIAL_KILL_TOOLTIPS.first_blood} variant="first_blood" className="mh-kf-badge mh-kf-badge--first_blood">
                                                First Blood
                                              </TextTooltip>
                                            )}
                                            {kill.shutdown && (
                                              <TextTooltip text={MH_SPECIAL_KILL_TOOLTIPS.shutdown} variant="shutdown" className="mh-kf-badge mh-kf-badge--shutdown">
                                                Shutdown
                                              </TextTooltip>
                                            )}
                                            {kill.execute && (
                                              <TextTooltip text={MH_SPECIAL_KILL_TOOLTIPS.execute} variant="execute" className="mh-kf-badge mh-kf-badge--execute">
                                                Executed
                                              </TextTooltip>
                                            )}
                                            {kill.multiKill && (
                                              <TextTooltip text={MH_MULTI_KILL_TOOLTIPS[kill.multiKill]} variant={kill.multiKill} className={`mh-kf-badge mh-kf-badge--multikill mh-kf-badge--${kill.multiKill}`}>
                                                {kill.multiKill === 'double' && 'Double Kill'}
                                                {kill.multiKill === 'triple' && 'Triple Kill'}
                                                {kill.multiKill === 'quadra' && 'Quadra Kill'}
                                                {kill.multiKill === 'penta' && 'Penta Kill'}
                                              </TextTooltip>
                                            )}
                                            {kill.killStreak && (
                                              <TextTooltip text={MH_KILL_STREAK_TOOLTIPS[kill.killStreak]} variant={kill.killStreak} className={`mh-kf-badge mh-kf-badge--streak mh-kf-badge--${kill.killStreak}`}>
                                                {kill.killStreak === 'killing_spree' && 'Killing Spree'}
                                                {kill.killStreak === 'rampage' && 'Rampage'}
                                                {kill.killStreak === 'unstoppable' && 'Unstoppable'}
                                                {kill.killStreak === 'godlike' && 'Godlike'}
                                                {kill.killStreak === 'legendary' && 'Legendary'}
                                              </TextTooltip>
                                            )}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                              {slot.killFeed && slot.killFeed.length === 0 && (
                                <div className="mh-killfeed-loading">No kills recorded</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {hasMore && !loading && (
              <div ref={sentinelRef} className="mh-scroll-sentinel">
                {loadingMore && (
                  <div className="mh-list">
                    {[0, 1, 2].map((i) => (
                      <div key={`more-skel-${i}`} className="mh-card mh-skeleton-match">
                        <div className="mh-card-main">
                          <div className="mh-skeleton mh-skeleton-match-champ" />
                          <div className="mh-card-body">
                            <div className="mh-skeleton mh-skeleton-match-topline" />
                            <div className="mh-skeleton mh-skeleton-match-midline" />
                          </div>
                          <div className="mh-skeleton mh-skeleton-match-items" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mh-bottom-border" />
    </div>
  );
}

