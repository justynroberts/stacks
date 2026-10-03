import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractAudio } from '../src/main/unzip';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'unzip-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const REG = (0o100644 << 16) >>> 0;
const LINK = (0o120777 << 16) >>> 0;
const bytes = (s: string) => new TextEncoder().encode(s);
const file = (s: string, attrs = REG): [Uint8Array, { os: number; attrs: number }] => [bytes(s), { os: 3, attrs }];

function makeZip(entries: Record<string, [Uint8Array, { os: number; attrs: number }]>): string {
  const p = path.join(dir, 'pack.zip');
  writeFileSync(p, zipSync(entries));
  return p;
}
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)).map((x) => path.join(e.name, x)) : [e.name]));

describe('extractAudio', () => {
  it('unpacks audio files, keeping folders, and nothing else', async () => {
    const zip = makeZip({
      'Drums/kick.wav': file('kick'),
      'Drums/deep/sub.FLAC': file('sub'),
      'readme.txt': file('hello'),
      'tool.exe': file('MZ'),
      '__MACOSX/Drums/._kick.wav': file('junk'),
      '.hidden/secret.wav': file('x')
    });
    const out = path.join(dir, 'out');
    expect(await extractAudio(zip, out)).toBe(2);
    expect(walk(out).sort()).toEqual([path.join('Drums', 'deep', 'sub.FLAC'), path.join('Drums', 'kick.wav')]);
    expect(readFileSync(path.join(out, 'Drums', 'kick.wav'), 'utf8')).toBe('kick');
  });

  it('never writes a symlink, even one named like audio', async () => {
    const zip = makeZip({ 'evil.wav': file('/etc/passwd', LINK), 'ok.wav': file('ok') });
    const out = path.join(dir, 'out');
    expect(await extractAudio(zip, out)).toBe(1);
    expect(existsSync(path.join(out, 'evil.wav'))).toBe(false);
    expect(lstatSync(path.join(out, 'ok.wav')).isSymbolicLink()).toBe(false);
  });

  it('refuses paths that climb out of the folder', async () => {
    const zip = makeZip({ '../escaped.wav': file('x') });
    const out = path.join(dir, 'out');
    mkdirSync(out);
    await expect(extractAudio(zip, out)).rejects.toThrow();
    expect(existsSync(path.join(dir, 'escaped.wav'))).toBe(false);
  });

  it('does not write through a link that is already on disk', async () => {
    const out = path.join(dir, 'out');
    const target = path.join(dir, 'victim.wav');
    writeFileSync(target, 'original');
    mkdirSync(out);
    (await import('node:fs')).symlinkSync(target, path.join(out, 'a.wav'));
    const zip = makeZip({ 'a.wav': file('overwrite') });
    await extractAudio(zip, out);
    expect(readFileSync(target, 'utf8')).toBe('original');
  });

  it('stops at the size and entry limits', async () => {
    const zip = makeZip({ 'a.wav': file('x'.repeat(100)), 'b.wav': file('x'.repeat(100)) });
    await expect(extractAudio(zip, path.join(dir, 'o1'), { maxBytes: 150, maxEntries: 10 })).rejects.toThrow(/limit/);
    await expect(extractAudio(zip, path.join(dir, 'o2'), { maxBytes: 1e6, maxEntries: 1 })).rejects.toThrow(/too many/);
  });

  it('rejects a file that is not a zip', async () => {
    const p = path.join(dir, 'bad.zip');
    writeFileSync(p, 'definitely not a zip');
    await expect(extractAudio(p, path.join(dir, 'out'))).rejects.toThrow();
  });
});
