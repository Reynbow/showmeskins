import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Map platformId (e.g. NA1, EUW1) to Riot Match-v5 regional routing value. */
const PLATFORM_TO_REGION: Record<string, string> = {
  NA1: 'americas',
  BR1: 'americas',
  LA1: 'americas',
  LA2: 'americas',
  EUN1: 'europe',
  EUW1: 'europe',
  TR1: 'europe',
  RU: 'europe',
  KR: 'asia',
  JP1: 'asia',
  OC1: 'sea',
};

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

  const puuid = typeof req.query.puuid === 'string' ? req.query.puuid.trim() : '';
  const platformId = typeof req.query.platformId === 'string' ? req.query.platformId.trim().toUpperCase() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : '';

  if (!puuid) {
    return res.status(400).json({ error: 'Missing puuid query parameter' });
  }

  const routingRegion = region || (platformId && PLATFORM_TO_REGION[platformId]) || 'americas';
  const start = Math.max(0, parseInt(String(req.query.start || '0'), 10) || 0);
  const count = Math.min(100, Math.max(0, parseInt(String(req.query.count || '20'), 10) || 20));

  const url = new URL(
    `https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`,
  );
  url.searchParams.set('start', String(start));
  url.searchParams.set('count', String(count));

  try {
    const riotRes = await fetch(url.toString(), {
      headers: { 'X-Riot-Token': apiKey },
    });

    if (!riotRes.ok) {
      const text = await riotRes.text();
      return res.status(riotRes.status).json({
        error: `Riot API error: ${riotRes.status}`,
        details: text.slice(0, 500),
      });
    }

    const matchIds: string[] = await riotRes.json();
    return res.status(200).json({ matchIds, region: routingRegion });
  } catch (err) {
    console.error('[match-history]', err);
    return res.status(500).json({ error: 'Failed to fetch match history' });
  }
}
