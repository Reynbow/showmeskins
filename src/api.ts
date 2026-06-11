import type {
  AramWardrobeChampion,
  ChampionBasic,
  ChampionDetail,
  ChromaInfo,
  ItemInfo,
  RegionCategory,
  RegionMember,
  Skin,
  SkinLineCategory,
  SkinLineMember,
} from './types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';
const MODEL_CDN = (import.meta.env.VITE_MODEL_CDN_BASE ?? '/model-cdn').replace(/\/+$/, '');
const CDRAGON = '/cdragon/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const CDRAGON_RAW = 'https://raw.communitydragon.org';
const UNIVERSE_MEEPS_BASE = 'https://universe-meeps.leagueoflegends.com/v1';

const CHAMPION_ID_ALIASES: Record<string, string> = {
  fiddlesticks: 'Fiddlesticks',
};

/**
 * Data Dragon's image CDN (splash/loading art) uses old internal champion
 * names for some champions, unlike the data/icon endpoints. Notably the
 * newer Fiddlesticks skins only exist under "FiddleSticks_N.jpg".
 */
const CHAMPION_ART_ALIASES: Record<string, string> = {
  fiddlesticks: 'FiddleSticks',
};

function normalizeChampionId(championId: string): string {
  const trimmed = championId.trim();
  if (!trimmed) return trimmed;
  return CHAMPION_ID_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

function artChampionId(championId: string): string {
  const trimmed = championId.trim();
  if (!trimmed) return trimmed;
  return CHAMPION_ART_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

export function toUrlSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Build a model CDN asset URL for a champion alias + skin ID.
 */
export function getModelAssetUrl(alias: string, skinId: string, filename = 'model.glb'): string {
  return `${MODEL_CDN}/lol/models/${alias}/${skinId}/${filename}`;
}

let cachedVersion: string | null = null;

export async function getLatestVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  const res = await fetch(`${BASE_URL}/api/versions.json`);
  const versions: string[] = await res.json();
  cachedVersion = versions[0];
  return cachedVersion;
}

export async function getChampions(): Promise<Record<string, ChampionBasic>> {
  const version = await getLatestVersion();
  const res = await fetch(`${BASE_URL}/cdn/${version}/data/en_US/champion.json`);
  const data = await res.json();
  return data.data;
}

/**
 * Convert Data Dragon's custom HTML tags into standard HTML with CSS classes.
 * Preserves <br> for line breaks and wraps custom tags in styled <span>s.
 */
/** Map stat keywords to color classes (matching the "Your Stats" panel) */
const STAT_COLORS: [RegExp, string][] = [
  [/\bAttack Damage\b/g, 'itt-c-ad'],
  [/\bAbility Power\b/g, 'itt-c-ap'],
  [/\bArmor\b/g, 'itt-c-armor'],
  [/\bMagic Resist\b/g, 'itt-c-mr'],
  [/\bAttack Speed\b/g, 'itt-c-as'],
  [/\bAbility Haste\b/g, 'itt-c-ah'],
  [/\bHealth(?:\s+Regen)?\b/g, 'itt-c-hp'],
  [/\bMove(?:ment)?\s*Speed\b/g, 'itt-c-ms'],
  [/\bCritical Strike(?:\s+(?:Chance|Damage))?\b/g, 'itt-c-crit'],
  [/\bLife Steal\b/g, 'itt-c-ls'],
  [/\bOmnivamp\b/g, 'itt-c-ls'],
  [/\bLethality\b/g, 'itt-c-lethality'],
  [/\bMana(?:\s+Regen)?\b/g, 'itt-c-mana'],
  [/\bBase Mana Regen\b/g, 'itt-c-mana'],
  [/\bBase Health Regen\b/g, 'itt-c-hp'],
];

function colorizeStats(html: string): string {
  for (const [pattern, cls] of STAT_COLORS) {
    html = html.replace(pattern, (m) => `<span class="${cls}">${m}</span>`);
  }
  return html;
}

function convertItemHtml(raw: string): string {
  return raw
    // Strip the outer wrapper
    .replace(/<\/?mainText>/gi, '')
    // Stats block → div (colorize stat keywords inside)
    .replace(/<stats>([\s\S]*?)<\/stats>/gi, (_match, inner: string) =>
      '<div class="itt-stats">' + colorizeStats(inner) + '</div>'
    )
    // Attention (highlighted numbers)
    .replace(/<attention>/gi, '<span class="itt-attention">')
    .replace(/<\/attention>/gi, '</span>')
    // Passive / Active names
    .replace(/<passive>/gi, '<span class="itt-passive">')
    .replace(/<\/passive>/gi, '</span>')
    .replace(/<active>/gi, '<span class="itt-active">')
    .replace(/<\/active>/gi, '</span>')
    // Damage types
    .replace(/<physicalDamage>/gi, '<span class="itt-phys">')
    .replace(/<\/physicalDamage>/gi, '</span>')
    .replace(/<magicDamage>/gi, '<span class="itt-magic">')
    .replace(/<\/magicDamage>/gi, '</span>')
    .replace(/<trueDamage>/gi, '<span class="itt-true">')
    .replace(/<\/trueDamage>/gi, '</span>')
    // Utility keywords
    .replace(/<healing>/gi, '<span class="itt-healing">')
    .replace(/<\/healing>/gi, '</span>')
    .replace(/<shield>/gi, '<span class="itt-shield">')
    .replace(/<\/shield>/gi, '</span>')
    .replace(/<speed>/gi, '<span class="itt-speed">')
    .replace(/<\/speed>/gi, '</span>')
    .replace(/<status>/gi, '<span class="itt-status">')
    .replace(/<\/status>/gi, '</span>')
    .replace(/<OnHit>/gi, '<span class="itt-onhit">')
    .replace(/<\/OnHit>/gi, '</span>')
    // Rarity tags
    .replace(/<rarityMythic>/gi, '<span class="itt-mythic">')
    .replace(/<\/rarityMythic>/gi, '</span>')
    .replace(/<rarityLegendary>/gi, '<span class="itt-legendary">')
    .replace(/<\/rarityLegendary>/gi, '</span>')
    // Scale tags
    .replace(/<scale\w+>/gi, '<span class="itt-scale">')
    .replace(/<\/scale\w+>/gi, '</span>')
    // List items
    .replace(/<li>/gi, '<div class="itt-li">')
    .replace(/<\/li>/gi, '</div>')
    // Rules (horizontal separator)
    .replace(/<rules>/gi, '<hr class="itt-rule">')
    .replace(/<\/rules>/gi, '')
    // Collapse 3+ consecutive <br> into a separator
    .replace(/(<br\s*\/?>){3,}/gi, '<div class="itt-sep"></div>')
    // Collapse 2 consecutive <br> into a spacer
    .replace(/(<br\s*\/?>){2}/gi, '<div class="itt-spacer"></div>')
    // Strip any remaining unknown tags (but keep <br>, <span>, <div>, <hr>)
    .replace(/<(?!\/?(?:br|span|div|hr)\b)[^>]+>/gi, '')
    .trim();
}

let cachedItems: Record<number, ItemInfo> | null = null;

export async function getItems(): Promise<Record<number, ItemInfo>> {
  if (cachedItems) return cachedItems;
  const version = await getLatestVersion();
  const res = await fetch(`${BASE_URL}/cdn/${version}/data/en_US/item.json`);
  const data = await res.json();
  const items: Record<number, ItemInfo> = {};
  for (const [id, raw] of Object.entries(data.data)) {
    const item = raw as { name: string; description: string; plaintext: string; gold: { total: number }; tags: string[] };
    items[Number(id)] = {
      name: item.name,
      descriptionHtml: convertItemHtml(item.description),
      plaintext: item.plaintext || '',
      goldTotal: item.gold?.total ?? 0,
      tags: item.tags ?? [],
    };
  }
  cachedItems = items;
  return items;
}

interface CdragonSkinLine {
  id: number;
  name: string;
  description: string;
}

interface CdragonSkinLineRef {
  id: number;
}

interface CdragonSkinSummary {
  id: number;
  isBase?: boolean;
  name?: string;
  skinClassification?: string;
  skinLines?: CdragonSkinLineRef[];
}

export interface RecentSkinSpotlight {
  championId: string;
  championName: string;
  skinId: string;
  skinNum: number;
  skinName: string;
  skinSlug: string;
  /** Riot's centered (champion-framed) splash; falls back to Data Dragon art when absent. */
  splashUrl?: string;
}

let cachedSkinLineCatalog: SkinLineCategory[] | null = null;
let cachedRegionCatalog: RegionCategory[] | null = null;
let cachedAramWardrobe: AramWardrobeChampion[] | null = null;
let cachedRecentSkins: RecentSkinSpotlight[] | null = null;
let cachedRecentSkinsKey = '';

/** Skins newly added in the current patch (server-side patch diff via /api/recent-skins). */
export async function getRecentSkins(limit = 16): Promise<RecentSkinSpotlight[]> {
  const cacheKey = `api:${limit}`;
  if (cachedRecentSkins && cachedRecentSkinsKey === cacheKey) return cachedRecentSkins;

  const res = await fetch(`/api/recent-skins?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load recent skins');
  const result = (await res.json()) as RecentSkinSpotlight[];

  cachedRecentSkins = result;
  cachedRecentSkinsKey = cacheKey;
  return result;
}

/**
 * Champions (and their qualifying skins) included in the "ARAM Wardrobe"
 * subscription: skins released before 2026, currently available to purchase,
 * and originally priced at 1350 RP or less. Computed server-side from Meraki
 * pricing data via /api/aram-wardrobe.
 */
export async function getAramWardrobeCatalog(): Promise<AramWardrobeChampion[]> {
  if (cachedAramWardrobe) return cachedAramWardrobe;

  const res = await fetch('/api/aram-wardrobe');
  if (!res.ok) throw new Error('Failed to load ARAM wardrobe');
  const result = (await res.json()) as AramWardrobeChampion[];

  cachedAramWardrobe = result;
  return result;
}

export async function getSkinLineCatalog(championsByKey: Record<string, ChampionBasic>): Promise<SkinLineCategory[]> {
  if (cachedSkinLineCatalog) return cachedSkinLineCatalog;
  if (Object.keys(championsByKey).length === 0) return [];

  const [skinLinesRes, skinsRes] = await Promise.all([
    fetch(`${CDRAGON}/skinlines.json`),
    fetch(`${CDRAGON}/skins.json`),
  ]);

  if (!skinLinesRes.ok || !skinsRes.ok) {
    throw new Error('Failed to load skin line data from CommunityDragon');
  }

  const skinLinesRaw = (await skinLinesRes.json()) as CdragonSkinLine[];
  const skinsRaw = (await skinsRes.json()) as Record<string, CdragonSkinSummary>;

  const skinLineMap = new Map<number, SkinLineCategory>();
  for (const line of skinLinesRaw) {
    if (!line || typeof line.id !== 'number') continue;
    if (!line.name || !line.name.trim()) continue;
    skinLineMap.set(line.id, {
      id: line.id,
      name: line.name,
      slug: toUrlSlug(line.name),
      description: line.description ?? '',
      members: [],
    });
  }

  const dedupe = new Set<string>();
  for (const skin of Object.values(skinsRaw)) {
    if (!skin || typeof skin.id !== 'number') continue;
    if (skin.isBase) continue;
    if (!Array.isArray(skin.skinLines) || skin.skinLines.length === 0) continue;

    const championKey = String(Math.floor(skin.id / 1000));
    const champion = championsByKey[championKey];
    if (!champion) continue;

    const member: SkinLineMember = {
      championId: champion.id,
      championKey,
      championName: champion.name,
      skinId: String(skin.id),
      skinNum: skin.id % 1000,
      skinName: skin.name?.trim() || champion.name,
    };

    for (const lineRef of skin.skinLines) {
      if (!lineRef || typeof lineRef.id !== 'number') continue;
      const line = skinLineMap.get(lineRef.id);
      if (!line) continue;
      const key = `${line.id}:${member.skinId}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      line.members.push(member);
    }
  }

  const categories = Array.from(skinLineMap.values())
    .filter((line) => line.members.length > 0)
    .map((line) => ({
      ...line,
      members: [...line.members].sort((a, b) => {
        const champCmp = a.championName.localeCompare(b.championName);
        if (champCmp !== 0) return champCmp;
        return a.skinNum - b.skinNum;
      }),
    }))
    .sort((a, b) => {
      const memberDiff = b.members.length - a.members.length;
      if (memberDiff !== 0) return memberDiff;
      return a.name.localeCompare(b.name);
    });

  if (categories.length > 0) cachedSkinLineCatalog = categories;
  return categories;
}

