// MIT License - Copyright (c) fintonlabs.com
//
// afterAllArtifactBuild: the disk image is its own artifact with its own signature and ticket; it does not
// inherit the app's. Order is fixed: sign -> notarise -> staple (signing after stapling destroys the ticket).
// Stapling rewrites the file after electron-builder hashed it, so scripts/fix-update-metadata.mjs re-hashes
// latest-mac.yml afterwards.

const { execFileSync } = require('node:child_process');

const PROFILE = process.env.NOTARYTOOL_PROFILE ?? 'notarytool';

exports.default = async function afterAllArtifactBuild(context) {
  const images = (context.artifactPaths ?? []).filter((p) => p.endsWith('.dmg'));
  const name = process.env.CSC_NAME;
  if (!images.length || !name) return [];
  const identity = name.includes(':') ? name : `Developer ID Application: ${name}`;
  for (const image of images) {
    execFileSync('codesign', ['--force', '--timestamp', '--sign', identity, image], { stdio: 'inherit' });
    console.log(`  • signed ${image}; notarising`);
    const out = execFileSync('xcrun', ['notarytool', 'submit', image, '--keychain-profile', PROFILE, '--wait'], { encoding: 'utf8' });
    process.stdout.write(out);
    if (!/status: Accepted/.test(out)) throw new Error(`Apple did not accept ${image}`);
    execFileSync('xcrun', ['stapler', 'staple', image], { stdio: 'inherit' });
    console.log('  • dmg notarised and stapled');
  }
  return [];
};
