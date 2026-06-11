import {
  REGION_NAMES,
  type ChampionRow,
  type RegionCategory,
  toRegionSlug,
} from './region-catalog-core';

const UNIVERSE_MEEPS_BASE = 'https://universe-meeps.leagueoflegends.com/v1';

/** Maps universe.leagueoflegends.com faction slugs to our region names. */
export const FACTION_SLUG_TO_REGION: Record<string, (typeof REGION_NAMES)[number]> = {
  'bandle-city': 'Bandle City',
  bilgewater: 'Bilgewater',
  demacia: 'Demacia',
  freljord: 'Freljord',
  ionia: 'Ionia',
  ixtal: 'Ixtal',
  noxus: 'Noxus',
  piltover: 'Piltover',
  'shadow-isles': 'Shadow Isles',
  shurima: 'Shurima',
  'mount-targon': 'Targon',
  void: 'The Void',
  zaun: 'Zaun',
  'unaffiliated-runeterra': 'Runeterra',
};

interface UniverseFactionBrowse {
  factions?: Array<{ slug?: string }>;
}

interface UniverseFactionPage {
  'associated-champions'?: Array<{ slug?: string }>;
}

interface UniverseChampionBrowse {
  champions?: Array<{ slug?: string; 'associated-faction-slug'?: string }>;
}

/** Runeterra faction JSON is blocked (403); derive from champion-browse instead. */
async function loadRuneterraRoster(
  locale: string,
  assignedElsewhere: Set<string>,
): Promise<string[]> {
  try {
    const res = await fetch(`${UNIVERSE_MEEPS_BASE}/${locale}/champion-browse/index.json`);
    if (!res.ok) return [];
    const browse = (await res.json()) as UniverseChampionBrowse;
    return (browse.champions ?? [])
      .filter(
        (entry) =>
          entry['associated-faction-slug'] === 'unaffiliated' &&
          entry.slug &&
          !assignedElsewhere.has(entry.slug),
      )
      .map((entry) => entry.slug!.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function normalizeChampionSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Index universe / Data Dragon champion slugs to playable champions. */
export function buildChampionSlugIndex(
  championsByKey: Map<string, ChampionRow>,
  summary: Array<{ id: number; alias?: string }>,
): Map<string, ChampionRow> {
  const index = new Map<string, ChampionRow>();

  const add = (key: string, row: ChampionRow) => {
    const normalized = normalizeChampionSlug(key);
    if (normalized) index.set(normalized, row);
  };

  for (const row of championsByKey.values()) {
    add(row.id, row);
    add(row.name, row);
    add(row.name.replace(/\s+/g, ''), row);
  }

  for (const entry of summary) {
    const row = championsByKey.get(String(entry.id));
    if (!row || !entry.alias) continue;
    add(entry.alias, row);
  }

  return index;
}

/** Official rosters from universe.leagueoflegends.com (associated-champions per faction). */
export async function loadUniverseFactionRosters(locale = 'en_us'): Promise<Map<string, string[]>> {
  const base = `${UNIVERSE_MEEPS_BASE}/${locale}`;
  const slugs = new Set<string>();

  try {
    const browseRes = await fetch(`${base}/faction-browse/index.json`);
    if (browseRes.ok) {
      const browse = (await browseRes.json()) as UniverseFactionBrowse;
      for (const faction of browse.factions ?? []) {
        if (faction.slug) slugs.add(faction.slug);
      }
    }
  } catch {
    // Continue with known slugs from FACTION_SLUG_TO_REGION.
  }

  if (slugs.size === 0) {
    for (const slug of Object.keys(FACTION_SLUG_TO_REGION)) {
      if (slug !== 'unaffiliated-runeterra') slugs.add(slug);
    }
  }

  const results = await Promise.all(
    [...slugs].map(async (slug) => {
      const regionName = FACTION_SLUG_TO_REGION[slug];
      if (!regionName || regionName === 'Runeterra') return null;

      try {
        const res = await fetch(`${base}/factions/${slug}/index.json`);
        if (!res.ok) return null;
        const page = (await res.json()) as UniverseFactionPage;
        const championSlugs = (page['associated-champions'] ?? [])
          .map((entry) => entry.slug?.trim())
          .filter((value): value is string => Boolean(value));
        return { regionName, championSlugs } as const;
      } catch {
        return null;
      }
    }),
  );

  const rosters = new Map<string, string[]>();
  for (const result of results) {
    if (result) rosters.set(result.regionName, result.championSlugs);
  }

  const assignedElsewhere = new Set<string>();
  for (const championSlugs of rosters.values()) {
    for (const slug of championSlugs) assignedElsewhere.add(slug);
  }

  const runeterra = await loadRuneterraRoster(locale, assignedElsewhere);
  if (runeterra.length > 0) rosters.set('Runeterra', runeterra);

  return rosters;
}

export function buildCatalogFromUniverseRosters(
  slugIndex: Map<string, ChampionRow>,
  rosters: Map<string, string[]>,
  regionImages?: Map<string, string>,
): RegionCategory[] {
  const regionMap = new Map<string, RegionCategory>();
  for (const name of REGION_NAMES) {
    regionMap.set(name, {
      id: toRegionSlug(name),
      name,
      slug: toRegionSlug(name),
      imageUri: regionImages?.get(name),
      members: [],
    });
  }

  for (const name of REGION_NAMES) {
    const region = regionMap.get(name);
    if (!region) continue;

    const championSlugs = rosters.get(name) ?? [];
    const seen = new Set<string>();

    for (const universeSlug of championSlugs) {
      const champion = slugIndex.get(normalizeChampionSlug(universeSlug));
      if (!champion || seen.has(champion.id)) continue;
      seen.add(champion.id);
      region.members.push({
        championId: champion.id,
        championKey: champion.key,
        championName: champion.name,
      });
    }
  }

  return Array.from(regionMap.values())
    .filter((region) => region.members.length > 0)
    .map((region) => ({
      ...region,
      members: [...region.members].sort((a, b) => a.championName.localeCompare(b.championName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
