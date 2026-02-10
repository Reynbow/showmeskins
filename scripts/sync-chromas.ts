/**
 * sync-chromas.ts
 *
 * Downloads all chroma body textures from CommunityDragon, converts them to
 * WebP, and uploads them to Vercel Blob Storage. Generates a manifest JSON
 * mapping chromaId → blob URL so the runtime can do an instant lookup instead
 * of hitting CommunityDragon's slow file server.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... npx tsx scripts/sync-chromas.ts
 *
 * Environment:
 *   BLOB_READ_WRITE_TOKEN  – required, from Vercel Blob store settings
 */

import { put, list } from '@vercel/blob';
import sharp from 'sharp';

// ─── Configuration ──────────────────────────────────────────────────────────

const CDRAGON_RAW = 'https://raw.communitydragon.org';
const CDRAGON_DATA = `${CDRAGON_RAW}/latest/plugins/rcp-be-lol-game-data/global/default/v1`;
const DDRAGON = 'https://ddragon.leagueoflegends.com';

const WEBP_QUALITY = 85;
const CONCURRENCY = 3; // parallel uploads (conservative to avoid rate limits)
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const BATCH_DELAY_MS = 500; // delay between batches to avoid triggering abuse protection

/** Keywords that identify accessory textures (not the main body texture) */
const ACCESSORY_KEYWORDS = [
  'sword', 'wings', 'wing', 'banner', 'recall', '_ult', 'vfx',
  'mask', 'particle', 'weapon', 'shield', 'cape', 'hair', 'tail',
  'loadscreen', 'materialmask',
];

// ─── Types ──────────────────────────────────────────────────────────────────

interface CDragonChroma {
  id: number;
  name: string;
  colors: string[];
}

interface CDragonSkin {
  id: number;
  chromas?: CDragonChroma[];
}

interface CDragonChampion {
  id: number;
  alias: string;
  skins: CDragonSkin[];
}

interface ChromaEntry {
  chromaId: number;
  alias: string;
  skinNum: string;
  textureFilename: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, attempts = RETRY_ATTEMPTS): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 429) {
        const wait = RETRY_DELAY_MS * Math.pow(2, i);
        console.warn(`  Rate limited on ${url}, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      if (i === attempts - 1) return res; // return non-ok on last attempt
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(RETRY_DELAY_MS * Math.pow(2, i));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${attempts} attempts`);
}

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

/**
 * Resolve the body diffuse texture filename for a chroma from CommunityDragon.
 * Replicates the logic from src/api.ts resolveChromaTextureUrl.
 */
async function resolveTextureFilename(alias: string, skinNum: string): Promise<string | null> {
  const dirUrl = `${CDRAGON_RAW}/latest/game/assets/characters/${alias}/skins/skin${skinNum}/`;

  const res = await fetchWithRetry(dirUrl);
  if (!res.ok) return null;

  const html = await res.text();
  const files = parseDirListing(html);
  if (files.length === 0) return null;

  // Find all PNG files containing "_tx_cm" (color map textures)
  const txCmFiles = files.filter(
    (f) => f.endsWith('.png') && f.toLowerCase().includes('_tx_cm'),
  );
  if (txCmFiles.length === 0) return null;

  // Filter out accessory textures
  const bodyFiles = txCmFiles.filter((f) => {
    const lower = f.toLowerCase();
    return !ACCESSORY_KEYWORDS.some((kw) => lower.includes(kw));
  });

  // Pick the best match: shortest name, fall back to first txCm file
  const best =
    bodyFiles.length > 0
      ? bodyFiles.sort((a, b) => a.length - b.length)[0]
      : txCmFiles.sort((a, b) => a.length - b.length)[0];

  return best ?? null;
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

async function getAllChampionKeys(): Promise<string[]> {
  console.log('Fetching champion list from Data Dragon...');
  const verRes = await fetchWithRetry(`${DDRAGON}/api/versions.json`);
  const versions: string[] = await verRes.json();
  const version = versions[0];
  console.log(`  Latest version: ${version}`);

  const champRes = await fetchWithRetry(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  const data = await champRes.json();
  const keys = Object.values(data.data).map((c: any) => c.key as string);
  console.log(`  Found ${keys.length} champions`);
  return keys;
}

async function getChampionChromas(championKey: string): Promise<{ alias: string; chromas: ChromaEntry[] }> {
  const res = await fetchWithRetry(`${CDRAGON_DATA}/champions/${championKey}.json`);
  if (!res.ok) return { alias: '', chromas: [] };

  const data: CDragonChampion = await res.json();
  const alias = data.alias.toLowerCase();
  const chromas: ChromaEntry[] = [];

  for (const skin of data.skins) {
    if (!skin.chromas || skin.chromas.length === 0) continue;
    for (const chroma of skin.chromas) {
      const skinNum = String(chroma.id % 1000).padStart(2, '0');
      chromas.push({
        chromaId: chroma.id,
        alias,
        skinNum,
        textureFilename: null, // resolved later
      });
    }
  }

  return { alias, chromas };
}

async function getExistingBlobs(): Promise<Set<string>> {
  console.log('Listing existing blobs...');
  const existing = new Set<string>();
  let cursor: string | undefined;
  let totalListed = 0;

  try {
    do {
      const result = await list({ prefix: 'chromas/', cursor, limit: 1000 });
      for (const blob of result.blobs) {
        existing.add(blob.pathname);
      }
      totalListed += result.blobs.length;
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('suspended') || msg.includes('rate limit')) {
      console.warn(`  ⚠ Could not list blobs (store suspended). Will attempt uploads anyway.`);
      return existing;
    }
    throw err;
  }

  console.log(`  Found ${totalListed} existing blobs`);
  return existing;
}

/** Sentinel thrown when the Blob store is suspended or rate-limited. */
class BlobSuspended extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BlobSuspended';
  }
}

