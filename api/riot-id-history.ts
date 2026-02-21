import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type RoutingRegion = 'americas' | 'europe' | 'asia' | 'sea';
type AccountRoutingRegion = Exclude<RoutingRegion, 'sea'>;
type PlatformRegion =
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

interface RiotAccountResponse {
  puuid: string;
  gameName: string;
  tagLine: string;
}

interface RiotParticipant {
  puuid: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
}

interface RiotMatchResponse {
  metadata: {
    matchId: string;
  };
  info: {
    gameMode?: string;
    gameDuration?: number;
    gameEndTimestamp?: number;
    participants: RiotParticipant[];
  };
}

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
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  items?: number[];
  lpChange?: number | null;
  win: boolean;
}

interface RiotSummonerResponse {
  id: string;
  accountId: string;
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
}

interface RiotLeagueEntry {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak?: boolean;
  veteran?: boolean;
}

interface RiotChampionMastery {
  puuid: string;
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime: number;
  championPointsSinceLastLevel: number;
  championPointsUntilNextLevel: number;
}

interface ChampionMasteryEntry {
  championId: number;
  championName: string;
  championLevel: number;
  championPoints: number;
}

let cachedChampionMap: Record<number, string> | null = null;
let cachedChampionMapExpiry = 0;

async function getChampionIdToNameMap(): Promise<Record<number, string>> {
  if (cachedChampionMap && Date.now() < cachedChampionMapExpiry) return cachedChampionMap;
  try {
    const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await versionsRes.json() as string[];
    const version = versions[0] || '15.4.1';
    const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
    const champData = await champRes.json() as { data: Record<string, { key: string; id: string }> };
    const map: Record<number, string> = {};
    for (const champ of Object.values(champData.data)) {
      map[Number(champ.key)] = champ.id;
    }
    cachedChampionMap = map;
    cachedChampionMapExpiry = Date.now() + 3600_000;
    return map;
  } catch {
    return cachedChampionMap ?? {};
  }
}

interface MatchParticipantDetail {
  puuid: string;
  summonerName: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  teamId: number;
  teamPosition?: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  champLevel: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
  visionScore: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  win: boolean;
  rankedTier?: string;
  rankedRank?: string;
}

interface MatchTeamObjective {
  first: boolean;
  kills: number;
}

interface MatchTeamDetail {
  teamId: number;
  win: boolean;
  objectives: {
    baron?: MatchTeamObjective;
    dragon?: MatchTeamObjective;
    tower?: MatchTeamObjective;
    inhibitor?: MatchTeamObjective;
    riftHerald?: MatchTeamObjective;
  };
}

const VALID_ROUTING_REGIONS = new Set<RoutingRegion>(['americas', 'europe', 'asia', 'sea']);
const PLATFORM_TO_ROUTING: Record<PlatformRegion, RoutingRegion> = {
  br1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  oc1: 'sea',
  tr1: 'europe',
  ru: 'europe',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  tw2: 'sea',
  vn2: 'sea',
};

function readEnvFileKey(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!trimmed.startsWith(`${key}=`)) continue;
    const value = trimmed.slice(key.length + 1).trim();
    if (!value) return undefined;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1).trim() || undefined;
    }
    return value;
  }
  return undefined;
}

function resolveRiotApiKey(): string | undefined {
  const direct = process.env.RIOT_API_KEY?.trim();
  if (direct) return direct;

  // Local dev fallback when env injection is missing.
  const cwd = process.cwd();
  const candidates = [
    join(cwd, '.vercel', '.env.development.local'),
    join(cwd, '.env.local'),
    join(cwd, '.env'),
  ];
  for (const filePath of candidates) {
    const key = readEnvFileKey(filePath, 'RIOT_API_KEY');
    if (key) return key;
  }
  return undefined;
}

