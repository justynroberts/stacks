// MIT License - Copyright (c) fintonlabs.com
//
// The only thing in this repository that ships anything. Installed copies update themselves from the latest
// GitHub release of this repository, so a release reaches everyone; ordinary commits and `npm run dist` reach
// no one.
//
//   npm run release -- 0.2.0 --dry-run   # build, sign, notarise and verify; publish nothing, leave the tree clean
//   npm run release -- 0.2.0             # the real thing
//
// It refuses rather than guesses: a dirty tree, a version that exists, no Developer ID, a notary profile that does
// not answer, a failing check, a manifest that disagrees with its files, or anything Gatekeeper will not accept as a
// notarised Developer ID build all stop it before anything becomes visible. Release notes come from
// release-notes/<version>.md when it exists.

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE_BRANCH = 'master';
const RELEASES_REPO = 'justynroberts/stacks';
const APP = 'Stacks';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const die = (message, detail) => {
  console.error(`\n${red('✗')} ${message}`);
  if (detail) console.error(dim(`  ${detail}`));
  process.exit(1);
};
const step = (m) => console.log(`\n${green('▸')} ${m}`);
const sh = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const capture = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const quiet = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || 'failed'; } };

if (!version) die('a version is required', 'npm run release -- 0.2.0   (add --dry-run to rehearse)');

// ---- refuse first, build second ----------------------------------------------------------------------------

step('Checking the tree is clean');
if (capture('git status --porcelain') !== '') die('the working tree has uncommitted changes', 'a release must be a commit, or nobody can tell what shipped');
const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== SOURCE_BRANCH) die(`on ${branch}, not ${SOURCE_BRANCH}`);

step('Checking the version is new');
sh('git fetch --tags --quiet origin');
if (capture('git tag --list').split('\n').includes(`v${version}`)) die(`v${version} is already tagged here`);
if (quiet(`gh release view v${version} -R ${RELEASES_REPO} --json tagName`).includes(`"tagName":"v${version}"`)) {
  die(`v${version} is already released in ${RELEASES_REPO}`);
}

step('Finding the Developer ID');
const idLine = capture('security find-identity -v -p codesigning').split('\n').find((l) => l.includes('"Developer ID Application:'));
if (!idLine) die('no "Developer ID Application" certificate in the keychain');
const identity = /"Developer ID Application: (.+)"/.exec(idLine)[1];
console.log(`  ${identity}`);

step('Checking Apple will notarise (before spending a build on it)');
const history = quiet('xcrun notarytool history --keychain-profile notarytool');
if (!history.includes('Successfully received submission history')) {
  die('the notarytool profile did not answer', history.includes('403') ? 'HTTP 403: accept the new agreement at developer.apple.com (Account Holder)' : history.split('\n')[0]);
}

step('Type checking and testing');
sh('npm run typecheck');
sh('npm test');

// ---- build ---------------------------------------------------------------------------------------------------

step(`Setting the version to ${version}`);
const restore = () => { try { execSync('git checkout -- package.json package-lock.json', { stdio: 'ignore' }); } catch { /* nothing to restore */ } };
if (dryRun) process.on('exit', restore);
sh(`npm version ${version} --no-git-tag-version --allow-same-version`);

step('Building, signing, notarising and stapling (universal)');
rmSync('release', { recursive: true, force: true });
sh('npm run build');
// electron-builder wants the bare name; scripts/staple-dmg.cjs adds the prefix back for codesign.
sh('npx electron-builder --mac --publish never', { CSC_NAME: identity });
sh('node scripts/fix-update-metadata.mjs release/latest-mac.yml');

// ---- verify the artifacts, not the intention -------------------------------------------------------------------

step('Verifying');
const dmg = join('release', `${APP}-${version}-universal.dmg`);
const zip = join('release', `${APP}-${version}-universal.zip`);
const manifest = join('release', 'latest-mac.yml');
const blockmap = `${zip}.blockmap`;
for (const f of [dmg, zip, manifest]) if (!existsSync(f)) die(`${f} was not produced`, readdirSync('release').join(', '));

