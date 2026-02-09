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
 * Build the URL for a chroma's diffuse texture (color map) on CommunityDragon.
 *
 * Chroma IDs follow the pattern: championKey * 1000 + skinIndex.
 * E.g. for Braum (key 201), chroma "Amethyst" = 201004 → skin04
 * The texture lives at:
 *   /game/assets/characters/{alias}/skins/skin{nn}/{alias}_skin{nn}_tx_cm.png
 *
 * @param championId  Data Dragon champion ID (e.g. "Braum", "LeeSin")
 * @param chromaId    Numeric chroma ID (e.g. 201004)
 */
export function getChromaTextureUrl(championId: string, chromaId: number): string {
  const alias = championId.toLowerCase();
  const skinNum = String(chromaId % 1000).padStart(2, '0');
  return `/cdragon/latest/game/assets/characters/${alias}/skins/skin${skinNum}/${alias}_skin${skinNum}_tx_cm.png`;
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
