import type { ChampionBasic, ChampionDetail, ChromaInfo, ItemInfo } from './types';

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
    const item = raw as { name: string; description: string; plaintext: string; gold: { total: number } };
    items[Number(id)] = {
      name: item.name,
      descriptionHtml: convertItemHtml(item.description),
      plaintext: item.plaintext || '',
      goldTotal: item.gold?.total ?? 0,
    };
  }
  cachedItems = items;
  return items;
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