function sanitizeRegion(value: string): { selectedRegion: string; routingRegion: RoutingRegion; platformRegion?: PlatformRegion } {
  const lowered = value.toLowerCase();
  if (lowered in PLATFORM_TO_ROUTING) {
    const platform = lowered as PlatformRegion;
    return { selectedRegion: platform, routingRegion: PLATFORM_TO_ROUTING[platform], platformRegion: platform };
  }
  if (VALID_ROUTING_REGIONS.has(lowered as RoutingRegion)) {
    const routing = lowered as RoutingRegion;
    return { selectedRegion: routing, routingRegion: routing };
  }
  return { selectedRegion: 'oc1', routingRegion: 'sea', platformRegion: 'oc1' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = resolveRiotApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'RIOT_API_KEY not configured. Add it in Vercel Environment Variables or .env.local for local dev.',
    });
  }

  let gameName = typeof req.query.gameName === 'string' ? req.query.gameName.trim() : '';
  let tagLine = typeof req.query.tagLine === 'string' ? req.query.tagLine.trim() : '';
  const puuid = typeof req.query.puuid === 'string' ? req.query.puuid.trim() : '';
  const matchId = typeof req.query.matchId === 'string' ? req.query.matchId.trim() : '';
  const { selectedRegion, routingRegion, platformRegion } = sanitizeRegion(
    typeof req.query.region === 'string' ? req.query.region.trim() : 'oc1',
  );
  // Riot account-v1 does not accept "sea" in all environments; use "asia" fallback for SEA platforms.
  const accountRoutingRegion: AccountRoutingRegion = routingRegion === 'sea' ? 'asia' : routingRegion;
  const count = Math.min(20, Math.max(1, parseInt(String(req.query.count ?? '10'), 10) || 10));
  const start = Math.max(0, parseInt(String(req.query.start ?? '0'), 10) || 0);
  const queue = typeof req.query.queue === 'string' && req.query.queue.trim() ? parseInt(req.query.queue.trim(), 10) : undefined;
  const summaryOnly = String(req.query.summaryOnly ?? '').trim() === '1';
  const wantTimeline = String(req.query.timeline ?? '').trim() === '1';
  const brief = String(req.query.brief ?? '').trim() === '1';

  // Timeline mode: fetch kill events from match-v5 timeline.
  if (matchId && wantTimeline) {
    try {
      const timelineUrl = `https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`;
      const timelineRes = await fetch(timelineUrl, { headers: { 'X-Riot-Token': apiKey } });
      if (!timelineRes.ok) {
        const text = await timelineRes.text();
        return res.status(timelineRes.status).json({
          error: `Riot timeline lookup failed: ${timelineRes.status}`,
          details: text.slice(0, 500),
          matchId,
        });
      }
      const timeline = await timelineRes.json() as {
        metadata: { participants: string[] };
        info: {
          participants: Array<{ participantId: number; puuid: string }>;
          frames: Array<{
            events: Array<{
              type: string;
              timestamp: number;
              killerId?: number;
              victimId?: number;
              assistingParticipantIds?: number[];
              bounty?: number;
              shutdownBounty?: number;
              multiKillLength?: number;
              killStreakLength?: number;
            }>;
          }>;
        };
      };

      const puuidByParticipantId: Record<number, string> = {};
      for (const p of (timeline.info.participants ?? [])) {
        puuidByParticipantId[p.participantId] = p.puuid;
      }

      const killEvents = timeline.info.frames
        .flatMap((f) => f.events)
        .filter((e) => e.type === 'CHAMPION_KILL')
        .map((e) => ({
          timestamp: e.timestamp,
          killerId: e.killerId ?? 0,
          victimId: e.victimId ?? 0,
          assistingParticipantIds: e.assistingParticipantIds ?? [],
          bounty: e.bounty ?? 0,
          shutdownBounty: e.shutdownBounty ?? 0,
          multiKillLength: e.multiKillLength ?? 0,
          killStreakLength: e.killStreakLength ?? 0,
        }));

      return res.status(200).json({
        matchId,
        puuidByParticipantId,
        killEvents,
      });
    } catch (err) {
      console.error('[riot-id-history:timeline]', err);
      return res.status(500).json({ error: 'Failed to fetch timeline', matchId });
    }
  }

  // Detail-only mode: fetch one match summary by matchId + puuid.
  if (puuid && matchId) {
    try {
      const detailRes = await fetch(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
        headers: { 'X-Riot-Token': apiKey },
      });
      if (!detailRes.ok) {
        const text = await detailRes.text();
        return res.status(detailRes.status).json({
          error: `Riot match detail lookup failed: ${detailRes.status}`,
          details: text.slice(0, 500),
          matchId,
        });
      }

      const detail = await detailRes.json() as RiotMatchResponse;
      const participant = detail.info.participants.find((p) => p.puuid === puuid);
      if (!participant) {
        return res.status(404).json({ error: 'Participant not found in match', matchId });
      }

      const match: MatchSummary = {
        matchId: detail.metadata.matchId,
        gameMode: detail.info.gameMode ?? 'UNKNOWN',
        queueId: typeof (detail.info as Record<string, unknown>).queueId === 'number'
          ? ((detail.info as Record<string, unknown>).queueId as number)
          : 0,
        gameDuration: Math.floor(detail.info.gameDuration ?? 0),
        gameEndTimestamp: detail.info.gameEndTimestamp ?? 0,
        championName: participant.championName,
        kills: participant.kills ?? 0,
        deaths: participant.deaths ?? 0,
        assists: participant.assists ?? 0,
        totalDamageDealtToChampions: typeof (participant as Record<string, unknown>).totalDamageDealtToChampions === 'number'
          ? ((participant as Record<string, unknown>).totalDamageDealtToChampions as number)
          : 0,
        totalMinionsKilled: typeof (participant as Record<string, unknown>).totalMinionsKilled === 'number'
          ? ((participant as Record<string, unknown>).totalMinionsKilled as number)
          : 0,
        neutralMinionsKilled: typeof (participant as Record<string, unknown>).neutralMinionsKilled === 'number'
          ? ((participant as Record<string, unknown>).neutralMinionsKilled as number)
          : 0,
        items: [
          'item0',
          'item1',
          'item2',
          'item3',
          'item4',
          'item5',
          'item6',
        ].map((key) => {
          const val = (participant as Record<string, unknown>)[key];
          return typeof val === 'number' ? val : 0;
        }),
        lpChange: null,
        win: !!participant.win,
      };

      if (brief) {
        return res.status(200).json({ region: selectedRegion, routingRegion, matchId, match });
      }

      const participants = detail.info.participants.map((p) => {
        const source = p as RiotParticipant & Record<string, unknown>;
        return {
          puuid: p.puuid,
          summonerName: typeof source.summonerName === 'string' ? source.summonerName : '',
          riotIdGameName: typeof source.riotIdGameName === 'string' ? source.riotIdGameName : undefined,
          riotIdTagline: typeof source.riotIdTagline === 'string' ? source.riotIdTagline : undefined,
          teamId: typeof source.teamId === 'number' ? source.teamId : 0,
          teamPosition: typeof source.teamPosition === 'string'
            ? source.teamPosition
            : (typeof source.individualPosition === 'string' ? source.individualPosition : undefined),
          championName: p.championName,
          kills: p.kills ?? 0,
          deaths: p.deaths ?? 0,
          assists: p.assists ?? 0,
          champLevel: typeof source.champLevel === 'number' ? source.champLevel : 0,
          totalMinionsKilled: typeof source.totalMinionsKilled === 'number' ? source.totalMinionsKilled : 0,
          neutralMinionsKilled: typeof source.neutralMinionsKilled === 'number' ? source.neutralMinionsKilled : 0,
          goldEarned: typeof source.goldEarned === 'number' ? source.goldEarned : 0,
          visionScore: typeof source.visionScore === 'number' ? source.visionScore : 0,
          totalDamageDealtToChampions: typeof source.totalDamageDealtToChampions === 'number' ? source.totalDamageDealtToChampions : 0,
          totalDamageTaken: typeof source.totalDamageTaken === 'number' ? source.totalDamageTaken : 0,
          item0: typeof source.item0 === 'number' ? source.item0 : 0,
          item1: typeof source.item1 === 'number' ? source.item1 : 0,
          item2: typeof source.item2 === 'number' ? source.item2 : 0,
          item3: typeof source.item3 === 'number' ? source.item3 : 0,
          item4: typeof source.item4 === 'number' ? source.item4 : 0,
          item5: typeof source.item5 === 'number' ? source.item5 : 0,
          item6: typeof source.item6 === 'number' ? source.item6 : 0,
          summoner1Id: typeof source.summoner1Id === 'number' ? source.summoner1Id : 0,
          summoner2Id: typeof source.summoner2Id === 'number' ? source.summoner2Id : 0,
          win: !!p.win,
        } as MatchParticipantDetail;
      });

      let rankedRateLimited = false;
      for (const p of participants) {
        if (rankedRateLimited) break;
        try {
          const url = `https://${platformRegion}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(p.puuid)}`;
          const r = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
          if (r.status === 429) {
            console.warn(`[riot-id-history] Ranked lookup rate-limited, skipping remaining participants`);
            rankedRateLimited = true;
            break;
          }
          if (!r.ok) continue;
          const entries = await r.json() as RiotLeagueEntry[];
          const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? entries[0];
          if (solo) {
            p.rankedTier = solo.tier;
            p.rankedRank = solo.rank;
          }
        } catch { /* skip */ }
      }

      const info = detail.info as Record<string, unknown>;
      const rawTeams = Array.isArray(info.teams) ? (info.teams as Array<Record<string, unknown>>) : [];
      const teams: MatchTeamDetail[] = rawTeams.map((team) => {
        const obj = (team.objectives && typeof team.objectives === 'object')
          ? (team.objectives as Record<string, { first?: boolean; kills?: number }>)
          : {};
        return {
          teamId: typeof team.teamId === 'number' ? team.teamId : 0,
          win: !!team.win,
          objectives: {
            baron: obj.baron ? { first: !!obj.baron.first, kills: Number(obj.baron.kills ?? 0) } : undefined,
            dragon: obj.dragon ? { first: !!obj.dragon.first, kills: Number(obj.dragon.kills ?? 0) } : undefined,
            tower: obj.tower ? { first: !!obj.tower.first, kills: Number(obj.tower.kills ?? 0) } : undefined,
            inhibitor: obj.inhibitor ? { first: !!obj.inhibitor.first, kills: Number(obj.inhibitor.kills ?? 0) } : undefined,
            riftHerald: obj.riftHerald ? { first: !!obj.riftHerald.first, kills: Number(obj.riftHerald.kills ?? 0) } : undefined,
          },
        };
      });

      return res.status(200).json({
        region: selectedRegion,
        routingRegion,
        matchId,
        match,
        detail: {
          queueId: typeof info.queueId === 'number' ? info.queueId : 0,
          mapId: typeof info.mapId === 'number' ? info.mapId : 0,
          gameCreation: typeof info.gameCreation === 'number' ? info.gameCreation : 0,
          gameDuration: typeof info.gameDuration === 'number' ? Math.floor(info.gameDuration) : 0,
          gameEndTimestamp: typeof info.gameEndTimestamp === 'number' ? info.gameEndTimestamp : 0,
          playerTeamId: participants.find((p) => p.puuid === puuid)?.teamId ?? 0,
          participants,
          teams,
        },
      });
    } catch (err) {
      console.error('[riot-id-history:detail]', err);
      return res.status(500).json({ error: 'Failed to fetch Riot match detail', matchId });
    }
  }

  // If PUUID is provided without matchId, resolve the account by PUUID.
  // This handles cross-region lookups when clicking player names in the scoreboard.
  if (puuid && !matchId) {
    const ACCOUNT_ROUTING_REGIONS: AccountRoutingRegion[] = ['americas', 'europe', 'asia'];
    // Try the current region's routing first, then fall back to others
    const ordered = [accountRoutingRegion, ...ACCOUNT_ROUTING_REGIONS.filter((r) => r !== accountRoutingRegion)];
    let resolved = false;
    for (const tryRegion of ordered) {
      try {
        const url = `https://${tryRegion}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`;
        const resp = await fetch(url, { headers: { 'X-Riot-Token': apiKey } });
        if (resp.ok) {
          const acc = await resp.json() as RiotAccountResponse;
          gameName = acc.gameName;
          tagLine = acc.tagLine;
          resolved = true;
          console.log(`[riot-id-history] Resolved PUUID via ${tryRegion}: ${gameName}#${tagLine}`);
          break;
        }
      } catch { /* try next region */ }
    }
    if (!resolved) {
      return res.status(404).json({ error: 'Could not resolve account from PUUID across any region' });
    }
  }

  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Missing gameName or tagLine query parameter' });
  }

  try {
    const accountUrl = `https://${accountRoutingRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await fetch(accountUrl, {
      headers: { 'X-Riot-Token': apiKey },
    });
    if (!accountRes.ok) {
      const text = await accountRes.text();
      return res.status(accountRes.status).json({
        error: `Riot account lookup failed: ${accountRes.status}`,
        details: text.slice(0, 500),
      });
    }

    const account = await accountRes.json() as RiotAccountResponse;

    let profile: {
      summonerLevel: number;
      profileIconId: number;
      ranked: RiotLeagueEntry[];
      topMastery: ChampionMasteryEntry[];
    } | null = null;
    if (platformRegion) {
      try {
        const summonerUrl = `https://${platformRegion}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`;
        const summonerRes = await fetch(summonerUrl, {
          headers: { 'X-Riot-Token': apiKey },
        });
        let summonerLevel = 0;
        let profileIconId = 0;
        let summonerId: string | undefined;

        if (summonerRes.ok) {
          const summoner = await summonerRes.json() as Record<string, unknown>;
          summonerLevel = typeof summoner.summonerLevel === 'number' ? summoner.summonerLevel : 0;
          profileIconId = typeof summoner.profileIconId === 'number' ? summoner.profileIconId : 0;
          summonerId = typeof summoner.id === 'string' ? summoner.id : undefined;
        }

        let ranked: RiotLeagueEntry[] = [];

        // Try PUUID-based endpoint first (Riot is migrating away from summoner IDs)
        const puuidRankedUrl = `https://${platformRegion}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`;
        const puuidRankedRes = await fetch(puuidRankedUrl, {
          headers: { 'X-Riot-Token': apiKey },
        });
        if (puuidRankedRes.ok) {
          ranked = await puuidRankedRes.json() as RiotLeagueEntry[];
          console.log('[riot-id-history] Ranked (by-puuid):', ranked.length, ranked.map(r => `${r.queueType}: ${r.tier} ${r.rank} ${r.leaguePoints}LP`));
        } else if (summonerId) {
          // Fall back to summoner-ID-based endpoint
          const summonerRankedUrl = `https://${platformRegion}.api.riotgames.com/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`;
          const summonerRankedRes = await fetch(summonerRankedUrl, {
            headers: { 'X-Riot-Token': apiKey },
          });
          if (summonerRankedRes.ok) {
            ranked = await summonerRankedRes.json() as RiotLeagueEntry[];
            console.log('[riot-id-history] Ranked (by-summoner):', ranked.length, ranked.map(r => `${r.queueType}: ${r.tier} ${r.rank} ${r.leaguePoints}LP`));
          } else {
            console.warn('[riot-id-history] Ranked by-summoner failed:', summonerRankedRes.status);
          }
        } else {
          console.warn('[riot-id-history] No summoner ID available and by-puuid returned:', puuidRankedRes.status);
        }

        let topMastery: ChampionMasteryEntry[] = [];
        try {
          const masteryUrl = `https://${platformRegion}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(account.puuid)}/top?count=3`;
          const masteryRes = await fetch(masteryUrl, {
            headers: { 'X-Riot-Token': apiKey },
          });
          if (masteryRes.ok) {
            const raw = await masteryRes.json() as RiotChampionMastery[];
            const champMap = await getChampionIdToNameMap();
            topMastery = raw.map((m) => ({
              championId: m.championId,
              championName: champMap[m.championId] ?? `Champion${m.championId}`,
              championLevel: m.championLevel ?? 0,
              championPoints: m.championPoints ?? 0,
            }));
          }
        } catch {
          // Mastery fetch is optional
        }

        profile = { summonerLevel, profileIconId, ranked, topMastery };
      } catch (err) {
        console.error('[riot-id-history] Profile enrichment error:', err);
      }
    }

    const idsUrl = new URL(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids`);
    idsUrl.searchParams.set('start', String(start));
    idsUrl.searchParams.set('count', String(count));
    if (queue && Number.isFinite(queue)) {
      idsUrl.searchParams.set('queue', String(queue));
    }

    // Fetch match IDs and spectator data in parallel
    const spectatorUrl = platformRegion
      ? `https://${platformRegion}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(account.puuid)}`
      : null;

    const [idsRes, spectatorResult] = await Promise.all([
      fetch(idsUrl.toString(), { headers: { 'X-Riot-Token': apiKey } }),
      spectatorUrl
        ? fetch(spectatorUrl, { headers: { 'X-Riot-Token': apiKey } })
            .then(async (r) => {
              if (!r.ok) return null;
              return await r.json() as Record<string, unknown>;
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!idsRes.ok) {
      const text = await idsRes.text();
      return res.status(idsRes.status).json({
        error: `Riot match ids lookup failed: ${idsRes.status}`,
        details: text.slice(0, 500),
      });
    }

    // Normalize spectator data if player is in-game
    let activeGame: Record<string, unknown> | null = null;
    if (spectatorResult && typeof spectatorResult === 'object') {
      const raw = spectatorResult;
      const rawParticipants = Array.isArray(raw.participants) ? raw.participants : [];
      const participants = rawParticipants
        .filter((p: unknown) => p && typeof p === 'object')
        .map((p: unknown) => {
          const src = p as Record<string, unknown>;
          let perks: { perkIds: number[]; perkStyle: number; perkSubStyle: number } | undefined;
          if (src.perks && typeof src.perks === 'object') {
            const rawPerks = src.perks as Record<string, unknown>;
            perks = {
              perkIds: Array.isArray(rawPerks.perkIds)
                ? (rawPerks.perkIds as unknown[]).filter((id): id is number => typeof id === 'number')
                : [],
              perkStyle: typeof rawPerks.perkStyle === 'number' ? rawPerks.perkStyle : 0,
              perkSubStyle: typeof rawPerks.perkSubStyle === 'number' ? rawPerks.perkSubStyle : 0,
            };
          }
          return {
            puuid: typeof src.puuid === 'string' ? src.puuid : '',
            summonerId: typeof src.summonerId === 'string' ? src.summonerId : '',
            summonerName: typeof src.summonerName === 'string' ? src.summonerName : '',
            riotId: typeof src.riotId === 'string' ? src.riotId : undefined,
            championId: typeof src.championId === 'number' ? src.championId : 0,
            teamId: typeof src.teamId === 'number' ? src.teamId : 0,
            spell1Id: typeof src.spell1Id === 'number' ? src.spell1Id : 0,
            spell2Id: typeof src.spell2Id === 'number' ? src.spell2Id : 0,
            perks,
          };
        });

      const rawBans = Array.isArray(raw.bannedChampions) ? raw.bannedChampions : [];
      const bannedChampions = rawBans
        .filter((b: unknown) => b && typeof b === 'object')
        .map((b: unknown) => {
          const src = b as Record<string, unknown>;
          return {
            championId: typeof src.championId === 'number' ? src.championId : 0,
            teamId: typeof src.teamId === 'number' ? src.teamId : 0,
            pickTurn: typeof src.pickTurn === 'number' ? src.pickTurn : 0,
          };
        });

      activeGame = {
        inGame: true,
        gameId: typeof raw.gameId === 'number' ? raw.gameId : 0,
        gameMode: typeof raw.gameMode === 'string' ? raw.gameMode : '',
        gameType: typeof raw.gameType === 'string' ? raw.gameType : '',
        gameQueueConfigId: typeof raw.gameQueueConfigId === 'number' ? raw.gameQueueConfigId : 0,
        mapId: typeof raw.mapId === 'number' ? raw.mapId : 0,
        gameStartTime: typeof raw.gameStartTime === 'number' ? raw.gameStartTime : 0,
        gameLength: typeof raw.gameLength === 'number' ? raw.gameLength : 0,
        platformId: typeof raw.platformId === 'string' ? raw.platformId : '',
        participants,
        bannedChampions,
      };
    }

    const matchIds = await idsRes.json() as string[];
    if (summaryOnly) {
      return res.status(200).json({
        region: selectedRegion,
        routingRegion,
        accountRoutingRegion,
        platformRegion,
        puuid: account.puuid,
        gameName: account.gameName,
        tagLine: account.tagLine,
        profile,
        activeGame,
        matchIds,
        matches: [],
      });
    }

    const matches: MatchSummary[] = [];

    for (const matchId of matchIds) {
      const detailRes = await fetch(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
        headers: { 'X-Riot-Token': apiKey },
      });
      if (!detailRes.ok) continue;
      const detail = await detailRes.json() as RiotMatchResponse;
      const participant = detail.info.participants.find((p) => p.puuid === account.puuid);
      if (!participant) continue;
      const source = participant as RiotParticipant & Record<string, unknown>;
      matches.push({
        matchId: detail.metadata.matchId,
        gameMode: detail.info.gameMode ?? 'UNKNOWN',
        queueId: typeof (detail.info as Record<string, unknown>).queueId === 'number'
          ? ((detail.info as Record<string, unknown>).queueId as number)
          : 0,
        gameDuration: Math.floor(detail.info.gameDuration ?? 0),
        gameEndTimestamp: detail.info.gameEndTimestamp ?? 0,
        championName: participant.championName,
        kills: participant.kills ?? 0,
        deaths: participant.deaths ?? 0,
        assists: participant.assists ?? 0,
        totalDamageDealtToChampions: typeof source.totalDamageDealtToChampions === 'number' ? source.totalDamageDealtToChampions : 0,
        totalMinionsKilled: typeof source.totalMinionsKilled === 'number' ? source.totalMinionsKilled : 0,
        neutralMinionsKilled: typeof source.neutralMinionsKilled === 'number' ? source.neutralMinionsKilled : 0,
        items: [
          source.item0,
          source.item1,
          source.item2,
          source.item3,
          source.item4,
          source.item5,
          source.item6,
        ].map((item) => (typeof item === 'number' ? item : 0)),
        lpChange: null,
        win: !!participant.win,
      });
    }

    return res.status(200).json({
      region: selectedRegion,
      routingRegion,
      accountRoutingRegion,
      platformRegion,
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      profile,
      matches,
    });
  } catch (err) {
    console.error('[riot-id-history]', err);
    return res.status(500).json({ error: 'Failed to fetch Riot match history' });
  }
}
