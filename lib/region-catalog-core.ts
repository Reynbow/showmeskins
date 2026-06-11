export interface ChampionRow {
  id: string;
  key: string;
  name: string;
}

export interface RegionMember {
  championId: string;
  championKey: string;
  championName: string;
}

export interface RegionCategory {
  id: string;
  name: string;
  slug: string;
  imageUri?: string;
  members: RegionMember[];
}

export interface ChampionSummaryEntry {
  id: number;
  description?: string;
}

export const REGION_NAMES = [
  'Bandle City',
  'Bilgewater',
  'Demacia',
  'Freljord',
  'Ionia',
  'Ixtal',
  'Noxus',
  'Piltover',
  'Shadow Isles',
  'Shurima',
  'Targon',
  'The Void',
  'Zaun',
  'Runeterra',
] as const;

const REGION_PATTERNS: Array<{ region: (typeof REGION_NAMES)[number]; patterns: RegExp[] }> = [
  { region: 'Bandle City', patterns: [/\bbandle\b/i, /\byordle\b/i] },
  { region: 'Bilgewater', patterns: [/\bbilgewater\b/i, /\bsaltwater\b/i, /\bbounty hunter\b/i] },
  { region: 'Demacia', patterns: [/\bdemacia\b/i] },
  { region: 'Freljord', patterns: [/\bfreljord\b/i] },
  { region: 'Ionia', patterns: [/\bionia\b/i, /\bionian\b/i, /\bwuju\b/i] },
  { region: 'Ixtal', patterns: [/\bixtal\b/i, /\bjungle's edge\b/i, /\bnazumah\b/i] },
  { region: 'Noxus', patterns: [/\bnoxus\b/i, /\bnoxian\b/i] },
  { region: 'Piltover', patterns: [/\bpiltover\b/i] },
  { region: 'Shadow Isles', patterns: [/\bshadow isles\b/i, /\bblack mist\b/i, /\bruined\b/i, /\bhelia\b/i] },
  { region: 'Shurima', patterns: [/\bshurima\b/i, /\bascended\b/i, /\bdarkin\b/i] },
  { region: 'Targon', patterns: [/\btargon\b/i, /\bsolari\b/i, /\blunari\b/i, /\baspect\b/i, /\bcelestial\b/i] },
  { region: 'The Void', patterns: [/\bvoid\b/i, /\bvoidborn\b/i] },
  { region: 'Zaun', patterns: [/\bzaun\b/i] },
];

const REGION_OVERRIDES: Record<string, (typeof REGION_NAMES)[number]> = {
  Aatrox: 'Shurima',
  Alistar: 'Runeterra',
  Annie: 'Noxus',
  Bard: 'Runeterra',
  Brand: 'Freljord',
  Evelynn: 'Runeterra',
  Fiddlesticks: 'Runeterra',
  Gwen: 'Shadow Isles',
  Janna: 'Zaun',
  Jax: 'Shurima',
  Kindred: 'Runeterra',
  Lucian: 'Demacia',
  Morgana: 'Demacia',
  Nilah: 'Runeterra',
  Nocturne: 'Runeterra',
  Ryze: 'Runeterra',
  Senna: 'Shadow Isles',
  Shaco: 'Runeterra',
  Smolder: 'Runeterra',
  TahmKench: 'Bilgewater',
  Taric: 'Targon',
  Varus: 'Ionia',
  Veigar: 'Bandle City',
  Zyra: 'Ixtal',
};

export function toRegionSlug(region: string): string {
  return region.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function inferRegion(champion: ChampionRow, summaryDescription: string): string {
  const override = REGION_OVERRIDES[champion.id];
  if (override) return override;

  const text = summaryDescription.trim();
  for (const matcher of REGION_PATTERNS) {
    if (matcher.patterns.some((pattern) => pattern.test(text))) {
      return matcher.region;
    }
  }
  return 'Runeterra';
}

/** Assign champions to regions from CDragon summary entries (no per-champion fetches). */
export function buildCatalogFromSummary(
  championsByKey: Map<string, ChampionRow>,
  summary: ChampionSummaryEntry[],
  regionImages?: Map<string, string>,
): RegionCategory[] {
  const summaries = summary.filter((entry) => entry.id > 0 && championsByKey.has(String(entry.id)));

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

  for (const entry of summaries) {
    const champion = championsByKey.get(String(entry.id));
    if (!champion) continue;

    const regionName = inferRegion(champion, entry.description ?? '');
    const region = regionMap.get(regionName);
    if (!region) continue;

    region.members.push({
      championId: champion.id,
      championKey: champion.key,
      championName: champion.name,
    });
  }

  return Array.from(regionMap.values())
    .filter((region) => region.members.length > 0)
    .map((region) => ({
      ...region,
      members: [...region.members].sort((a, b) => a.championName.localeCompare(b.championName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
