import { rewrite } from '@vercel/functions';

/** Crawlers that read Open Graph tags from raw HTML (no JS). */
const BOT_UA =
  /discordbot|facebookexternalhit|twitterbot|slackbot|telegrambot|whatsapp|linkedinbot|embedly|vkshare|redditbot|applebot|bingbot|googlebot/i;

const RESERVED = new Set([
  'companion', 'history', 'dev', 'regions', 'aram-wardrobe', 'skin-lines', 'team-skin-lines', 'api',
]);

function isChampionSkinPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return false;
  return !RESERVED.has(parts[0].toLowerCase());
}

function needsOgPreview(pathname: string): boolean {
  if (pathname === '/') return true;
  return isChampionSkinPath(pathname);
}

export default function middleware(request: Request) {
  const ua = request.headers.get('user-agent') ?? '';
  if (!BOT_UA.test(ua)) return;

  const url = new URL(request.url);
  if (!needsOgPreview(url.pathname)) return;

  const preview = new URL('/api/og-preview', url.origin);
  preview.searchParams.set('path', url.pathname);
  return rewrite(preview);
}

export const config = {
  matcher: [
    '/((?!api/|model-cdn/|map-tiles/|cdragon/|assets/|.*\\..*).*)',
  ],
};
