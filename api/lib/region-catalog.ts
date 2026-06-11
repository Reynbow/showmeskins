import {
  buildCatalogFromSummary,
  type ChampionRow,
  type RegionCategory,
} from '../../lib/region-catalog-core';
import { loadUniverseRegionImages } from '../../lib/region-catalog-images';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1';

export type { RegionCategory, RegionMember } from '../../lib/region-catalog-core';

interface CdragonChampionSummaryEntry {
  id: number;
  alias: string;
  name: string;
  description?: string;
}

async function loadChampionsByKey(): Promise<Map<string, ChampionRow>> {
  const versionsRes = await fetch(`${DDRAGON}/api/versions.json`);
  if (!versionsRes.ok) throw new Error('Failed to load Data Dragon versions');
  const versions = (await versionsRes.json()) as string[];
  const version = versions[0];
  if (!version) throw new Error('No Data Dragon version available');

  const listRes = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  if (!listRes.ok) throw new Error('Failed to load champion list');
  const listData = (await listRes.json()) as {
    data: Record<string, { id: string; key: string; name: string }>;
  };

  const map = new Map<string, ChampionRow>();
  for (const champ of Object.values(listData.data)) {
    map.set(champ.key, { id: champ.id, key: champ.key, name: champ.name });
  }
  return map;
}

/** Build the region catalog from a handful of upstream requests (no per-champion fetches). */
export async function buildRegionCatalog(): Promise<RegionCategory[]> {
  const [championsByKey, summaryRes, regionImages] = await Promise.all([
    loadChampionsByKey(),
    fetch(`${CDRAGON}/champion-summary.json`),
    loadUniverseRegionImages(),
  ]);

  if (!summaryRes.ok) {
    throw new Error('Failed to load champion summary data from CommunityDragon');
  }

  const summary = (await summaryRes.json()) as CdragonChampionSummaryEntry[];
  return buildCatalogFromSummary(championsByKey, summary, regionImages);
}
