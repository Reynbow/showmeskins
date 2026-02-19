import type { VercelRequest, VercelResponse } from '@vercel/node';

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

const POSITION_MAP: Record<string, 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | ''> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MIDDLE',
  MID: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  BOT: 'BOTTOM',
  UTILITY: 'UTILITY',
  SUPPORT: 'UTILITY',
};

const SUMMONER_SPELLS: Record<number, { id: string; displayName: string }> = {
  1: { id: 'SummonerBoost', displayName: 'Cleanse' },
  3: { id: 'SummonerExhaust', displayName: 'Exhaust' },
  4: { id: 'SummonerFlash', displayName: 'Flash' },
  6: { id: 'SummonerHaste', displayName: 'Ghost' },
  7: { id: 'SummonerHeal', displayName: 'Heal' },
  11: { id: 'SummonerSmite', displayName: 'Smite' },
  12: { id: 'SummonerTeleport', displayName: 'Teleport' },
  13: { id: 'SummonerMana', displayName: 'Clarity' },
  14: { id: 'SummonerDot', displayName: 'Ignite' },
  21: { id: 'SummonerBarrier', displayName: 'Barrier' },
  30: { id: 'SummonerPoroRecall', displayName: 'Poro Recall' },
  31: { id: 'SummonerPoroThrow', displayName: 'To the King!' },
  32: { id: 'SummonerSnowball', displayName: 'Mark' },
};

type RiotMatch = {
  metadata: {
    matchId: string;
  };
  info: {
    gameCreation?: number;
    gameEndTimestamp?: number;
    gameDuration?: number;
    gameMode?: string;
    participants: RiotParticipant[];
  };
};

type RiotParticipant = {
  puuid: string;
  riotIdGameName?: string;
  riotIdTagline?: string;
  summonerName?: string;
  championName: string;
  championId: number;
  individualPosition?: string;
  teamPosition?: string;
  teamId: number;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  visionScore?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  summoner1Id?: number;
  summoner2Id?: number;
  champLevel?: number;
  win?: boolean;
};

function normalizePosition(value: string | undefined): 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | '' {
  if (!value) return '';
  return POSITION_MAP[value.toUpperCase()] ?? '';
}

function mapSpell(spellId: number | undefined) {
  if (!spellId || spellId <= 0) return undefined;
  const known = SUMMONER_SPELLS[spellId];
  if (known) return known;
  return { id: `Summoner${spellId}`, displayName: `Spell ${spellId}` };
}

function pickBestMatch(
  matches: RiotMatch[],
  puuid: string,
  expectedDurationSec: number | null,
  championName: string,
): RiotMatch | null {
  let best: RiotMatch | null = null;
  let bestScore = -1;

  for (const match of matches) {
    const participant = match.info.participants.find((p) => p.puuid === puuid);
    if (!participant) continue;

    let score = 100;
    if (championName && participant.championName.toLowerCase() === championName.toLowerCase()) {
      score += 20;
    }
    if (expectedDurationSec !== null && Number.isFinite(expectedDurationSec)) {
      const gameDuration = Math.floor(match.info.gameDuration ?? 0);
      const diff = Math.abs(gameDuration - expectedDurationSec);
      if (diff <= 180) score += 20;
      else if (diff <= 480) score += 10;
    }

    const endTs = Number(match.info.gameEndTimestamp ?? 0);
    score += Math.min(10, Math.floor(endTs / 100000000000));

    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }

  return best;
}

