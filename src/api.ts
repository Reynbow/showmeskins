import type { ChampionBasic, ChampionDetail, ChromaInfo } from './types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';
const MODEL_CDN = '/model-cdn'; // proxied through Vite to cdn.modelviewer.lol
const CDRAGON = '/cdragon/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const CDRAGON_RAW = 'https://raw.communitydragon.org';

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

/** Runtime cache of resolved chroma URLs (blob or CDragon). */
const chromaUrlCache = new Map<number, string | null>();

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
    if (href.startsWith('?') || href.startsWith('/') || href.endsWith('/')) continue;
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
 */
async function resolveChromaFromCDragon(
  championId: string,
  chromaId: number,
): Promise<string | null> {
  const alias = championId.toLowerCase();
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

  const best =
    bodyFiles.length > 0
      ? bodyFiles.sort((a, b) => a.length - b.length)[0]
      : txCmFiles.sort((a, b) => a.length - b.length)[0];

  return best ? `${baseUrl}${best}` : null;
}

/**
 * Resolve the URL for a chroma's body diffuse texture.
 *
 * Fast path: deterministic Vercel Blob URL with HEAD check (~50ms).
 * Slow path (fallback): CommunityDragon directory listing + pattern match.
 * Results are cached in memory so each chroma is only resolved once.
 */
export async function resolveChromaTextureUrl(
  championId: string,
  chromaId: number,
): Promise<string | null> {
  // 1. Check runtime cache
  if (chromaUrlCache.has(chromaId)) return chromaUrlCache.get(chromaId) ?? null;

  // 2. Try Vercel Blob Storage (fast path – deterministic URL)
  if (BLOB_BASE_URL) {
    const alias = championId.toLowerCase();
    const skinNum = String(chromaId % 1000).padStart(2, '0');
    const blobUrl = `${BLOB_BASE_URL}/chromas/${alias}/skin${skinNum}.webp`;

    if (await blobExists(blobUrl)) {
      chromaUrlCache.set(chromaId, blobUrl);
      return blobUrl;
    }
  }

  // 3. CommunityDragon fallback (slow but universal)
  const url = await resolveChromaFromCDragon(championId, chromaId);
  // Only cache successful resolutions — don't let a temporary failure
  // permanently block the chroma for the rest of the session.
  if (url) {
    chromaUrlCache.set(chromaId, url);
  }
  return url;
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
