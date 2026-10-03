import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectDrives } from '../src/main/drives';
import { Library, sampleId } from '../src/main/library';
import { scan, type ScannedFile } from '../src/main/scanner';
import { ANALYSIS_VERSION, type Analysis, type Drive } from '@shared/types';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'stacks-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const touch = (rel: string, bytes = 10) => {
  const p = path.join(dir, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
};

describe('scanner', () => {
  it('finds audio, skips hidden files and OS junk', async () => {
    touch('kicks/kick_01.wav');
    touch('kicks/deep/kick_02.FLAC');
    touch('loops/rhodes.mp3');
    touch('notes.txt');
    touch('.hidden/secret.wav');
    touch('kicks/._kick_01.wav');
    touch('$RECYCLE.BIN/old.wav');
    touch('__MACOSX/junk.wav');
    const found: ScannedFile[] = [];
    const total = await scan(dir, (f) => found.push(...f), { batchSize: 2 });
    expect(total).toBe(3);
    expect(found.map((f) => path.basename(f.abs)).sort()).toEqual(['kick_01.wav', 'kick_02.FLAC', 'rhodes.mp3']);
    expect(found.every((f) => f.size === 10)).toBe(true);
  });

  it('reports files in batches and can be cancelled', async () => {
    for (let i = 0; i < 7; i++) touch(`a/${i}.wav`);
    const sizes: number[] = [];
    await scan(dir, (f) => sizes.push(f.length), { batchSize: 3 });
    expect(sizes).toEqual([3, 3, 1]);
    const ac = new AbortController();
    ac.abort();
    expect(await scan(dir, () => undefined, { signal: ac.signal })).toBe(0);
  });
});

const analysis = (bpm: number): Analysis => ({
  version: ANALYSIS_VERSION, bpm, bpmConf: 0.9, key: 'A min', keyShort: 'Am', camelot: '8A', keyConf: 0.8,
  durationSec: 4, kind: 'loop', peaks: new Array(96).fill(50), analysedAt: 1
});

describe('library', () => {
  const resolve = (driveId: string, rel: string) => (driveId === 'sd' ? path.join('/mnt/sd', rel) : null);
  const file = () => path.join(dir, 'library.json');

  it('keeps analysis when a file is unchanged and drops it when it changes', () => {
    const lib = new Library(file(), resolve);
    lib.upsert('sd', [{ relPath: 'a/kick.wav', size: 100, mtimeMs: 5 }]);
    const id = sampleId('sd', 'a/kick.wav');
    lib.setAnalysis(id, analysis(120));
    expect(lib.upsert('sd', [{ relPath: 'a/kick.wav', size: 100, mtimeMs: 5 }])).toHaveLength(0);
    expect(lib.get(id)?.analysis?.bpm).toBe(120);
    const changed = lib.upsert('sd', [{ relPath: 'a/kick.wav', size: 101, mtimeMs: 6 }]);
    expect(changed).toHaveLength(1);
    expect(lib.get(id)?.analysis).toBeUndefined();
  });

  it('survives a restart and resolves paths only for mounted drives', async () => {
    const lib = new Library(file(), resolve);
    lib.upsert('sd', [{ relPath: 'x.wav', size: 1, mtimeMs: 1 }]);
    lib.upsert('gone', [{ relPath: 'y.wav', size: 1, mtimeMs: 1 }]);
    lib.setAnalysis(sampleId('sd', 'x.wav'), analysis(90));
    await lib.flush();
    const again = new Library(file(), resolve);
    await again.load();
    const all = again.all();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.driveId === 'sd')).toMatchObject({ name: 'x.wav', ext: 'wav', path: path.join('/mnt/sd', 'x.wav') });
    expect(all.find((s) => s.driveId === 'sd')?.analysis?.bpm).toBe(90);
    expect(all.find((s) => s.driveId === 'gone')?.path).toBeNull();
  });

  it('moves entries on rename and lists unplugged drives as offline', () => {
    const lib = new Library(file(), resolve);
    lib.upsert('sd', [{ relPath: 'loop.wav', size: 1, mtimeMs: 1 }]);
    const id = sampleId('sd', 'loop.wav');
    lib.setAnalysis(id, analysis(100));
    const moved = lib.move(id, '100_Am_loop.wav', 2);
    expect(moved?.name).toBe('100_Am_loop.wav');
    expect(moved?.analysis?.bpm).toBe(100);
    expect(lib.get(id)).toBeUndefined();

    const d: Drive = { id: 'sd', name: 'MPC', mount: '/mnt/sd', kind: 'sd', totalBytes: 10, usedBytes: 1, mounted: true, excluded: false };
    lib.rememberDrives([d]);
    const list = lib.driveList([]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'sd', mounted: false });
  });
});

describe('library exclusions and versions', () => {
  const resolve = (driveId: string, rel: string) => (driveId === 'sd' ? path.join('/mnt/sd', rel) : null);
  const file = () => path.join(dir, 'library.json');

  it('hides an excluded drive, keeps its analysis, and remembers the choice', async () => {
    const lib = new Library(file(), resolve);
    lib.upsert('sd', [{ relPath: 'a.wav', size: 1, mtimeMs: 1 }]);
    lib.upsert('usb', [{ relPath: 'b.wav', size: 1, mtimeMs: 1 }]);
    lib.setAnalysis(sampleId('sd', 'a.wav'), analysis(100));
    expect(lib.setExcluded('sd', true)).toBe(true);
    expect(lib.setExcluded('sd', true)).toBe(false);
    expect(lib.setExcluded('local', true)).toBe(false);
    expect(lib.all().map((s) => s.driveId)).toEqual(['usb']);
    lib.rememberDrives([{ id: 'sd', name: 'MPC', mount: '/mnt/sd', kind: 'sd', totalBytes: 10, usedBytes: 1, mounted: true, excluded: false }]);
    await lib.flush();

    const again = new Library(file(), resolve);
    await again.load();
    expect(again.isExcluded('sd')).toBe(true);
    expect(again.driveList([])[0]).toMatchObject({ id: 'sd', excluded: true });
    again.setExcluded('sd', false);
    expect(again.all().find((s) => s.driveId === 'sd')?.analysis?.bpm).toBe(100);
  });

  it('drops analyses from an older detector version, on load and on rescan', async () => {
    const lib = new Library(file(), resolve);
    lib.upsert('sd', [{ relPath: 'old.wav', size: 1, mtimeMs: 1 }]);
    lib.setAnalysis(sampleId('sd', 'old.wav'), { ...analysis(150), version: ANALYSIS_VERSION - 1 });
    const changed = lib.upsert('sd', [{ relPath: 'old.wav', size: 1, mtimeMs: 1 }]);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.analysis).toBeUndefined();

    lib.setAnalysis(sampleId('sd', 'old.wav'), { ...analysis(150), version: ANALYSIS_VERSION - 1 });
    await lib.flush();
    const again = new Library(file(), resolve);
    await again.load();
    expect(again.all()[0]?.analysis).toBeUndefined();
  });
});

describe('drives', () => {
  it('detects without throwing on this machine', async () => {
    const drives = await detectDrives();
    expect(Array.isArray(drives)).toBe(true);
    for (const d of drives) {
      expect(d.mount).toBeTruthy();
      expect(d.totalBytes).toBeGreaterThan(0);
      expect(d.usedBytes).toBeLessThanOrEqual(d.totalBytes);
    }
  });
});

void utimesSync;