function mapToPostgameData(match: RiotMatch, puuid: string) {
  const players = match.info.participants.map((p) => {
    const displayName = p.riotIdGameName
      ? `${p.riotIdGameName}${p.riotIdTagline ? `#${p.riotIdTagline}` : ''}`
      : (p.summonerName || p.puuid);

    const itemsRaw = [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6];
    const items = itemsRaw
      .map((itemID, slot) => ({ itemID: itemID ?? 0, slot }))
      .filter((it) => it.itemID > 0)
      .map((it) => ({
        itemID: it.itemID,
        displayName: '',
        count: 1,
        slot: it.slot,
        price: 0,
      }));

    return {
      summonerName: displayName,
      championName: p.championName,
      team: p.teamId === 100 ? 'ORDER' : 'CHAOS',
      position: normalizePosition(p.individualPosition || p.teamPosition),
      level: p.champLevel ?? 0,
      kills: p.kills ?? 0,
      deaths: p.deaths ?? 0,
      assists: p.assists ?? 0,
      creepScore: (p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0),
      wardScore: p.visionScore ?? 0,
      items,
      skinID: (p.championId ?? 0) * 1000,
      isActivePlayer: p.puuid === puuid,
      isDead: false,
      respawnTimer: 0,
      spellD: mapSpell(p.summoner1Id),
      spellF: mapSpell(p.summoner2Id),
    };
  });

  const active = match.info.participants.find((p) => p.puuid === puuid);
  const gameTime = Math.floor(match.info.gameDuration ?? 0);

  return {
    gameTime,
    gameMode: match.info.gameMode || 'CLASSIC',
    gameResult: active?.win ? 'Win' : 'Lose',
    activePlayer: {
      summonerName: players.find((p) => p.isActivePlayer)?.summonerName ?? '',
      level: active?.champLevel ?? 0,
      currentGold: 0,
      stats: {},
    },
    players,
    killFeed: [],
    liveEvents: [],
  };
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

  const puuid = typeof req.query.puuid === 'string' ? req.query.puuid.trim() : '';
  if (!puuid) {
    return res.status(400).json({ error: 'Missing puuid query parameter' });
  }

  const platformId = typeof req.query.platformId === 'string' ? req.query.platformId.trim().toUpperCase() : '';
  const region = typeof req.query.region === 'string' ? req.query.region.trim().toLowerCase() : '';
  const championName = typeof req.query.championName === 'string' ? req.query.championName.trim() : '';
  const expectedDurationSecRaw = typeof req.query.expectedDurationSec === 'string'
    ? parseInt(req.query.expectedDurationSec, 10)
    : NaN;
  const expectedDurationSec = Number.isFinite(expectedDurationSecRaw) ? expectedDurationSecRaw : null;

  const routingRegion = region || (platformId && PLATFORM_TO_REGION[platformId]) || 'americas';
  const idsUrl = new URL(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids`);
  idsUrl.searchParams.set('start', '0');
  idsUrl.searchParams.set('count', '5');

  try {
    const idsRes = await fetch(idsUrl.toString(), {
      headers: { 'X-Riot-Token': apiKey },
    });
    if (!idsRes.ok) {
      const text = await idsRes.text();
      return res.status(idsRes.status).json({
        error: `Riot API error (ids): ${idsRes.status}`,
        details: text.slice(0, 500),
      });
    }

    const matchIds: string[] = await idsRes.json();
    if (!Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(404).json({ error: 'No recent matches found' });
    }

    const fetchedMatches: RiotMatch[] = [];
    for (const matchId of matchIds) {
      const matchRes = await fetch(`https://${routingRegion}.api.riotgames.com/lol/match/v5/matches/${matchId}`, {
        headers: { 'X-Riot-Token': apiKey },
      });
      if (!matchRes.ok) {
        continue;
      }
      const match = await matchRes.json() as RiotMatch;
      if (match?.info?.participants?.length) {
        fetchedMatches.push(match);
      }
    }

    const best = pickBestMatch(fetchedMatches, puuid, expectedDurationSec, championName);
    if (!best) {
      return res.status(404).json({ error: 'No suitable recent match found yet (Riot data may still be processing)' });
    }

    return res.status(200).json({
      source: 'riot-match-v5',
      region: routingRegion,
      matchId: best.metadata.matchId,
      data: mapToPostgameData(best, puuid),
    });
  } catch (err) {
    console.error('[match-postgame]', err);
    return res.status(500).json({ error: 'Failed to fetch postgame data from Riot API' });
  }
}

