/**
 * electron-builder afterPack hook.
 * Patches the packaged exe's version info so Windows Firewall (and other
 * dialogs) show "Show Me Skins Companion" instead of "Electron".
 */

const path = require('path');
const { rcedit } = require('rcedit');

exports.default = async function afterPack(context) {
  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );

  console.log(`[patch-exe] Updating version info: ${exePath}`);

  await rcedit(exePath, {
    'version-string': {
      FileDescription: 'Show Me Skins Companion',
      ProductName: 'Show Me Skins Companion',
      InternalName: 'Show Me Skins Companion',
      OriginalFilename: 'Show Me Skins Companion.exe',
      CompanyName: 'Show Me Skins',
    },
    'product-version': '1.0.0',
  });

  console.log('[patch-exe] Done');
};
