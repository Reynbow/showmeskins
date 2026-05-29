import type { VercelRequest, VercelResponse } from '@vercel/node';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type RoutingRegion = 'americas' | 'europe' | 'asia' | 'sea';
type AccountRoutingRegion = Exclude<RoutingRegion, 'sea'>;
type PlatformRegion =
  | 'br1' | 'eun1' | 'euw1' | 'jp1' | 'kr' | 'la1' | 'la2' | 'na1' | 'oc1' | 'tr1' | 'ru'
  | 'ph2' | 'sg2' | 'th2' | 'tw2' | 'vn2';

interface RiotAccountResponse {
  puuid: string;
  gameName: string;
  tagLine: string;
}

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
  for (const line of raw.split(/\r?\n/)) {
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
  const cwd = process.cwd();
  const candidates = [
    join(cwd, '.env.local'),
    join(cwd, '.env'),
    join(cwd, '.vercel', '.env.development.local'),
  ];
  const localFileKey = (() => {
    for (const filePath of candidates) {
      const key = readEnvFileKey(filePath, 'RIOT_API_KEY');
      if (key) return key;
    }
    return undefined;
  })();
  if (process.env.VERCEL_ENV === 'development' && localFileKey) return localFileKey;
  if (direct) return direct;
  return localFileKey;
}

function sanitizeRegion(value: string): { routingRegion: RoutingRegion; accountRoutingRegion: AccountRoutingRegion } {
  const lowered = value.toLowerCase();
  if (lowered in PLATFORM_TO_ROUTING) {
    const routing = PLATFORM_TO_ROUTING[lowered as PlatformRegion];
    return {
      routingRegion: routing,
      accountRoutingRegion: routing === 'sea' ? 'asia' : routing,
    };
  }
  if (lowered === 'americas' || lowered === 'europe' || lowered === 'asia' || lowered === 'sea') {
    const routing = lowered as RoutingRegion;
    return {
      routingRegion: routing,
      accountRoutingRegion: routing === 'sea' ? 'asia' : routing,
    };
  }
  return { routingRegion: 'sea', accountRoutingRegion: 'asia' };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = resolveRiotApiKey();
  if (!apiKey) {
    return res.status(500).json({
      error: 'RIOT_API_KEY not configured. Add it in .env.local for local dev.',
    });
  }

  const gameName = typeof req.query.gameName === 'string' ? req.query.gameName.trim() : '';
  const tagLine = typeof req.query.tagLine === 'string' ? req.query.tagLine.trim() : '';
  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Missing gameName or tagLine query parameter' });
  }

  const maxMatches = Math.min(30, Math.max(5, parseInt(String(req.query.maxMatches ?? '20'), 10) || 20));
  const { routingRegion, accountRoutingRegion } = sanitizeRegion(
    typeof req.query.region === 'string' ? req.query.region.trim() : 'oc1',
  );

  try {
    const accountUrl = `https://${accountRoutingRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    const accountRes = await fetch(accountUrl, { headers: { 'X-Riot-Token': apiKey } });
    if (!accountRes.ok) {
      const text = await accountRes.text();
      return res.status(accountRes.status).json({
        error: `Riot account lookup failed: ${accountRes.status}`,
        details: text.slice(0, 500),
      });
    }
    const account = await accountRes.json() as RiotAccountResponse;

    const idsUrl = new URL(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids`);
    idsUrl.searchParams.set('start', '0');
    idsUrl.searchParams.set('count', String(maxMatches));

    const idsRes = await fetch(idsUrl.toString(), { headers: { 'X-Riot-Token': apiKey } });
    if (!idsRes.ok) {
      const text = await idsRes.text();
      return res.status(idsRes.status).json({
        error: `Riot match ids lookup failed: ${idsRes.status}`,
        details: text.slice(0, 500),
      });
    }

    const matchIds = (await idsRes.json() as string[]).slice(0, maxMatches);
    const skinIds = new Set<string>();

    await mapPool(matchIds, 4, async (matchId) => {
      const detailRes = await fetch(
        `https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        { headers: { 'X-Riot-Token': apiKey } },
      );
      if (!detailRes.ok) return;
      const detail = await detailRes.json() as {
        info: { participants: Array<{ puuid: string; skin?: number; championId?: number }> };
      };
      const participant = detail.info.participants.find((p) => p.puuid === account.puuid);
      if (!participant || typeof participant.skin !== 'number') return;
      const skinNum = participant.skin % 1000;
      if (skinNum <= 0) return;
      skinIds.add(String(participant.skin));
    });

    return res.status(200).json({
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      region: typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : 'oc1',
      skinIds: Array.from(skinIds).sort((a, b) => Number(a) - Number(b)),
      matchesScanned: matchIds.length,
      source: 'recent_matches',
      note: 'Riot does not expose owned skins publicly. These are skins seen in recent ranked/normal matches; add more via manual list in the UI.',
    });
  } catch (err) {
    console.error('[player-skins]', err);
    return res.status(500).json({ error: 'Failed to scan player skins from match history' });
  }
}
