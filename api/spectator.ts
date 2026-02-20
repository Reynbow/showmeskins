import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const VALID_PLATFORMS = new Set<PlatformRegion>([
  'br1', 'eun1', 'euw1', 'jp1', 'kr', 'la1', 'la2',
  'na1', 'oc1', 'tr1', 'ru', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
]);

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

export interface SpectatorParticipant {
  puuid: string;
  summonerId: string;
  summonerName: string;
  riotId?: string;
  championId: number;
  teamId: number;
  spell1Id: number;
  spell2Id: number;
  perks?: {
    perkIds: number[];
    perkStyle: number;
    perkSubStyle: number;
  };
}

export interface SpectatorBan {
  championId: number;
  teamId: number;
  pickTurn: number;
}

export interface SpectatorResponse {
  inGame: true;
  gameId: number;
  gameMode: string;
  gameType: string;
  gameQueueConfigId: number;
  mapId: number;
  gameStartTime: number;
  gameLength: number;
  platformId: string;
  participants: SpectatorParticipant[];
  bannedChampions: SpectatorBan[];
}

export interface SpectatorNotInGame {
  inGame: false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = resolveRiotApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'RIOT_API_KEY not configured.',
    });
  }

  const puuid = typeof req.query.puuid === 'string' ? req.query.puuid.trim() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : '';

  if (!puuid) {
    return res.status(400).json({ error: 'Missing puuid query parameter' });
  }

  const platformRegion = VALID_PLATFORMS.has(region as PlatformRegion) ? region : 'oc1';

  try {
    const url = `https://${platformRegion}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`;
    const spectatorRes = await fetch(url, {
      headers: { 'X-Riot-Token': apiKey },
    });

    if (spectatorRes.status === 404) {
      return res.status(200).json({ inGame: false } satisfies SpectatorNotInGame);
    }

    if (!spectatorRes.ok) {
      console.warn(`[spectator] Riot API returned ${spectatorRes.status} for ${puuid}`);
      return res.status(200).json({ inGame: false } satisfies SpectatorNotInGame);
    }

    const raw = await spectatorRes.json() as Record<string, unknown>;

    const participants: SpectatorParticipant[] = [];
    const rawParticipants = Array.isArray(raw.participants) ? raw.participants : [];
    for (const p of rawParticipants) {
      if (!p || typeof p !== 'object') continue;
      const src = p as Record<string, unknown>;

      let perks: SpectatorParticipant['perks'] | undefined;
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

      participants.push({
        puuid: typeof src.puuid === 'string' ? src.puuid : '',
        summonerId: typeof src.summonerId === 'string' ? src.summonerId : '',
        summonerName: typeof src.summonerName === 'string' ? src.summonerName : '',
        riotId: typeof src.riotId === 'string' ? src.riotId : undefined,
        championId: typeof src.championId === 'number' ? src.championId : 0,
        teamId: typeof src.teamId === 'number' ? src.teamId : 0,
        spell1Id: typeof src.spell1Id === 'number' ? src.spell1Id : 0,
        spell2Id: typeof src.spell2Id === 'number' ? src.spell2Id : 0,
        perks,
      });
    }

    const bannedChampions: SpectatorBan[] = [];
    const rawBans = Array.isArray(raw.bannedChampions) ? raw.bannedChampions : [];
    for (const b of rawBans) {
      if (!b || typeof b !== 'object') continue;
      const src = b as Record<string, unknown>;
      bannedChampions.push({
        championId: typeof src.championId === 'number' ? src.championId : 0,
        teamId: typeof src.teamId === 'number' ? src.teamId : 0,
        pickTurn: typeof src.pickTurn === 'number' ? src.pickTurn : 0,
      });
    }

    const response: SpectatorResponse = {
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

    return res.status(200).json(response);
  } catch (err) {
    console.error('[spectator] Error:', err);
    return res.status(200).json({ inGame: false } satisfies SpectatorNotInGame);
  }
}