interface CdragonChampionSummaryEntry {
  id: number;
  alias: string;
  name: string;
  description?: string;
}

interface CdragonChampionProfile {
  shortBio?: string;
}

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

const REGION_NAMES = [
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

function toRegionSlug(region: string): string {
  return region.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

async function loadUniverseRegionImages(locale = 'en_us'): Promise<Map<string, string>> {
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
    // Use whatever images have already been captured.
  }

  if (!images.has('Runeterra')) {
    try {
      const runeterraRes = await fetch(`${UNIVERSE_MEEPS_BASE}/${locale}/factions/unaffiliated-runeterra/index.json`);
      if (runeterraRes.ok) {
        const runeterra = (await runeterraRes.json()) as UniverseFactionEntry;
        addEntry({ name: 'Runeterra', slug: 'unaffiliated-runeterra', image: runeterra.image });
      }
    } catch {
      // Optional extra image source.
    }
  }

  return images;
}

function inferRegion(champion: ChampionBasic, summaryDescription: string, shortBio: string): string {
  const override = REGION_OVERRIDES[champion.id];
  if (override) return override;

  const text = `${summaryDescription} ${shortBio}`.trim();
  for (const matcher of REGION_PATTERNS) {
    if (matcher.patterns.some((pattern) => pattern.test(text))) {
      return matcher.region;
    }
  }
  return 'Runeterra';
}

async function loadChampionShortBio(championNumericId: number): Promise<string> {
  try {
    const res = await fetch(`${CDRAGON}/champions/${championNumericId}.json`);
    if (!res.ok) return '';
    const payload = (await res.json()) as CdragonChampionProfile;
    return payload.shortBio ?? '';
  } catch {
    return '';
  }
}

export async function getRegionCatalog(championsByKey: Record<string, ChampionBasic>): Promise<RegionCategory[]> {
  if (cachedRegionCatalog) return cachedRegionCatalog;
  if (Object.keys(championsByKey).length === 0) return [];

  const [summaryRes, regionImages] = await Promise.all([
    fetch(`${CDRAGON}/champion-summary.json`),
    loadUniverseRegionImages(),
  ]);
  if (!summaryRes.ok) {
    throw new Error('Failed to load champion summary data from CommunityDragon');
  }
  const summary = (await summaryRes.json()) as CdragonChampionSummaryEntry[];

  const summaries = summary.filter((entry) => entry.id > 0 && championsByKey[String(entry.id)]);
  const shortBioById = new Map<number, string>();
  const chunkSize = 20;
  for (let i = 0; i < summaries.length; i += chunkSize) {
    const chunk = summaries.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (entry) => {
        const shortBio = await loadChampionShortBio(entry.id);
        shortBioById.set(entry.id, shortBio);
      }),
    );
  }

  const regionMap = new Map<string, RegionCategory>();
  for (const name of REGION_NAMES) {
    regionMap.set(name, {
      id: toRegionSlug(name),
      name,
      slug: toRegionSlug(name),
      imageUri: regionImages.get(name),
      members: [],
    });
  }

  for (const entry of summaries) {
    const champion = championsByKey[String(entry.id)];
    if (!champion) continue;

    const regionName = inferRegion(champion, entry.description ?? '', shortBioById.get(entry.id) ?? '');
    const region = regionMap.get(regionName);
    if (!region) continue;

    const member: RegionMember = {
      championId: champion.id,
      championKey: champion.key,
      championName: champion.name,
    };
    region.members.push(member);
  }

  const categories = Array.from(regionMap.values())
    .filter((region) => region.members.length > 0)
    .map((region) => ({
      ...region,
      members: [...region.members].sort((a, b) => a.championName.localeCompare(b.championName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedRegionCatalog = categories;
  return categories;
}

/**
 * Data Dragon lists chromas as extra skin rows; the carousel should only show
 * CommunityDragon top-level skins (one card per skin; chromas stay on swatches).
 */
async function filterDdragonSkinsToBaseSkins(championKey: string, skins: Skin[]): Promise<Skin[]> {
  try {
    const res = await fetch(`${CDRAGON}/champions/${championKey}.json`);
    if (!res.ok) return skins;
    const data = (await res.json()) as { skins?: Array<{ id: number }> };
    const baseSkinIds = new Set((data.skins ?? []).map((s) => String(s.id)));
    if (baseSkinIds.size === 0) return skins;
    return skins.filter((s) => baseSkinIds.has(s.id));
  } catch {
    return skins;
  }
}

export async function getChampionDetail(id: string): Promise<ChampionDetail> {
  const normalizedId = normalizeChampionId(id);
  const version = await getLatestVersion();
  const res = await fetch(`${BASE_URL}/cdn/${version}/data/en_US/champion/${normalizedId}.json`);
  const data = await res.json();
  const detail = data.data[normalizedId] as ChampionDetail;

  detail.skins = await filterDdragonSkinsToBaseSkins(detail.key, detail.skins);

  // Seraphine's launch ultimate skin ships as three progression variants in
  // Data Dragon. Treat them as one skin card and expose variants in-model.
  if (normalizedId === 'Seraphine') {
    detail.skins = detail.skins
      .filter((skin) => skin.id !== '147002' && skin.id !== '147003')
      .map((skin) =>
        skin.id === '147001'
          ? { ...skin, name: 'K/DA ALL OUT Seraphine' }
          : skin,
      );
  }

  return detail;
}

export function getChampionIcon(id: string, version: string): string {
  return `${BASE_URL}/cdn/${version}/img/champion/${normalizeChampionId(id)}.png`;
}

export function getSplashArt(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/splash/${artChampionId(championId)}_${skinNum}.jpg`;
}

export function getLoadingArt(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/loading/${artChampionId(championId)}_${skinNum}.jpg`;
}

/** Square skin tile art (e.g. for dense list thumbnails). */
export function getTileArt(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/tiles/${artChampionId(championId)}_${skinNum}.jpg`;
}

/** Fallback for splash art – uses loading art from Data Dragon */
export function getSplashArtFallback(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/loading/${artChampionId(championId)}_${skinNum}.jpg`;
}

/** Direct Data Dragon loading art URL (always external, JPG) */
export function getLoadingArtDdragon(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/loading/${artChampionId(championId)}_${skinNum}.jpg`;
}

/**
 * Champions that always show both the main model and a companion model together
 * (no toggle). E.g. Annie + Tibbers. Key = champion ID, value = companion alias.
 */
export const COMPANION_MODELS: Record<string, { alias: string; label: string }> = {
  Annie: { alias: 'annietibbers', label: 'Tibbers' },
};

/**
 * Champions with alternate forms (toggle between forms).
 * - `alias`: alternate model alias when the form has a dedicated model.
 * - `textureFile`: alternate texture file when the form uses the base model.
 * - `idleAnimation`: optional preferred idle animation for that form.
 */
export const ALTERNATE_FORMS: Record<string, { label: string; alias?: string; textureFile?: string; idleAnimation?: string }> = {
  Elise:   { alias: 'elisespider',   label: 'Spider Form' },
  Nidalee: { alias: 'nidaleecougar', label: 'Cougar Form' },
  Shyvana: { alias: 'shyvanadragon', label: 'Dragon Form' },
  Gnar:    { alias: 'gnarbig',       label: 'Mega Gnar' },
  Quinn:   { alias: 'quinnvalor',    label: 'Valor' },
  Belveth: { label: 'Ult Form', textureFile: 'belveth_ult.png', idleAnimation: 'Idle_Ult.anm' },
};

/**
 * Optional historical/alternate full-model variants for champions.
 * These are distinct from ALTERNATE_FORMS (spider/cougar/etc.) and are
 * intended for legacy model versions (e.g. pre-rework visuals).
 */
export interface ChampionModelVersion {
  /** Stable ID used in UI state */
  id: string;
  /** UI label (e.g. "2011") */
  label: string;
  /** Optional list of skin IDs this version applies to */
  skinIds?: string[];
  /** Optional explicit skin ID to use for this variant's model/texture lookup */
  skinIdOverride?: string;
  /** Model alias in the model CDN path (required for dedicated model variants) */
  alias?: string;
  /** Optional texture file override for texture-only variants */
  textureFile?: string;
  /** Optional preferred idle animation name for this version */
  idleAnimation?: string;
}

export const CHAMPION_MODEL_VERSIONS: Record<string, ChampionModelVersion[]> = {
  Seraphine: [
    { id: 'kda-indie', label: 'Indie', alias: 'seraphine', skinIds: ['147001'], skinIdOverride: '147001' },
    { id: 'kda-rising-star', label: 'Rising Star', alias: 'seraphine', skinIds: ['147001'], skinIdOverride: '147002' },
    { id: 'kda-superstar', label: 'Superstar', alias: 'seraphine', skinIds: ['147001'], skinIdOverride: '147003' },
  ],
  Lux: [
    { id: 'elementalist-air', label: 'Air', alias: 'luxair', skinIds: ['99007'] },
    { id: 'elementalist-fire', label: 'Fire', alias: 'luxfire', skinIds: ['99007'] },
    { id: 'elementalist-water', label: 'Water', alias: 'luxwater', skinIds: ['99007'] },
    { id: 'elementalist-nature', label: 'Nature', alias: 'luxnature', skinIds: ['99007'] },
    { id: 'elementalist-ice', label: 'Ice', alias: 'luxice', skinIds: ['99007'] },
    { id: 'elementalist-storm', label: 'Storm', alias: 'luxstorm', skinIds: ['99007'] },
    { id: 'elementalist-magma', label: 'Magma', alias: 'luxmagma', skinIds: ['99007'] },
    { id: 'elementalist-mystic', label: 'Mystic', alias: 'luxmystic', skinIds: ['99007'] },
    { id: 'elementalist-dark', label: 'Dark', alias: 'luxdark', skinIds: ['99007'] },
  ],
  // Example:
  // Caitlyn: [{ id: 'legacy-2011', label: '2011', alias: 'caitlyn_2011' }],
};

/**
 * Champions whose models contain submeshes for multiple "level-up" forms.
 * The GLB includes all meshes, with later-form meshes initially hidden
 * (material userData.visible === false).  Each form defines which mesh names
 * to force-show and which to force-hide relative to the default state.
 *
 * `meshNameMatch` uses case-insensitive substring matching against THREE.Mesh.name.
 */
export interface LevelForm {
  label: string;
  /** Mesh names (substrings) to force visible */
  show: string[];
  /** Mesh names (substrings) to force hidden */
  hide: string[];
}

export interface LevelFormChampion {
  /** UI group label, e.g. "Ascension" */
  label: string;
  forms: LevelForm[];
}

export const LEVEL_FORM_CHAMPIONS: Record<string, LevelFormChampion> = {
  Udyr: {
    label: 'Stance',
    forms: [
      {
        // Q: Wilding Claw (Bear/Tiger material families, skin-dependent)
        label: 'Claw',
        show: ['bear', 'beararms', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'bearshoes', 'bearclaws', 'bearbodytattoofx', 'bearfx', 'normalbear', 'tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'lefthand', 'leftbandage', 'face'],
        hide: ['boar', 'boararms', 'boarshoes', 'boarbodytattoofx', 'boarfx', 'normalboar', 'turtlearms', 'turtlearmsmax', 'turtlehairmax', 'ram', 'ramarms', 'ramhorns', 'ramshoes', 'rambodytattoofx', 'ramhornfx', 'normalram', 'phoenix', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'phoenixshoes', 'phoenixbodytattoofx', 'phoenixfx', 'normalphoenix', 'orb'],
      },
      {
        // W: Iron Mantle (Boar/Turtle material families)
        label: 'Mantle',
        show: ['boar', 'boararms', 'boarshoes', 'boarbodytattoofx', 'boarfx', 'normalboar', 'turtlearms', 'turtlearmsmax', 'turtlehairmax'],
        hide: ['bear', 'beararms', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'bearshoes', 'bearclaws', 'bearbodytattoofx', 'bearfx', 'normalbear', 'tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'lefthand', 'leftbandage', 'face', 'ram', 'ramarms', 'ramhorns', 'ramshoes', 'rambodytattoofx', 'ramhornfx', 'normalram', 'phoenix', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'phoenixshoes', 'phoenixbodytattoofx', 'phoenixfx', 'normalphoenix', 'orb'],
      },
      {
        // E: Blazing Stampede (Ram material family)
        label: 'Stampede',
        show: ['ram', 'ramarms', 'ramhorns', 'ramshoes', 'rambodytattoofx', 'ramhornfx', 'normalram'],
        hide: ['bear', 'beararms', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'bearshoes', 'bearclaws', 'bearbodytattoofx', 'bearfx', 'normalbear', 'tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'lefthand', 'leftbandage', 'face', 'boar', 'boararms', 'boarshoes', 'boarbodytattoofx', 'boarfx', 'normalboar', 'turtlearms', 'turtlearmsmax', 'turtlehairmax', 'phoenix', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'phoenixshoes', 'phoenixbodytattoofx', 'phoenixfx', 'normalphoenix', 'orb'],
      },
      {
        // R: Wingborne Tempest (Phoenix material family)
        label: 'Tempest',
        show: ['phoenix', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'phoenixshoes', 'phoenixbodytattoofx', 'phoenixfx', 'normalphoenix', 'orb'],
        hide: ['bear', 'beararms', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'bearshoes', 'bearclaws', 'bearbodytattoofx', 'bearfx', 'normalbear', 'tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'lefthand', 'leftbandage', 'face', 'boar', 'boararms', 'boarshoes', 'boarbodytattoofx', 'boarfx', 'normalboar', 'turtlearms', 'turtlearmsmax', 'turtlehairmax', 'ram', 'ramarms', 'ramhorns', 'ramshoes', 'rambodytattoofx', 'ramhornfx', 'normalram'],
      },
    ],
  },
  Kayle: {
    label: 'Ascension',
    forms: [
      {
        // Default: top wings + sword, basic armor
        label: 'Level 1',
        show: [],
        hide: ['level11', 'wings_mid', 'wings_bot'],
      },
      {
        // Bottom wings appear
        label: 'Level 6',
        show: ['wings_bot'],
        hide: ['level11', 'wings_mid'],
      },
      {
        // Middle wings + helmet/armor upgrade (level11 replaces level1)
        label: 'Level 11',
        show: ['wings_bot', 'wings_mid', 'level11'],
        hide: ['level1'],
      },
      {
        // Full ascension (dual-wield sword + fire VFX are runtime-spawned, not in model)
        label: 'Level 16',
        show: ['wings_bot', 'wings_mid', 'level11'],
        hide: ['level1'],
      },
    ],
  },
};

/**
 * Skin-specific level-form definitions.
 * Keyed by skin ID string (e.g. "21016" for Gun Goddess Miss Fortune).
 * Takes precedence over LEVEL_FORM_CHAMPIONS when the selected skin matches.
 */
export const LEVEL_FORM_SKINS: Record<string, LevelFormChampion> = {
  // Spirit Guard Udyr (77003) uses Tiger/Turtle/Bear/Phoenix material families.
  '77003': {
    label: 'Stance',
    forms: [
      {
        label: 'Claw',
        show: ['tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax'],
        hide: ['turtlearms', 'turtlearmsmax', 'turtlehairmax', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'orb'],
      },
      {
        label: 'Mantle',
        show: ['turtlearms', 'turtlearmsmax', 'turtlehairmax'],
        hide: ['tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'bearhorns', 'bearhornsmax', 'bearhairmax', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'orb'],
      },
      {
        label: 'Stampede',
        show: ['bearhorns', 'bearhornsmax', 'bearhairmax'],
        hide: ['tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'turtlearms', 'turtlearmsmax', 'turtlehairmax', 'phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'orb'],
      },
      {
        label: 'Tempest',
        show: ['phoenixarms', 'phoenixarmsmax', 'phoenixarmswing', 'phoenixhairmax', 'orb'],
        hide: ['tigerarms', 'tigerarmsmax', 'tigersharearms', 'tigerhairmax', 'turtlearms', 'turtlearmsmax', 'turtlehairmax', 'bearhorns', 'bearhornsmax', 'bearhairmax'],
      },
    ],
  },
  /* Gun Goddess Miss Fortune (skin 21016) — 4 weapon/exosuit forms.
     In this GLB, form-specific geometry is keyed by MATERIAL names:
       Weapon0 (default visible), Weapon1/2/3 (default hidden).
     Form buttons must toggle those material-tagged meshes. */
  '21016': {
    label: 'Exosuit',
    forms: [
      {
        label: 'Zero Hour',
        show: ['weapon0'],
        hide: ['weapon1', 'weapon2', 'weapon3'],
      },
      {
        label: 'Scarlet Fair',
        show: ['weapon1'],
        hide: ['weapon0', 'weapon2', 'weapon3'],
      },
      {
        label: 'Royal Arms',
        show: ['weapon2'],
        hide: ['weapon0', 'weapon1', 'weapon3'],
      },
      {
        label: 'Starswarm',
        show: ['weapon3'],
        hide: ['weapon0', 'weapon1', 'weapon2'],
      },
    ],
  },
};

/**
 * Get the URL for a champion skin's 3D model (.glb)
 * Models are hosted on cdn.modelviewer.lol and proxied through Vite.
 *
 * @param championId - Data Dragon champion ID (e.g. "Aatrox", "LeeSin")
 * @param skinId     - Riot skin ID string (e.g. "266000" for base Aatrox)
 */
export function getModelUrl(championId: string, skinId: string): string {
  const alias = normalizeChampionId(championId).toLowerCase();
  return getModelAssetUrl(alias, skinId);
}

/**
 * Get the URL for a champion's alternate form model (.glb).
 * Returns null if the champion has no alternate form.
 */
export function getAlternateModelUrl(championId: string, skinId: string): string | null {
  const form = ALTERNATE_FORMS[championId];
  if (!form?.alias) return null;
  return getModelAssetUrl(form.alias, skinId);
}

/**
 * Get the URL for a champion's alternate form texture.
 * Returns null if the champion's alternate form does not use texture swapping.
 */
export function getAlternateFormTextureUrl(championId: string, skinId: string): string | null {
  const form = ALTERNATE_FORMS[championId];
  if (!form?.textureFile) return null;
  const alias = form.alias ?? championId.toLowerCase();
  return getModelAssetUrl(alias, skinId, form.textureFile);
}

/**
 * Get the URL for a champion model-version variant (.glb).
 * Returns null when the variant does not provide a dedicated model alias.
 */
export function getModelVersionUrl(version: ChampionModelVersion, championId: string, skinId: string): string | null {
  if (!version.alias) return null;
  return getModelAssetUrl(version.alias, version.skinIdOverride ?? skinId);
}

/**
 * Get the URL for a champion model-version texture override.
 * Returns null when the variant does not provide a texture override.
 */
export function getModelVersionTextureUrl(version: ChampionModelVersion, championId: string, skinId: string): string | null {
  if (!version.textureFile) return null;
  const alias = version.alias ?? championId.toLowerCase();
  return getModelAssetUrl(alias, version.skinIdOverride ?? skinId, version.textureFile);
}

/**
 * Get the URL for a champion's companion model (.glb), shown alongside the main model.
 * Returns null if the champion has no companion.
 */
export function getCompanionModelUrl(championId: string, skinId: string): string | null {
  const comp = COMPANION_MODELS[championId];
  if (!comp) return null;
  return getModelAssetUrl(comp.alias, skinId);
}

import { getChampionScaleFromHeight } from './data/championHeights';

/**
 * Manual scale overrides for 3D models (by Data Dragon alias, lowercase).
 * Takes precedence over height-based scaling when present.
 */
export const CHAMPION_SCALE_OVERRIDES: Record<string, number> = {
  ziggs: 0.3,
  amumu: 0.8,
};

/** Global scale multiplier — 0.8 = 20% smaller across all champions */
const GLOBAL_SCALE_MULTIPLIER = 0.8;

/**
 * Get scale factor for a champion (manual override or lore height-based).
 */
export function getChampionScale(alias: string): number {
  const manual = CHAMPION_SCALE_OVERRIDES[alias.toLowerCase()];
  const base = manual != null ? manual : getChampionScaleFromHeight(alias);
  return base * GLOBAL_SCALE_MULTIPLIER;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Chroma Texture Resolution
   Uses Vercel Blob Storage as primary source (deterministic URLs, no manifest
   needed). Falls back to the slow CommunityDragon directory-listing approach
   for any chromas not yet uploaded to Blob.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Base URL for Vercel Blob Storage (e.g. "https://xxx.public.blob.vercel-storage.com").
 * When set, chroma textures are resolved via deterministic blob URLs first.
 * Leave empty to always use the CommunityDragon fallback.
 */
const BLOB_BASE_URL = (import.meta.env.VITE_BLOB_BASE_URL ?? '').replace(/\/+$/, '');

/** Runtime cache of resolved chroma URLs (blob or CDragon). Key: chromaId or "chromaId:baseSkinId". */
const chromaUrlCache = new Map<number | string, string | null>();

/**
 * Check whether a blob URL exists via a HEAD request.
 * Results are cached so each URL is only checked once per session.
 */
const blobHeadCache = new Map<string, boolean>();

async function blobExists(url: string): Promise<boolean> {
  const cached = blobHeadCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ok = res.ok;
    blobHeadCache.set(url, ok);
    return ok;
  } catch {
    blobHeadCache.set(url, false);
    return false;
  }
}

/* ── CommunityDragon fallback (slow path) ────────────────────────────────── */

/**
 * Fright Night skin line (id 170) uses cel-shaded textures with a different UV layout.
 * For these skins we use the combined _tx_cm atlas instead of _body_tx_cm.
 * Base skin IDs from CommunityDragon (skinLines id 170).
 */
export const FRIGHT_NIGHT_BASE_SKIN_IDS = new Set([
  '1031',     // Annie
  '119039',   // Draven
  '111018',   // Nautilus
  '888010',   // Renata Glasc
  '48012',    // Trundle
  '6023',     // Urgot
  '45060',    // Veigar
  '221028',   // Zeri
  '35054',    // Shaco
  '555064',   // Pyke
  '20044',    // Nunu & Willump
]);

/** Keywords that identify accessory textures (not the main body texture) */
const ACCESSORY_KEYWORDS = [
  'sword', 'wings', 'wing', 'banner', 'recall', '_ult', 'vfx',
  'mask', 'particle', 'weapon', 'shield', 'cape', 'hair', 'tail',
  'loadscreen', 'materialmask',
];

const dirListingCache = new Map<string, string[]>();

/** Parse <a href="filename"> links from an HTML directory listing */
function parseDirListing(html: string): string[] {
  const filenames: string[] = [];
  const linkRegex = /<a\s+href="([^"]+)"/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    // Skip query strings, absolute paths, directories, and external URLs
    if (href.startsWith('?') || href.startsWith('/') || href.endsWith('/')) continue;
    if (href.startsWith('http://') || href.startsWith('https://')) continue;
    filenames.push(decodeURIComponent(href));
  }
  return filenames;
}

/** Fetch a directory listing from CommunityDragon (tries proxy, then direct). */
async function fetchDirListing(alias: string, skinNum: string): Promise<{ filenames: string[]; baseUrl: string }> {
  const proxyPath = `/cdragon/latest/game/assets/characters/${alias}/skins/skin${skinNum}/`;

  const cachedFilenames = dirListingCache.get(proxyPath);
  if (cachedFilenames) return { filenames: cachedFilenames, baseUrl: proxyPath };

  // Try proxy first
  let filenames: string[] = [];
  let baseUrl = proxyPath;
  try {
    const res = await fetch(proxyPath);
    if (res.ok) filenames = parseDirListing(await res.text());
  } catch { /* proxy failed */ }

  // Fallback to direct
  if (filenames.length === 0) {
    const directUrl = `${CDRAGON_RAW}/latest/game/assets/characters/${alias}/skins/skin${skinNum}/`;
    try {
      const res = await fetch(directUrl);
      if (res.ok) {
        filenames = parseDirListing(await res.text());
        if (filenames.length > 0) baseUrl = directUrl;
      }
    } catch { /* direct also failed */ }
  }

  // Only cache non-empty results — a temporary network failure shouldn't
  // permanently block the chroma for the entire session.
  if (filenames.length > 0) {
    dirListingCache.set(proxyPath, filenames);
  }
  return { filenames, baseUrl };
}

/**
 * Slow-path: resolve a chroma texture URL via CommunityDragon directory listing.
 * Used as fallback when the chroma is not in the pre-built manifest.
 * @param baseSkinId - Optional base skin ID; when it's Fright Night, uses combined atlas texture
 */
async function resolveChromaFromCDragon(
  championId: string,
  chromaId: number,
  baseSkinId?: string,
  modelAlias?: string,
): Promise<string | null> {
  const alias = (modelAlias ?? championId).toLowerCase();
  const skinNum = String(chromaId % 1000).padStart(2, '0');

  const { filenames: files, baseUrl } = await fetchDirListing(alias, skinNum);
  if (files.length === 0) {
    console.warn(`[chroma] No files found for ${alias}/skin${skinNum} (chromaId ${chromaId})`);
    return null;
  }

  const txCmFiles = files.filter(
    (f) => f.endsWith('.png') && f.toLowerCase().includes('_tx_cm'),
  );
  if (txCmFiles.length === 0) {
    console.warn(`[chroma] No _tx_cm textures in ${alias}/skin${skinNum} (chromaId ${chromaId}). Files: ${files.join(', ')}`);
    return null;
  }

  const bodyFiles = txCmFiles.filter((f) => {
    const lower = f.toLowerCase();
    return !ACCESSORY_KEYWORDS.some((kw) => lower.includes(kw));
  });

  // Fright Night (cel-shaded) uses the combined _tx_cm atlas; _body_tx_cm has
  // misaligned UVs for this skin line.
  const useCombined = baseSkinId != null && FRIGHT_NIGHT_BASE_SKIN_IDS.has(baseSkinId);
  const candidateFiles = bodyFiles.length > 0 ? bodyFiles : txCmFiles;

  let toSort: string[];
  if (useCombined) {
    toSort = candidateFiles.filter((f) => !f.toLowerCase().includes('_body_'));
    if (toSort.length === 0) toSort = candidateFiles;
  } else {
    const bodyOnly = candidateFiles.filter((f) => f.toLowerCase().includes('_body_'));
    toSort = bodyOnly.length > 0 ? bodyOnly : candidateFiles;
  }
  const best = toSort.sort((a, b) => a.length - b.length)[0];

  return best ? `${baseUrl}${best}` : null;
}

/**
 * Resolve the URL for a chroma's body diffuse texture.
 *
 * Fast path: deterministic Vercel Blob URL with HEAD check (~50ms).
 * Slow path (fallback): CommunityDragon directory listing + pattern match.
 * Results are cached in memory so each chroma is only resolved once.
 * @param baseSkinId - Optional base skin ID; when it's Fright Night, uses combined atlas texture
 * @param modelAlias - Optional model alias (e.g. "annietibbers") for companion/pet chromas; uses championId when omitted
 */
export async function resolveChromaTextureUrl(
  championId: string,
  chromaId: number,
  baseSkinId?: string,
  modelAlias?: string,
): Promise<string | null> {
  const aliasForPath = (modelAlias ?? championId).toLowerCase();
  const cacheKey = modelAlias
    ? (baseSkinId ? `${chromaId}:${baseSkinId}:${aliasForPath}` : `${chromaId}:${aliasForPath}`)
    : (baseSkinId ? `${chromaId}:${baseSkinId}` : String(chromaId));
  if (chromaUrlCache.has(cacheKey)) return chromaUrlCache.get(cacheKey) ?? null;

  // 2. Try Vercel Blob Storage (fast path – deterministic URL)
  // Note: Blob stores one texture per chroma; re-run sync-chromas with Fright Night
  // handling to update blob contents for this skin line
  if (BLOB_BASE_URL) {
    const skinNum = String(chromaId % 1000).padStart(2, '0');
    const blobUrl = `${BLOB_BASE_URL}/chromas/${aliasForPath}/skin${skinNum}.webp`;

    if (await blobExists(blobUrl)) {
      chromaUrlCache.set(cacheKey, blobUrl);
      return blobUrl;
    }
  }

  // 3. CommunityDragon fallback (slow but universal)
  const url = await resolveChromaFromCDragon(championId, chromaId, baseSkinId, modelAlias);
  // Only cache successful resolutions — don't let a temporary failure
  // permanently block the chroma for the rest of the session.
  if (url) {
    chromaUrlCache.set(cacheKey, url);
  }
  return url;
}

/**
 * Result of resolving an LCU skin number to base skin + optional chroma.
 * LCU reports skin numbers that include both base skins and chromas (e.g. Pool Party = 15,
 * Pool Party Rainbow chroma = 23). Chromas use the base skin's model with a texture overlay.
 */
export interface LcuSkinResolution {
  baseSkinId: string;   // Riot skin ID for the base skin (model), e.g. "74015"
  chromaId: number | null;  // Chroma ID if a chroma was selected, e.g. 74023
}

/**
 * Resolve an LCU-reported skin number to the base skin and optional chroma.
 * Uses CommunityDragon data where skins and chromas are both listed with full IDs.
 * Chromas are grouped after their base skin in Riot's numbering.
 *
 * @param championKey - Numeric champion key (e.g. "74" for Heimerdinger)
 * @param skinNum - The skin number from LCU (selectedSkinId % 1000)
 * @returns Base skin ID for the model and chroma ID if a chroma was selected
 */
export async function resolveLcuSkinNum(
  championKey: string,
  skinNum: number,
): Promise<LcuSkinResolution | null> {
  try {
    const res = await fetch(`${CDRAGON}/champions/${championKey}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const skins: Array<{ id: number; chromas?: Array<{ id: number }> }> = data.skins ?? [];

    for (const skin of skins) {
      const baseSkinNum = skin.id % 1000;
      if (baseSkinNum === skinNum) {
        return { baseSkinId: String(skin.id), chromaId: null };
      }
      if (skin.chromas) {
        for (const chroma of skin.chromas) {
          const chromaSkinNum = chroma.id % 1000;
          if (chromaSkinNum === skinNum) {
            return { baseSkinId: String(skin.id), chromaId: chroma.id };
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch chroma data for a champion from CommunityDragon.
 * Returns a map from skin ID (string, e.g. "201001") → array of chromas.
 */
export async function getChampionChromas(
  championKey: string,
): Promise<Record<string, ChromaInfo[]>> {
  try {
    const res = await fetch(`${CDRAGON}/champions/${championKey}.json`);
    if (!res.ok) return {};
    const data = await res.json();
    const result: Record<string, ChromaInfo[]> = {};
    for (const skin of data.skins) {
      if (skin.chromas && skin.chromas.length > 0) {
        result[String(skin.id)] = skin.chromas.map(
          (c: { id: number; name: string; colors: string[] }) => ({
            id: c.id,
            name: c.name,
            colors: c.colors,
          }),
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}