const yml = readFileSync(manifest, 'utf8');
if (!yml.includes(`version: ${version}`)) die('latest-mac.yml names the wrong version');
for (const f of [dmg, zip]) {
  const data = readFileSync(f);
  const sha = createHash('sha512').update(data).digest('base64');
  if (!yml.includes(sha) || !yml.includes(String(data.byteLength))) die(`${f} does not match latest-mac.yml`, 'every update would download and be thrown away');
}
console.log('  update manifest matches the dmg and the zip');

const appPath = join('release', 'mac-universal', `${APP}.app`);
const archs = capture(`lipo -archs "${join(appPath, 'Contents/MacOS', APP)}"`);
if (!archs.includes('x86_64') || !archs.includes('arm64')) die(`not universal: ${archs}`);
console.log(`  universal: ${archs}`);

const work = mkdtempSync(join(tmpdir(), 'stacks-release-'));
try {
  // Quarantine a copy the way a browser download is quarantined, then ask Gatekeeper.
  const dl = join(work, 'download.dmg');
  cpSync(dmg, dl);
  execFileSync('xattr', ['-w', 'com.apple.quarantine', '0083;00000000;Safari;', dl]);
  execFileSync('xcrun', ['stapler', 'validate', dl], { stdio: 'ignore' });
  const img = quiet(`spctl -a -vvv -t open --context context:primary-signature "${dl}" 2>&1`);
  if (!img.includes('source=Notarized Developer ID')) die('Gatekeeper does not accept the disk image', img);
  console.log('  disk image: stapled, accepted as Notarized Developer ID');

  const mnt = capture(`hdiutil attach -nobrowse -readonly "${dl}"`).split('\n').map((l) => l.split('\t').pop().trim()).find((p) => p.startsWith('/Volumes/'));
  try {
    const inside = join(mnt, `${APP}.app`);
    const exec = quiet(`spctl -a -vvv -t exec "${inside}" 2>&1`);
    if (!exec.includes('source=Notarized Developer ID')) die('Gatekeeper does not accept the app inside the image', exec);
    execFileSync('xcrun', ['stapler', 'validate', inside], { stdio: 'ignore' });
    console.log('  app inside: stapled, accepted as Notarized Developer ID');

    // Launch a copy, not the build itself (a launched bundle picks up provenance and stops stapling cleanly),
    // and require it to stay up.
    const copy = join(work, `${APP}.app`);
    execFileSync('ditto', [inside, copy]);
    const child = execFileSync('bash', ['-c', `"${copy}/Contents/MacOS/${APP}" >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim();
    execSync('sleep 8');
    const alive = quiet(`kill -0 ${child} && echo alive`) === 'alive';
    quiet(`kill ${child}`);
    if (!alive) die('a copy of the built app did not stay running');
    console.log('  a copy of the app launches and stays up');
  } finally {
    quiet(`hdiutil detach "${mnt}"`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (dryRun) {
  console.log(`\n${green('✓')} ${version} is built, notarised and verified in release/. Nothing was committed, tagged or published.\n`);
  process.exit(0);
}

// ---- only now does any of it become visible ----------------------------------------------------------------------

step('Committing, tagging and publishing');
sh(`git add package.json package-lock.json && (git diff --cached --quiet || git commit -m "Release ${version}")`);
sh(`git push origin ${SOURCE_BRANCH}`);
sh(`git tag -a v${version} -m "${APP} ${version}"`);
sh(`git push origin v${version}`);

const notes = join('release-notes', `${version}.md`);
const files = [dmg, zip, manifest, ...(existsSync(blockmap) ? [blockmap] : [])].map((f) => `"${f}"`).join(' ');
sh(`gh release create v${version} ${files} -R ${RELEASES_REPO} --title "${APP} ${version}" ${existsSync(notes) ? `--notes-file "${notes}"` : `--notes "${APP} ${version}"`}`);

console.log(`\n${green('✓')} ${APP} ${version} published to ${RELEASES_REPO}. Installed copies will offer it within a couple of hours.\n`);
