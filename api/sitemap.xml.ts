import type { VercelRequest, VercelResponse } from '@vercel/node';

const SITE_BASE = 'https://x9report.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  try {
    const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');

    const versions: string[] = await versionsRes.json();
    const version = versions[0] || 'latest';

    const champUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`;
    const champsFetch = await fetch(champUrl);
    const champsData = (await champsFetch.json()) as { data: Record<string, { id: string; name: string; key: string }> };
    const champions = Object.values(champsData.data || {});

    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_BASE;

    const urls: string[] = [baseUrl, `${baseUrl}/companion`];
    for (const c of champions) {
      urls.push(`${baseUrl}/${c.id}`);
    }

    const lastmod = new Date().toISOString().slice(0, 10);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(200).send(xml);
  } catch (err) {
    console.error('[sitemap]', err);
    res.setHeader('Content-Type', 'application/xml');
    return res.status(500).send(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
        SITE_BASE +
        '</loc></url></urlset>'
    );
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
