import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildRegionCatalog } from './lib/region-catalog';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const catalog = await buildRegionCatalog();
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=43200');
    return res.status(200).json(catalog);
  } catch (err) {
    console.error('[regions]', err);
    return res.status(500).json({ error: 'Failed to build region catalog' });
  }
}
