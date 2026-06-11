import { buildCatalogFromSummary } from '../../lib/region-catalog-core';
import { loadUniverseRegionImages } from '../../lib/region-catalog-images';
import {
  buildCatalogFromUniverseRosters,
  buildChampionSlugIndex,
  loadUniverseFactionRosters,
} from '../../lib/region-catalog-universe';
import { getChampions } from '../api';
import type { RegionCategory } from '../types';

const CDRAGON = '/cdragon/latest/plugins/rcp-be-lol-game-data/global/default/v1';

/** Fast client-side region catalog when /api/regions is unavailable (e.g. local dev without dev:api). */
export async function buildRegionCatalogClient(): Promise<RegionCategory[]> {
  const [champs, summaryRes, regionImages, universeRosters] = await Promise.all([
    getChampions(),
    fetch(`${CDRAGON}/champion-summary.json`),
    loadUniverseRegionImages(),
    loadUniverseFactionRosters(),
  ]);

  if (!summaryRes.ok) {
    throw new Error('Failed to load champion summary data from CommunityDragon');
  }

  const summary = (await summaryRes.json()) as Array<{ id: number; alias?: string; description?: string }>;
  const championsByKey = new Map(
    Object.values(champs).map((champ) => [champ.key, { id: champ.id, key: champ.key, name: champ.name }]),
  );

  if (universeRosters.size > 0) {
    const slugIndex = buildChampionSlugIndex(championsByKey, summary);
    const catalog = buildCatalogFromUniverseRosters(slugIndex, universeRosters, regionImages);
    if (catalog.length > 0) return catalog;
  }

  return buildCatalogFromSummary(championsByKey, summary, regionImages);
}
