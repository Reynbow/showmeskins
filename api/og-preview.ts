import type { VercelRequest, VercelResponse } from '@vercel/node';

const SITE_NAME = 'x9report.com';
const SITE_BASE = 'https://x9report.com';
const DDRAGON = 'https://ddragon.leagueoflegends.com';

/** DDragon's image CDN uses old internal names for some champions (e.g. FiddleSticks). */
const CHAMPION_ART_ALIASES: Record<string, string> = {
  fiddlesticks: 'FiddleSticks',
};

function artChampionId(championId: string): string {
  return CHAMPION_ART_ALIASES[championId.toLowerCase()] ?? championId;
}

const RESERVED = new Set([
  'companion', 'history', 'dev', 'regions', 'aram-wardrobe', 'skin-lines', 'team-skin-lines', 'api',
]);

function toUrlSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DdragonSkin {
  num: number;
  name: string;
}

interface OgMeta {
  title: string;
  description: string;
  image: string;
  canonicalPath: string;
}

const DEFAULT_OG_IMAGE = `${SITE_BASE}/og.png`;

function defaultMeta(path: string): OgMeta {
  return {
    title: SITE_NAME,
    description: '3D League of Legends skin viewer.',
    image: DEFAULT_OG_IMAGE,
    canonicalPath: path || '/',
  };
}

async function resolveChampionSkinMeta(path: string): Promise<OgMeta | null> {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  if (RESERVED.has(parts[0].toLowerCase())) return null;

  const championSlug = parts[0];
  const skinSlugPart = parts[1]?.toLowerCase();

  const versionsRes = await fetch(`${DDRAGON}/api/versions.json`);
  if (!versionsRes.ok) return null;
  const versions = (await versionsRes.json()) as string[];
  const version = versions[0];
  if (!version) return null;

  const listRes = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  if (!listRes.ok) return null;
  const listData = (await listRes.json()) as { data: Record<string, { id: string; name: string }> };
  const championEntry = Object.values(listData.data).find(
    (c) => c.id.toLowerCase() === championSlug.toLowerCase(),
  );
  if (!championEntry) return null;

  const detailRes = await fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion/${championEntry.id}.json`);
  if (!detailRes.ok) return null;
  const detailData = (await detailRes.json()) as {
    data: Record<string, { name: string; skins: DdragonSkin[] }>;
  };
  const champion = detailData.data[championEntry.id];
  if (!champion) return null;

  let skinNum = 0;
  let skinLabel = champion.name;

  if (skinSlugPart) {
    const bySlug = champion.skins.find((skin) => {
      const label = skin.name === 'default' ? champion.name : skin.name;
      return toUrlSlug(label) === skinSlugPart;
    });
    const byNum = Number(skinSlugPart);
    const byNumber = !Number.isNaN(byNum)
      ? champion.skins.find((skin) => skin.num === byNum)
      : undefined;
    const match = bySlug ?? byNumber;
    if (match) {
      skinNum = match.num;
      skinLabel = match.name === 'default' ? champion.name : match.name;
    }
  }

  const canonicalPath = skinNum === 0
    ? `/${championEntry.id}`
    : `/${championEntry.id}/${toUrlSlug(skinLabel)}`;

  return {
    title: `${champion.name} — ${skinLabel} | ${SITE_NAME}`,
    description: `View ${champion.name} ${skinLabel} skin in 3D. League of Legends skin viewer.`,
    image: `${DDRAGON}/cdn/img/champion/splash/${artChampionId(championEntry.id)}_${skinNum}.jpg`,
    canonicalPath,
  };
}

function renderHtml(meta: OgMeta, requestUrl: string): string {
  const pageUrl = `${SITE_BASE}${meta.canonicalPath}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = escapeHtml(meta.image);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:secure_url" content="${image}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${image}" />
  <link rel="canonical" href="${escapeHtml(pageUrl)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(requestUrl)}" />
</head>
<body>
  <p><a href="${escapeHtml(requestUrl)}">${title}</a></p>
</body>
</html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  const pathParam = typeof req.query.path === 'string' ? req.query.path : '/';
  const path = pathParam.startsWith('/') ? pathParam : `/${pathParam}`;
  const requestUrl = `${SITE_BASE}${path}`;

  try {
    const meta = (await resolveChampionSkinMeta(path)) ?? defaultMeta(path);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(renderHtml(meta, requestUrl));
  } catch (err) {
    console.error('[og-preview]', err);
    const meta = defaultMeta(path);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderHtml(meta, requestUrl));
  }
}
