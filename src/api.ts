import type { ChampionBasic, ChampionDetail, ChromaInfo, ItemInfo } from './types';

const BASE_URL = 'https://ddragon.leagueoflegends.com';
const MODEL_CDN = (import.meta.env.VITE_MODEL_CDN_BASE ?? '/model-cdn').replace(/\/+$/, '');
const ASSET_BASE_URL = (import.meta.env.VITE_ASSET_BASE_URL ?? '').replace(/\/+$/, '');
const CDRAGON = '/cdragon/latest/plugins/rcp-be-lol-game-data/global/default/v1';
const CDRAGON_RAW = 'https://raw.communitydragon.org';

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
  const detail = data.data[id] as ChampionDetail;

  // Seraphine's launch ultimate skin ships as three progression variants in
  // Data Dragon. Treat them as one skin card and expose variants in-model.
  if (id === 'Seraphine') {
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
  return `${BASE_URL}/cdn/${version}/img/champion/${id}.png`;
}

export function getSplashArt(championId: string, skinNum: number): string {
  if (ASSET_BASE_URL) {
    return `${ASSET_BASE_URL}/art/splash/${championId}_${skinNum}.webp`;
  }
  return `${BASE_URL}/cdn/img/champion/splash/${championId}_${skinNum}.jpg`;
}

export function getLoadingArt(championId: string, skinNum: number): string {
  if (ASSET_BASE_URL) {
    return `${ASSET_BASE_URL}/art/loading/${championId}_${skinNum}.webp`;
  }
  return `${BASE_URL}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
}

/** Fallback for splash art – tries loading art from the same asset host */
export function getSplashArtFallback(championId: string, skinNum: number): string {
  if (ASSET_BASE_URL) {
    return `${ASSET_BASE_URL}/art/loading/${championId}_${skinNum}.webp`;
  }
  return `${BASE_URL}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
}

/** Fallback for loading/tile art – tries splash art from the same asset host */
export function getLoadingArtFallback(championId: string, skinNum: number): string {
  if (ASSET_BASE_URL) {
    return `${ASSET_BASE_URL}/art/splash/${championId}_${skinNum}.webp`;
  }
  return `${BASE_URL}/cdn/img/champion/splash/${championId}_${skinNum}.jpg`;
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
  const alias = championId.toLowerCase();
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
