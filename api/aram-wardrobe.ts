import type { VercelRequest, VercelResponse } from '@vercel/node';

const MERAKI = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json';

/** Membership rule for the "ARAM Wardrobe" subscription. */
const MAX_COST = 1350;
const RELEASED_BEFORE = '2026-01-01';

interface MerakiSkin {
  id: number;
  name: string;
  isBase?: boolean;
  availability?: string;
  cost?: number | string;
  release?: string | null;
}

interface MerakiChampion {
  id: number;
  key: string;   // Data Dragon champion id, e.g. "Aatrox"
  name: string;
  skins?: MerakiSkin[];
}

interface AramSkin {
  skinId: string;
  skinNum: number;
  skinName: string;
  cost: number;
}

interface AramWardrobeChampion {
  championId: string;
  championName: string;
  championKey: string;
  skins: AramSkin[];
}

/** True when a skin belongs in the ARAM Wardrobe per the subscription rule. */
function qualifies(skin: MerakiSkin): boolean {
  if (skin.isBase) return false;
  if (typeof skin.cost !== 'number' || skin.cost > MAX_COST) return false;
  if (skin.availability !== 'Available') return false;
  if (!skin.release || skin.release >= RELEASED_BEFORE) return false;
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const merakiRes = await fetch(MERAKI);
    if (!merakiRes.ok) {
      return res.status(502).json({ error: 'Failed to load skin pricing data' });
    }

    const champions = (await merakiRes.json()) as Record<string, MerakiChampion>;
    const result: AramWardrobeChampion[] = [];

    for (const champion of Object.values(champions)) {
      if (!champion || !champion.key || !Array.isArray(champion.skins)) continue;

      const skins: AramSkin[] = champion.skins
        .filter(qualifies)
        .map((skin) => ({
          skinId: String(skin.id),
          skinNum: skin.id % 1000,
          skinName: skin.name?.trim() || champion.name,
          cost: skin.cost as number,
        }))
        .sort((a, b) => a.skinNum - b.skinNum);

      if (skins.length === 0) continue;

      result.push({
        championId: champion.key,
        championName: champion.name,
        championKey: String(champion.id),
        skins,
      });
    }

    result.sort((a, b) => a.championName.localeCompare(b.championName));

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[aram-wardrobe]', err);
    return res.status(500).json({ error: 'Failed to compute ARAM wardrobe' });
  }
}
