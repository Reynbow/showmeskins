/**
 * Builds public/og.png for Discord / Open Graph previews.
 * Uses the site icon, Cinzel title styling, and a hextech lattice backdrop.
 *
 * Text is outlined via fontkit so Sharp/librsvg does not need embedded font support.
 *
 * Usage: npx tsx scripts/generate-og.ts
 */

import * as fontkit from 'fontkit';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'og.png');
const ICON_CANDIDATES = [
  join(ROOT, 'public', 'icon.png'),
  join(ROOT, 'companion', 'assets', 'icon.png'),
];
const FONT = join(__dirname, 'assets', 'Cinzel-wght.ttf');

const W = 1200;
const H = 630;
const HEX_R = 38;
const HEX_SEED = 0x39_72_70_6f; // stable layout

const TITLE_MAIN_SIZE = 58;
const TITLE_X_SIZE = Math.round(TITLE_MAIN_SIZE * 0.8);
const TITLE_LETTER_SPACING = 6 * (TITLE_MAIN_SIZE / 24);
const TITLE_BASELINE_Y = 500;
const TITLE_COLOR = '#f0e6d2';

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

type TitleFont = ReturnType<ReturnType<typeof fontkit.create>['getVariation']>;

function measureText(font: TitleFont, text: string, size: number, letterSpacing: number): number {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let width = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    width += run.positions[i].xAdvance * scale;
    if (i < run.glyphs.length - 1) width += letterSpacing;
  }
  return width;
}

function textToPaths(
  font: TitleFont,
  text: string,
  startX: number,
  baselineY: number,
  size: number,
  letterSpacing: number,
): string {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let cursorX = startX;
  const parts: string[] = [];

  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const pos = run.positions[i];
    if (glyph.id !== 0 && glyph.path) {
      const path = glyph.path.transform(
        scale,
        0,
        0,
        -scale,
        cursorX + pos.xOffset * scale,
        baselineY + pos.yOffset * scale,
      );
      parts.push(`<path d="${path.toSVG()}" fill="${TITLE_COLOR}" />`);
    }
    cursorX += pos.xAdvance * scale;
    if (i < run.glyphs.length - 1) cursorX += letterSpacing;
  }

  return parts.join('\n    ');
}

function buildTitlePaths(font: TitleFont): string {
  const xText = 'x';
  const mainText = '9REPORT.COM';
  const gap = TITLE_LETTER_SPACING * 0.35;
  const xWidth = measureText(font, xText, TITLE_X_SIZE, TITLE_LETTER_SPACING);
  const mainWidth = measureText(font, mainText, TITLE_MAIN_SIZE, TITLE_LETTER_SPACING);
  const totalWidth = xWidth + gap + mainWidth;
  const startX = (W - totalWidth) / 2;

  return [
    textToPaths(font, xText, startX, TITLE_BASELINE_Y, TITLE_X_SIZE, TITLE_LETTER_SPACING),
    textToPaths(font, mainText, startX + xWidth + gap, TITLE_BASELINE_Y, TITLE_MAIN_SIZE, TITLE_LETTER_SPACING),
  ].join('\n    ');
}

function buildSvg(titlePaths: string): string {
  const hexes = hexPolygons();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
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

  <g>
    ${titlePaths}
  </g>
</svg>`;
}

function resolveIconPath(): string {
  for (const candidate of ICON_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No icon found. Checked: ${ICON_CANDIDATES.join(', ')}`);
}

async function main() {
  const font = fontkit.create(readFileSync(FONT)).getVariation({ wght: 600 });
  const svg = buildSvg(buildTitlePaths(font));

  const logoSize = 168;
  const logoLeft = Math.round((W - logoSize) / 2);
  const logoTop = 148;

  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const logo = await sharp(resolveIconPath())
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
