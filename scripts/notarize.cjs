// MIT License - Copyright (c) fintonlabs.com
//
// afterSign: notarise and staple the app itself, before electron-builder makes the dmg and zip from it, so the
// copy dragged into /Applications (and the one inside every update zip) carries its own ticket.
//
// No Developer ID (a machine without the certificate) means an ad-hoc local build: skipped, said out loud.
// A notary profile that exists but is refused is a hard failure, never a finished-looking unnotarised build.

const { notarize } = require('@electron/notarize');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const PROFILE = process.env.NOTARYTOOL_PROFILE ?? 'notarytool';

function hasProfile() {
  try {
    execFileSync('xcrun', ['notarytool', 'history', '--keychain-profile', PROFILE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!process.env.CSC_NAME && !context.packager.platformSpecificBuildOptions.identity) {
    console.log('  • skipping notarisation: not signed with a Developer ID (set CSC_NAME, or use npm run release)');
    return;
  }
  if (!hasProfile()) {
    console.log(`  • skipping notarisation: no "${PROFILE}" notarytool profile on this machine`);
    return;
  }
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • notarising ${appPath} (a few minutes)`);
  await notarize({ appPath, keychainProfile: PROFILE });
  console.log('  • app notarised and stapled');
};
