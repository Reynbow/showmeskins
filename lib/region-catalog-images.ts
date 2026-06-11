import { REGION_NAMES } from './region-catalog-core';

const UNIVERSE_MEEPS_BASE = 'https://universe-meeps.leagueoflegends.com/v1';

interface UniverseFactionImage {
  uri?: string;
}

interface UniverseFactionEntry {
  name?: string;
  slug?: string;
  image?: UniverseFactionImage;
}

interface UniverseFactionBrowse {
  factions?: UniverseFactionEntry[];
}

const UNIVERSE_REGION_TO_LOCAL: Record<string, (typeof REGION_NAMES)[number]> = {
  'bandle city': 'Bandle City',
  'bandle-city': 'Bandle City',
  bilgewater: 'Bilgewater',
  demacia: 'Demacia',
  ionia: 'Ionia',
  ixtal: 'Ixtal',
  noxus: 'Noxus',
  piltover: 'Piltover',
  'shadow isles': 'Shadow Isles',
  'shadow-isles': 'Shadow Isles',
  shurima: 'Shurima',
  targon: 'Targon',
  'mount targon': 'Targon',
  'mount-targon': 'Targon',
  freljord: 'Freljord',
  void: 'The Void',
  'the void': 'The Void',
  zaun: 'Zaun',
  runeterra: 'Runeterra',
  'unaffiliated runeterra': 'Runeterra',
  'unaffiliated-runeterra': 'Runeterra',
};

/** Faction banner art from the League Universe CMS (same source as /api/regions). */
export async function loadUniverseRegionImages(locale = 'en_us'): Promise<Map<string, string>> {
  const images = new Map<string, string>();

  const addEntry = (entry: UniverseFactionEntry | null | undefined) => {
    if (!entry) return;
    const uri = entry.image?.uri?.trim();
    if (!uri) return;
    const nameKey = (entry.name ?? '').trim().toLowerCase();
    const slugKey = (entry.slug ?? '').trim().toLowerCase();
    const mappedName = UNIVERSE_REGION_TO_LOCAL[nameKey] ?? UNIVERSE_REGION_TO_LOCAL[slugKey];
    if (!mappedName) return;
    images.set(mappedName, uri);
  };

  try {
    const browseRes = await fetch(`${UNIVERSE_MEEPS_BASE}/${locale}/faction-browse/index.json`);
    if (browseRes.ok) {
      const browse = (await browseRes.json()) as UniverseFactionBrowse;
      for (const faction of browse.factions ?? []) addEntry(faction);
    }
  } catch {
    // Optional image source.
  }

  if (!images.has('Runeterra')) {
    try {
      const runeterraRes = await fetch(`${UNIVERSE_MEEPS_BASE}/${locale}/factions/unaffiliated-runeterra/index.json`);
      if (runeterraRes.ok) {
        const runeterra = (await runeterraRes.json()) as UniverseFactionEntry;
        addEntry({ name: 'Runeterra', slug: 'unaffiliated-runeterra', image: runeterra.image });
      }
    } catch {
      // Optional image source.
    }
  }

  return images;
}
