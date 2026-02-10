/**
 * Generates the tray icon PNG from the hexagon SVG used on the website.
 * Runs automatically after `npm install` (via postinstall).
 */
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'assets');

// Gold hexagon icon matching the website's homepage logo
// Dark fill so it's visible on both light and dark taskbars
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 40 40" fill="none">
  <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" fill="#0f0f1a" stroke="#C8AA6E" stroke-width="2.5"/>
  <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="#C8AA6E" stroke-width="1.5" fill="none" opacity="0.5"/>
</svg>`;

async function generate() {
  await mkdir(assetsDir, { recursive: true });

  // Only import sharp when actually needed (it's a devDependency)
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp not available (e.g. production install) – check if icon already exists
    if (existsSync(path.join(assetsDir, 'icon.png'))) {
      console.log('Icon already exists, skipping generation (sharp not available).');
      return;
    }
    console.warn('Warning: sharp is not installed and icon.png does not exist.');
    console.warn('Run "npm install --include=dev" to install sharp, then "npm run build-icon".');
    return;
  }

  // 256×256 – Electron/Windows will scale as needed for the tray
  await sharp(Buffer.from(svg))
    .resize(256, 256)
    .png()
    .toFile(path.join(assetsDir, 'icon.png'));

  console.log('✓ Generated assets/icon.png (256×256)');

  // Also generate a 16×16 version optimised for small tray display
  const svgSmall = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 40 40" fill="none">
    <path d="M20 2L37 11v18L20 38 3 29V11L20 2z" fill="#0f0f1a" stroke="#C8AA6E" stroke-width="4"/>
    <path d="M20 8L31 14v12L20 32 9 26V14L20 8z" stroke="#C8AA6E" stroke-width="2.5" fill="none" opacity="0.6"/>
  </svg>`;

  await sharp(Buffer.from(svgSmall))
    .resize(16, 16)
    .png()
    .toFile(path.join(assetsDir, 'icon-16.png'));

  console.log('✓ Generated assets/icon-16.png (16×16)');
}

generate().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
