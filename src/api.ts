import type { ChampionBasic, ChampionDetail, ChromaInfo } from './types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';
const MODEL_CDN = '/model-cdn'; // proxied through Vite to cdn.modelviewer.lol
const CDRAGON = '/cdragon/latest/plugins/rcp-be-lol-game-data/global/default/v1';

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

export async function getChampionDetail(id: string): Promise<ChampionDetail> {
  const version = await getLatestVersion();
  const res = await fetch(`${BASE_URL}/cdn/${version}/data/en_US/champion/${id}.json`);
  const data = await res.json();
  return data.data[id];
}

export function getChampionIcon(id: string, version: string): string {
  return `${BASE_URL}/cdn/${version}/img/champion/${id}.png`;
}

export function getSplashArt(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/splash/${championId}_${skinNum}.jpg`;
}

export function getLoadingArt(championId: string, skinNum: number): string {
  return `${BASE_URL}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
}

/** CommunityDragon CDN fallback for splash art (uses numeric champion key) */
export function getSplashArtFallback(championKey: string, skinNum: number): string {
  return `https://cdn.communitydragon.org/latest/champion/${championKey}/splash-art/skin/${skinNum}`;
}

/** CommunityDragon CDN fallback for loading/tile art (uses numeric champion key) */
export function getLoadingArtFallback(championKey: string, skinNum: number): string {
  return `https://cdn.communitydragon.org/latest/champion/${championKey}/tile/skin/${skinNum}`;
}

/**
 * Champions with alternate form models on the CDN.
 * Key = Data Dragon champion ID, value = alternate alias + display label.
 */
export const ALTERNATE_FORMS: Record<string, { alias: string; label: string }> = {
  Elise:   { alias: 'elisespider',   label: 'Spider Form' },
  Nidalee: { alias: 'nidaleecougar', label: 'Cougar Form' },
  Shyvana: { alias: 'shyvanadragon', label: 'Dragon Form' },
  Gnar:    { alias: 'gnarbig',       label: 'Mega Gnar' },
  Quinn:   { alias: 'quinnvalor',    label: 'Valor' },
};

/**
 * Get the URL for a champion skin's 3D model (.glb)
 * Models are hosted on cdn.modelviewer.lol and proxied through Vite.
 *
 * @param championId - Data Dragon champion ID (e.g. "Aatrox", "LeeSin")
 * @param skinId     - Riot skin ID string (e.g. "266000" for base Aatrox)
 */
export function getModelUrl(championId: string, skinId: string): string {
  const alias = championId.toLowerCase();
  return `${MODEL_CDN}/lol/models/${alias}/${skinId}/model.glb`;
}

/**
 * Get the URL for a champion's alternate form model (.glb).
 * Returns null if the champion has no alternate form.
 */
export function getAlternateModelUrl(championId: string, skinId: string): string | null {
  const form = ALTERNATE_FORMS[championId];
  if (!form) return null;
  return `${MODEL_CDN}/lol/models/${form.alias}/${skinId}/model.glb`;
}

/**
 * In-memory cache of directory listings from CommunityDragon.
 * Key = directory path (e.g. "/cdragon/latest/game/assets/characters/aatrox/skins/skin04/")
 * Value = array of filenames in that directory
 */
const dirListingCache = new Map<string, string[]>();

/** Keywords that identify accessory textures (not the main body texture) */
const ACCESSORY_KEYWORDS = [
  'sword', 'wings', 'wing', 'banner', 'recall', '_ult', 'vfx',
  'mask', 'particle', 'weapon', 'shield', 'cape', 'hair', 'tail',
  'loadscreen', 'materialmask',
];

/**
 * Fetch a CommunityDragon directory listing and extract filenames.
 * Results are cached so each directory is only fetched once.
 */
async function fetchDirListing(dirUrl: string): Promise<string[]> {
  const cached = dirListingCache.get(dirUrl);
  if (cached) return cached;

  const res = await fetch(dirUrl);
  if (!res.ok) {
    dirListingCache.set(dirUrl, []);
    return [];
  }
  const html = await res.text();

  // Parse <a href="filename"> links from the HTML directory listing
  const filenames: string[] = [];
  const linkRegex = /<a\s+href="([^"]+)"/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    // Skip parent directory links, subdirectory links, and query params
    if (href.startsWith('?') || href.startsWith('/') || href.endsWith('/')) continue;
    filenames.push(decodeURIComponent(href));
  }

  dirListingCache.set(dirUrl, filenames);
  return filenames;
}

/**
 * Resolve the actual URL for a chroma's body diffuse texture on CommunityDragon.
 *
 * Fetches the directory listing for the chroma's skin folder, parses it to find
 * the body color-map texture (filtering out sword/wings/banner/etc.), and returns
 * the full URL. Results are cached per directory.
 *
 * @param championId  Data Dragon champion ID (e.g. "Aatrox", "LeeSin")
 * @param chromaId    Numeric chroma ID (e.g. 266004)
 * @returns Full proxy URL to the texture, or null if not found
 */
export async function resolveChromaTextureUrl(
  championId: string,
  chromaId: number,
): Promise<string | null> {
  const alias = championId.toLowerCase();
  const skinNum = String(chromaId % 1000).padStart(2, '0');
  const dirPath = `/cdragon/latest/game/assets/characters/${alias}/skins/skin${skinNum}/`;

  const files = await fetchDirListing(dirPath);
  if (files.length === 0) return null;

  // Find all PNG files containing "_tx_cm" (color map textures)
  const txCmFiles = files.filter(
    (f) => f.endsWith('.png') && f.toLowerCase().includes('_tx_cm'),
  );
  if (txCmFiles.length === 0) return null;

  // Filter out accessory textures (sword, wings, banner, etc.)
  const bodyFiles = txCmFiles.filter((f) => {
    const lower = f.toLowerCase();
    return !ACCESSORY_KEYWORDS.some((kw) => lower.includes(kw));
  });

  // Pick the best match: prefer the simplest name (shortest), fall back to first txCm file
  const best =
    bodyFiles.length > 0
      ? bodyFiles.sort((a, b) => a.length - b.length)[0]
      : txCmFiles.sort((a, b) => a.length - b.length)[0];

  return best ? `${dirPath}${best}` : null;
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
