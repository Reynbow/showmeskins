/**
 * Builds public/og.png for Discord / Open Graph previews.
 * Uses the site icon, Cinzel title styling, and a hextech lattice backdrop.
 *
 * Usage: npx tsx scripts/generate-og.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'og.png');
const ICON = join(ROOT, 'public', 'icon.png');
const FONT = join(ROOT, 'public', 'cinzel-v23-latin-700.woff2');

const W = 1200;
const H = 630;
const HEX_R = 38;
const HEX_SEED = 0x39_72_70_6f; // stable layout

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexPolygons(): string {
  const rand = seededRandom(HEX_SEED);
  const dx = HEX_R * 1.5;
  const dy = Math.sqrt(3) * HEX_R;
  const parts: string[] = [];

  for (let col = -1; col * dx < W + HEX_R; col++) {
    for (let row = -1; row * dy < H + dy; row++) {
      const cx = col * dx;
      const cy = row * dy + (col % 2 ? dy / 2 : 0);
      const points: string[] = [];
      for (let k = 0; k < 6; k++) {
        const angle = (Math.PI / 3) * k;
        points.push(`${(cx + HEX_R * Math.cos(angle)).toFixed(1)},${(cy + HEX_R * Math.sin(angle)).toFixed(1)}`);
      }
      const opacity = (0.05 + rand() * 0.05).toFixed(3);
      parts.push(
        `<polygon points="${points.join(' ')}" fill="none" stroke="#c8aa6e" stroke-width="1" stroke-opacity="${opacity}" />`,
      );
    }
  }
  return parts.join('\n    ');
}

function buildSvg(fontBase64: string): string {
  const hexes = hexPolygons();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'Cinzel';
        font-weight: 600;
        src: url('data:font/woff2;base64,${fontBase64}') format('woff2');
      }
    </style>
    <radialGradient id="goldGlow" cx="50%" cy="8%" r="65%">
      <stop offset="0%" stop-color="#c8aa6e" stop-opacity="0.14" />
      <stop offset="100%" stop-color="#c8aa6e" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="tealGlow" cx="100%" cy="100%" r="55%">
      <stop offset="0%" stop-color="#0ac8b9" stop-opacity="0.06" />
      <stop offset="100%" stop-color="#0ac8b9" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="hexMask" cx="50%" cy="42%" r="72%">
      <stop offset="28%" stop-color="white" stop-opacity="1" />
      <stop offset="100%" stop-color="white" stop-opacity="0" />
    </radialGradient>
    <mask id="hexFade">
      <rect width="${W}" height="${H}" fill="url(#hexMask)" />
    </mask>
  </defs>

  <rect width="${W}" height="${H}" fill="#010a13" />
  <rect width="${W}" height="${H}" fill="url(#goldGlow)" />
  <rect width="${W}" height="${H}" fill="url(#tealGlow)" />
  <g mask="url(#hexFade)">
    ${hexes}
  </g>

  <text
    x="${W / 2}"
    y="500"
    text-anchor="middle"
    font-family="Cinzel, serif"
    font-weight="600"
    font-size="58"
    fill="#f0e6d2"
    letter-spacing="6"
  ><tspan font-size="46">x</tspan><tspan>9REPORT.COM</tspan></text>
</svg>`;
}

async function main() {
  const fontBase64 = readFileSync(FONT).toString('base64');
  const svg = buildSvg(fontBase64);

  const logoSize = 168;
  const logoLeft = Math.round((W - logoSize) / 2);
  const logoTop = 148;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const logo = await sharp(ICON)
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(base)
    .composite([{ input: logo, left: logoLeft, top: logoTop }])
    .png()
    .toFile(OUT);

  console.log(`Wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
