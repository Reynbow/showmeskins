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
    join(cwd, '.env.local'),
    join(cwd, '.env'),
    join(cwd, '.vercel', '.env.development.local'),
  ];
  for (const filePath of candidates) {
    const key = readEnvFileKey(filePath, 'RIOT_API_KEY');
    if (key) return key;
  }
  return undefined;
}

interface RiotChampionMastery {
  puuid: string;
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime: number;
  championPointsSinceLastLevel: number;
  championPointsUntilNextLevel: number;
  markRequiredForNextLevel?: number;
  tokensEarned?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = resolveRiotApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'RIOT_API_KEY not configured.' });
  }

  const puuid = typeof req.query.puuid === 'string' ? req.query.puuid.trim() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : '';
  const championIdRaw = typeof req.query.championId === 'string' ? req.query.championId.trim() : '';
  const championId = Number(championIdRaw);
  if (!puuid) return res.status(400).json({ error: 'Missing puuid query parameter' });
  if (!Number.isFinite(championId) || championId <= 0) {
    return res.status(400).json({ error: 'Invalid championId query parameter' });
  }

  const platformRegion = VALID_PLATFORMS.has(region as PlatformRegion) ? region : 'oc1';
  const url = `https://${platformRegion}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/by-champion/${championId}`;

  try {
    const riotRes = await fetch(url, {
      headers: { 'X-Riot-Token': apiKey },
    });

    if (riotRes.status === 404) {
      return res.status(200).json({ mastery: null });
    }

    if (riotRes.status === 429) {
      const retryAfter = riotRes.headers.get('Retry-After');
      res.setHeader('Retry-After', retryAfter ?? '30');
      return res.status(429).json({ error: 'Rate limited by Riot API' });
    }

    if (!riotRes.ok) {
      return res.status(502).json({ error: `Riot API returned ${riotRes.status}` });
    }

    const mastery = await riotRes.json() as RiotChampionMastery;
    return res.status(200).json({
      mastery: {
        championId: mastery.championId,
        championLevel: mastery.championLevel,
        championPoints: mastery.championPoints,
        lastPlayTime: mastery.lastPlayTime,
        championPointsSinceLastLevel: mastery.championPointsSinceLastLevel,
        championPointsUntilNextLevel: mastery.championPointsUntilNextLevel,
      },
    });
  } catch (err) {
    console.error('[champion-mastery] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch champion mastery' });
  }
}