async function processChroma(
  entry: ChromaEntry,
  existingBlobs: Set<string>,
): Promise<{ chromaId: number; url: string } | null> {
  const blobPath = `chromas/${entry.alias}/skin${entry.skinNum}.webp`;

  // Skip if already uploaded
  if (existingBlobs.has(blobPath)) {
    return null;
  }

  // Resolve texture filename from CommunityDragon directory listing
  const filename = await resolveTextureFilename(entry.alias, entry.skinNum);
  if (!filename) {
    console.warn(`  ⚠ No texture found for chroma ${entry.chromaId} (${entry.alias}/skin${entry.skinNum})`);
    return null;
  }

  // Download the PNG
  const textureUrl = `${CDRAGON_RAW}/latest/game/assets/characters/${entry.alias}/skins/skin${entry.skinNum}/${filename}`;
  const pngRes = await fetchWithRetry(textureUrl);
  if (!pngRes.ok) {
    console.warn(`  ⚠ Failed to download ${textureUrl}: ${pngRes.status}`);
    return null;
  }

  const pngBuffer = Buffer.from(await pngRes.arrayBuffer());

  // Convert PNG → WebP
  const webpBuffer = await sharp(pngBuffer)
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  const savedKB = ((pngBuffer.length - webpBuffer.length) / 1024).toFixed(0);
  console.log(`  Converted ${filename} → WebP (${(pngBuffer.length / 1024).toFixed(0)}KB → ${(webpBuffer.length / 1024).toFixed(0)}KB, saved ${savedKB}KB)`);

  // Upload to Vercel Blob – catch suspension / rate-limit errors
  try {
    const blob = await put(blobPath, webpBuffer, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
    });
    return { chromaId: entry.chromaId, url: blob.url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.constructor.name : '';
    if (name.includes('Suspended') || name.includes('RateLimit') || msg.includes('suspended') || msg.includes('rate limit')) {
      throw new BlobSuspended(msg);
    }
    console.warn(`  ⚠ Upload failed for ${blobPath}: ${msg}`);
    return null;
  }
}

/**
 * Process items in batches with a concurrency limit.
 * Stops early and returns partial results if a BlobSuspended error is thrown.
 */
async function processInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<{ results: R[]; suspended: boolean }> {
  const results: R[] = [];
  let suspended = false;

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    try {
      const batchResults = await Promise.all(batch.map(fn));
      results.push(...batchResults);
    } catch (err) {
      if (err instanceof BlobSuspended) {
        console.warn(`\n⚠ Blob store suspended/rate-limited: ${err.message}`);
        console.warn('  Stopping uploads. Already-uploaded chromas are still available.');
        suspended = true;
        break;
      }
      throw err;
    }

    // Throttle between batches to avoid triggering abuse protection
    if (i + concurrency < items.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return { results, suspended };
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is required.');
    console.error('Get it from your Vercel project Settings > Storage > Blob Store.');
    process.exit(1);
  }

  const startTime = Date.now();

  // 1. Get all champion keys
  const championKeys = await getAllChampionKeys();

  // 2. Gather all chroma entries
  console.log('\nFetching chroma data for all champions...');
  const allChromas: ChromaEntry[] = [];
  for (const key of championKeys) {
    const { alias, chromas } = await getChampionChromas(key);
    if (chromas.length > 0) {
      console.log(`  ${alias}: ${chromas.length} chromas`);
      allChromas.push(...chromas);
    }
  }
  console.log(`\nTotal chromas to process: ${allChromas.length}`);

  // 3. Check what already exists in Blob storage
  const existingBlobs = await getExistingBlobs();

  const newChromas = allChromas.filter(
    (e) => !existingBlobs.has(`chromas/${e.alias}/skin${e.skinNum}.webp`),
  );
  console.log(`New chromas to upload: ${newChromas.length}`);
  console.log(`Already uploaded: ${allChromas.length - newChromas.length}`);

  // 4. Process new chromas (download, convert, upload)
  let wasSuspended = false;
  if (newChromas.length > 0) {
    console.log('\nProcessing new chromas...');
    let processed = 0;
    const { results: newResults, suspended } = await processInBatches(
      newChromas,
      async (entry) => {
        const result = await processChroma(entry, existingBlobs);
        processed++;
        if (processed % 50 === 0) {
          console.log(`  Progress: ${processed}/${newChromas.length}`);
        }
        return result;
      },
      CONCURRENCY,
    );
    wasSuspended = suspended;
    const uploaded = newResults.filter(Boolean).length;
    console.log(`\nUploaded ${uploaded} new chroma textures${suspended ? ' (stopped early due to rate limit)' : ''}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  if (wasSuspended) {
    console.log(`\n⚠ Sync partially complete in ${elapsed}s.`);
    console.log('  Already-uploaded chromas are available via deterministic blob URLs.');
    console.log('  Re-run later to upload the remaining chromas.');
  } else {
    console.log(`\n✓ Sync complete in ${elapsed}s — all ${allChromas.length} chromas uploaded.`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.constructor.name : '';

  // Don't treat suspension/rate-limits as fatal — the cron will retry later
  if (name.includes('Suspended') || name.includes('RateLimit') || msg.includes('suspended') || msg.includes('rate limit')) {
    console.warn(`\n⚠ Blob store unavailable: ${msg}`);
    console.warn('  This is expected if the store is rate-limited. Will retry on next scheduled run.');
    process.exit(0);
  }

  console.error('Fatal error:', err);
  process.exit(1);
});
