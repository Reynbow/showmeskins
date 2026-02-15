/**
 * sync-art.ts
 *
 * Mirrors champion splash/loading preview art into Vercel Blob Storage.
 * Source: Data Dragon (primary) with CommunityDragon fallback.
 *
 * Output paths:
 *   art/splash/{ChampionId}_{skinNum}.webp
 *   art/loading/{ChampionId}_{skinNum}.webp
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... npx tsx scripts/sync-art.ts
 */

import { list, put } from '@vercel/blob';
import sharp from 'sharp';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CDRAGON = 'https://cdn.communitydragon.org/latest/champion';

const CONCURRENCY = 4;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const BATCH_DELAY_MS = 500;
const WEBP_QUALITY = 84;

interface ChampSkin {
  id: string;
  key: string;
  skinNum: number;
}

interface ChampionJsonSkin {
  num: number;
}

interface ChampionJsonEntry {
  id: string;
  key: string;
}

interface ArtEntry {
  championId: string;
  championKey: string;
  skinNum: number;
  kind: 'splash' | 'loading';
}

class BlobSuspended extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BlobSuspended';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, attempts = RETRY_ATTEMPTS): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        await sleep(RETRY_DELAY_MS * Math.pow(2, i));
        continue;
      }
      if (i === attempts - 1) return res;
    } catch {
      if (i === attempts - 1) throw new Error(`Failed to fetch ${url}`);
      await sleep(RETRY_DELAY_MS * Math.pow(2, i));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function getLatestVersion(): Promise<string> {
  const res = await fetchWithRetry(`${DDRAGON}/api/versions.json`);
  const versions = await res.json() as string[];
  return versions[0];
}

async function getChampionSkins(version: string): Promise<ChampSkin[]> {
  const res = await fetchWithRetry(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`);
  const data = await res.json() as { data: Record<string, ChampionJsonEntry> };
  const champs = Object.values(data.data);
  const out: ChampSkin[] = [];

  for (const champ of champs) {
    const detailRes = await fetchWithRetry(`${DDRAGON}/cdn/${version}/data/en_US/champion/${champ.id}.json`);
    if (!detailRes.ok) {
      console.warn(`  ⚠ Failed champion detail for ${champ.id}: ${detailRes.status}`);
      continue;
    }
    const detail = await detailRes.json() as { data: Record<string, { skins: ChampionJsonSkin[] }> };
    const skins = detail.data?.[champ.id]?.skins ?? [];

    for (const skin of skins) {
      out.push({
        id: champ.id,
        key: champ.key,
        skinNum: skin.num,
      });
    }
  }
  return out;
}

async function getExistingBlobPaths(): Promise<Set<string>> {
  const paths = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: 'art/', cursor, limit: 1000 });
    for (const blob of result.blobs) paths.add(blob.pathname);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return paths;
}

function ddragonUrl(entry: ArtEntry): string {
  return `${DDRAGON}/cdn/img/champion/${entry.kind}/${entry.championId}_${entry.skinNum}.jpg`;
}

function cdragonUrl(entry: ArtEntry): string {
  if (entry.kind === 'splash') {
    return `${CDRAGON}/${entry.championKey}/splash-art/skin/${entry.skinNum}`;
  }
  return `${CDRAGON}/${entry.championKey}/tile/skin/${entry.skinNum}`;
}

async function fetchArtBuffer(entry: ArtEntry): Promise<Buffer | null> {
  const primary = await fetchWithRetry(ddragonUrl(entry));
  if (primary.ok) {
    return Buffer.from(await primary.arrayBuffer());
  }
  const fallback = await fetchWithRetry(cdragonUrl(entry));
  if (!fallback.ok) return null;
  return Buffer.from(await fallback.arrayBuffer());
}

async function uploadArt(entry: ArtEntry, existing: Set<string>): Promise<boolean> {
  const blobPath = `art/${entry.kind}/${entry.championId}_${entry.skinNum}.webp`;
  if (existing.has(blobPath)) return false;

  const src = await fetchArtBuffer(entry);
  if (!src) {
    console.warn(`  ⚠ Missing ${entry.kind} art for ${entry.championId}_${entry.skinNum}`);
    return false;
  }

  const webp = await sharp(src).webp({ quality: WEBP_QUALITY }).toBuffer();

  try {
    await put(blobPath, webp, {
      access: 'public',
      contentType: 'image/webp',
      addRandomSuffix: false,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof Error ? err.constructor.name : '';
    if (name.includes('Suspended') || name.includes('RateLimit') || msg.includes('suspended') || msg.includes('rate limit')) {
      throw new BlobSuspended(msg);
    }
    console.warn(`  ⚠ Upload failed for ${blobPath}: ${msg}`);
    return false;
  }
}

async function processInBatches(
  items: ArtEntry[],
  existing: Set<string>,
): Promise<{ uploaded: number; suspended: boolean }> {
  let uploaded = 0;
  let suspended = false;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    try {
      const results = await Promise.all(batch.map((item) => uploadArt(item, existing)));
      uploaded += results.filter(Boolean).length;
    } catch (err) {
      if (err instanceof BlobSuspended) {
        suspended = true;
        console.warn(`\n⚠ Blob store rate-limited/suspended: ${err.message}`);
        break;
      }
      throw err;
    }

    if (i + CONCURRENCY < items.length) await sleep(BATCH_DELAY_MS);
    if ((i / CONCURRENCY) % 50 === 0) {
      console.log(`  Progress: ${Math.min(i + CONCURRENCY, items.length)}/${items.length}`);
    }
  }

  return { uploaded, suspended };
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Error: BLOB_READ_WRITE_TOKEN is required.');
    process.exit(1);
  }

  const started = Date.now();
  console.log('Fetching champion/skin list...');
  const version = await getLatestVersion();
  console.log(`  Data Dragon version: ${version}`);

  const skins = await getChampionSkins(version);
  console.log(`  Champion skin entries: ${skins.length}`);

  const entries: ArtEntry[] = [];
  for (const skin of skins) {
    entries.push({
      championId: skin.id,
      championKey: skin.key,
      skinNum: skin.skinNum,
      kind: 'splash',
    });
    entries.push({
      championId: skin.id,
      championKey: skin.key,
      skinNum: skin.skinNum,
      kind: 'loading',
    });
  }

  console.log(`  Total art assets: ${entries.length}`);
  console.log('Listing existing art blobs...');
  const existing = await getExistingBlobPaths();
  console.log(`  Existing art blobs: ${existing.size}`);

  const pending = entries.filter((entry) => !existing.has(`art/${entry.kind}/${entry.championId}_${entry.skinNum}.webp`));
  console.log(`  New assets to upload: ${pending.length}`);
  if (pending.length === 0) {
    console.log('✓ No new art assets to upload.');
    return;
  }

  console.log('\nUploading new art assets...');
  const { uploaded, suspended } = await processInBatches(pending, existing);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (suspended) {
    console.log(`\n⚠ Partial sync in ${elapsed}s. Uploaded ${uploaded} assets before rate limiting.`);
    console.log('  Re-run later to continue.');
    return;
  }

  console.log(`\n✓ Sync complete in ${elapsed}s. Uploaded ${uploaded} new assets.`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.constructor.name : '';
  if (name.includes('Suspended') || name.includes('RateLimit') || msg.includes('suspended') || msg.includes('rate limit')) {
    console.warn(`⚠ Blob store unavailable: ${msg}`);
    process.exit(0);
  }
  console.error('Fatal error:', err);
  process.exit(1);
});
