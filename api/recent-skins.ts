import type { VercelRequest, VercelResponse } from '@vercel/node';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON_RAW = 'https://raw.communitydragon.org';

interface CdragonSkinSummary {
  id: number;
  isBase?: boolean;
  name?: string;
  skinClassification?: string;
}

interface RecentSkinSpotlight {
  championId: string;
  championName: string;
  skinId: string;
  skinNum: number;
  skinName: string;
  skinSlug: string;
}

interface DdragonChampion {
  id: string;
  key: string;
  name: string;
}

function toUrlSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function patchFolderFromVersion(version: string): string {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

function cdragonSkinsUrl(patchFolder: string): string {
  return `${CDRAGON_RAW}/${patchFolder}/plugins/rcp-be-lol-game-data/global/default/v1/skins.json`;
}

async function fetchCdragonSkinsJson(patchFolder: string): Promise<Record<string, CdragonSkinSummary> | null> {
  const res = await fetch(cdragonSkinsUrl(patchFolder));
  if (!res.ok) return null;
  return (await res.json()) as Record<string, CdragonSkinSummary>;
}

function isHeroCarouselSkin(skin: CdragonSkinSummary): boolean {
  return Boolean(
    skin
    && typeof skin.id === 'number'
    && !skin.isBase
    && skin.skinClassification === 'kChampion'
    && skin.name
    && !skin.name.startsWith('Prestige '),
  );
}

function pickPrimaryNewSkinPerChampion(added: CdragonSkinSummary[]): CdragonSkinSummary[] {
  const byChampion = new Map<number, CdragonSkinSummary[]>();
  for (const skin of added.filter(isHeroCarouselSkin)) {
    const championKey = Math.floor(skin.id / 1000);
    const group = byChampion.get(championKey) ?? [];
    group.push(skin);
    byChampion.set(championKey, group);
  }

  const picked: CdragonSkinSummary[] = [];
  for (const group of byChampion.values()) {
    const nonEclipse = group.filter((skin) => !skin.name!.startsWith('Eclipse '));
    const pool = nonEclipse.length > 0 ? nonEclipse : group;
    pool.sort((a, b) => a.id - b.id);
    picked.push(pool[0]);
  }

  return picked.sort((a, b) => b.id - a.id);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(32, Math.max(1, Number(req.query.limit) || 16));

  try {
    const versionsRes = await fetch(`${DDRAGON}/api/versions.json`);
    if (!versionsRes.ok) {
      return res.status(502).json({ error: 'Failed to load patch versions' });
    }

    const versions = (await versionsRes.json()) as string[];
    const currentVersion = versions[0] ?? '';

    const [latestSkins, championsRes] = await Promise.all([
      fetchCdragonSkinsJson('latest'),
      fetch(`${DDRAGON}/cdn/${currentVersion}/data/en_US/champion.json`),
    ]);

    if (!latestSkins) {
      return res.status(502).json({ error: 'Failed to load skin data from CommunityDragon' });
    }
    if (!championsRes.ok) {
      return res.status(502).json({ error: 'Failed to load champion data' });
    }

    const championsData = (await championsRes.json()) as { data: Record<string, DdragonChampion> };
    const championsByKey = Object.fromEntries(
      Object.values(championsData.data ?? {}).map((champ) => [champ.key, champ]),
    );

    // Walk back through older patches until we find the most recent batch of
    // new skins. Early in a patch cycle the diff vs the previous patch is
    // empty (skins ship mid-patch), so compare against older patches too.
    const MAX_PATCHES_BACK = 4;
    let newSkins: CdragonSkinSummary[] = [];
    for (let i = 1; i <= MAX_PATCHES_BACK && i < versions.length; i++) {
      const patchFolder = patchFolderFromVersion(versions[i]);
      const previousSkins = await fetchCdragonSkinsJson(patchFolder);
      if (!previousSkins) continue;

      const previousIds = new Set(Object.keys(previousSkins));
      newSkins = Object.values(latestSkins).filter((skin) => !previousIds.has(String(skin.id)));
      if (newSkins.some(isHeroCarouselSkin)) break;
    }

    const candidates = pickPrimaryNewSkinPerChampion(newSkins);
    const result: RecentSkinSpotlight[] = [];

    for (const skin of candidates) {
      const championKey = String(Math.floor(skin.id / 1000));
      const champion = championsByKey[championKey];
      if (!champion || !skin.name) continue;

      const label = skin.name === 'default' ? champion.name : skin.name;
      result.push({
        championId: champion.id,
        championName: champion.name,
        skinId: String(skin.id),
        skinNum: skin.id % 1000,
        skinName: label,
        skinSlug: toUrlSlug(label),
      });
      if (result.length >= limit) break;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[recent-skins]', err);
    return res.status(500).json({ error: 'Failed to compute recent skins' });
  }
}
