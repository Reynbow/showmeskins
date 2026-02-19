import type { VercelRequest, VercelResponse } from '@vercel/node';

type RoutingRegion = 'americas' | 'europe' | 'asia' | 'sea';

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

const VALID_REGIONS = new Set<RoutingRegion>(['americas', 'europe', 'asia', 'sea']);

function sanitizeRegion(value: string): RoutingRegion {
  const lowered = value.toLowerCase() as RoutingRegion;
  return VALID_REGIONS.has(lowered) ? lowered : 'americas';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'RIOT_API_KEY not configured. Add it in Vercel Environment Variables or .env.local for local dev.',
    });
  }

  const gameName = typeof req.query.gameName === 'string' ? req.query.gameName.trim() : '';
  const tagLine = typeof req.query.tagLine === 'string' ? req.query.tagLine.trim() : '';
  const region = sanitizeRegion(typeof req.query.region === 'string' ? req.query.region.trim() : 'americas');
  const count = Math.min(20, Math.max(1, parseInt(String(req.query.count ?? '10'), 10) || 10));

  if (!gameName || !tagLine) {
    return res.status(400).json({ error: 'Missing gameName or tagLine query parameter' });
  }

  try {
    const accountUrl = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
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

    const idsUrl = new URL(`https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids`);
    idsUrl.searchParams.set('start', '0');
    idsUrl.searchParams.set('count', String(count));

    const idsRes = await fetch(idsUrl.toString(), {
      headers: { 'X-Riot-Token': apiKey },
    });
    if (!idsRes.ok) {
      const text = await idsRes.text();
      return res.status(idsRes.status).json({
        error: `Riot match ids lookup failed: ${idsRes.status}`,
        details: text.slice(0, 500),
      });
    }

    const matchIds = await idsRes.json() as string[];
    const matches: Array<{
      matchId: string;
      gameMode: string;
      gameDuration: number;
      gameEndTimestamp: number;
      championName: string;
      kills: number;
      deaths: number;
      assists: number;
      win: boolean;
    }> = [];

    for (const matchId of matchIds) {
      const detailRes = await fetch(`https://${region}.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
        headers: { 'X-Riot-Token': apiKey },
      });
      if (!detailRes.ok) continue;
      const detail = await detailRes.json() as RiotMatchResponse;
      const participant = detail.info.participants.find((p) => p.puuid === account.puuid);
      if (!participant) continue;
      matches.push({
        matchId: detail.metadata.matchId,
        gameMode: detail.info.gameMode ?? 'UNKNOWN',
        gameDuration: Math.floor(detail.info.gameDuration ?? 0),
        gameEndTimestamp: detail.info.gameEndTimestamp ?? 0,
        championName: participant.championName,
        kills: participant.kills ?? 0,
        deaths: participant.deaths ?? 0,
        assists: participant.assists ?? 0,
        win: !!participant.win,
      });
    }

    return res.status(200).json({
      region,
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      matches,
    });
  } catch (err) {
    console.error('[riot-id-history]', err);
    return res.status(500).json({ error: 'Failed to fetch Riot match history' });
  }
}

