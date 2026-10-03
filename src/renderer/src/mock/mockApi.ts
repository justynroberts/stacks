import { encodeWav, synthLoop } from '@shared/dsp/synth';
import { foldBpm } from '@shared/dsp/bpm';
import { computePeaks } from '@shared/dsp/peaks';
import { keyInfo } from '@shared/camelot';
import { readWav } from '@shared/audio/wav';
import { buildName, editName, splitName } from '@shared/filename';
import { type Analysis, ANALYSIS_VERSION, type Drive, type QueueItem, type Result, type Sample, type StacksApi } from '@shared/types';

const SR = 22050;
const GB = 1e9;

const DRIVES: Drive[] = [
  { id: 'local', name: 'This computer', mount: '', kind: 'internal', totalBytes: 0, usedBytes: 0, mounted: true, excluded: false },
  { id: 'ssd', name: 'SAMPLES_SSD', mount: '/Volumes/SAMPLES_SSD', kind: 'usb-ssd', totalBytes: 931 * GB, usedBytes: 712 * GB, mounted: true, excluded: false },
  { id: 'sd', name: 'MPC_SD_128', mount: '/Volumes/MPC_SD_128', kind: 'sd', totalBytes: 128 * GB, usedBytes: 94 * GB, mounted: true, excluded: false },
  { id: 'hdd', name: 'ARCHIVE_HDD', mount: '/Volumes/ARCHIVE_HDD', kind: 'usb-hdd', totalBytes: 2000 * GB, usedBytes: 1480 * GB, mounted: true, excluded: false }
];

// name, drive, bpm, key pitch class + minor, seconds, kind, analysed
type Seed = [string, string, number | null, [number, boolean] | null, number, 'loop' | 'shot', boolean];
const SEEDS: Seed[] = [
  ['amen_break_chopped_172.wav', 'ssd', 172, [5, true], 3.2, 'loop', true],
  ['rhodes_loop_dusty_Am.wav', 'ssd', 84, [9, true], 11.4, 'loop', true],
  ['808_sub_glide_F.wav', 'ssd', null, [5, false], 2.1, 'shot', true],
  ['vox_chop_ahh_01.wav', 'sd', 96, [1, true], 4, 'loop', true],
  ['bass_reese_loop_140.wav', 'ssd', 140, [7, true], 13.7, 'loop', true],
  ['hat_closed_tight_12.wav', 'sd', null, null, 0.2, 'shot', true],
  ['strings_lofi_pad_Dm.wav', 'hdd', 70, [2, true], 27.4, 'loop', true],
  ['breakbeat_think_cut.wav', 'local', null, null, 6.1, 'loop', false],
  ['snare_crack_lofi_07.wav', 'sd', null, null, 0.4, 'shot', true],
  ['pluck_arp_kalimba_Em.wav', 'hdd', 118, [4, true], 8, 'loop', true],
  ['foley_vinyl_crackle_loop.wav', 'hdd', null, null, 30, 'loop', true],
  ['guitar_nylon_riff_Bm.wav', 'local', null, null, 5.6, 'loop', false],
  ['piano_felt_chords_Eb.wav', 'ssd', 76, [3, false], 16.2, 'loop', true],
  ['perc_shaker_swing_16ths.wav', 'sd', 128, null, 2, 'loop', true]
];

const ID_OF = (name: string, drive: string): string => `${drive}:${name}`;

function demoAudio(name: string, bpm: number | null, key: [number, boolean] | null, seconds: number): Float32Array {
  const chord = key ? (key[1] ? [key[0], key[0] + 3, key[0] + 7] : [key[0], key[0] + 4, key[0] + 7]).map((p) => p % 12) : [];
  return synthLoop({ bpm: bpm ?? 100, seconds: Math.min(seconds, 8), sampleRate: SR, chordPcs: chord, kick: seconds > 0.5 || !!bpm });
}

function analysisFor(s: Seed): Analysis {
  const [name, , bpm, key, sec, kind] = s;
  const info = key ? keyInfo(key[0], key[1]) : null;
  return {
    version: ANALYSIS_VERSION,
    bpm: foldBpm(bpm),
    bpmConf: bpm ? 0.9 : 0,
    key: info?.key ?? null,
    keyShort: info?.keyShort ?? null,
    camelot: info?.camelot ?? null,
    keyConf: info ? 0.85 : 0,
    durationSec: sec,
    kind,
    peaks: computePeaks(demoAudio(name, bpm, key, sec)),
    analysedAt: Date.now()
  };
}

export interface MockOptions {
  /** Add this many extra analysed samples, to check the list stays fast on a big library. */
  stress?: number;
  /** Start with every sample already analysed, so no decoding happens. Used in tests. */
  preanalysed?: boolean;
}

/** In-memory stand-in for the Electron bridge. Lets the UI run in a plain browser or in tests. */
export function createMockApi(opts: MockOptions = {}): StacksApi {
  const drives: Drive[] = DRIVES.map((d) => ({ ...d }));
  const samples = new Map<string, Sample>();
  const audio = new Map<string, Float32Array>();
  for (const seed of SEEDS) {
    const [name, drive, bpm, key, sec] = seed;
    const id = ID_OF(name, drive);
    const { ext } = splitName(name);
    const mount = DRIVES.find((d) => d.id === drive)?.mount ?? '';
    samples.set(id, {
      id, driveId: drive, relPath: name, path: `${mount}/${name}`, name, ext, size: Math.round(sec * 88200), mtimeMs: 1,
      analysis: seed[6] || opts.preanalysed ? analysisFor(seed) : undefined
    });
    audio.set(id, demoAudio(name, bpm, key, sec));
  }

  if (opts.stress) {
    const peaks = analysisFor(SEEDS[1]!).peaks;
    const keys = [[9, true], [0, false], [7, true], [2, true], [4, false]] as const;
    for (let i = 0; i < opts.stress; i++) {
      const drive = ['ssd', 'sd', 'hdd'][i % 3]!;
      const name = `stress_${String(i).padStart(5, '0')}_${['kick', 'loop', 'pad', 'break'][i % 4]}.wav`;
      const k = keys[i % keys.length]!;
      const info = keyInfo(k[0], k[1]);
      const id = ID_OF(name, drive);
      samples.set(id, {
        id, driveId: drive, relPath: name, path: `/Volumes/${drive}/${name}`, name, ext: 'wav', size: 1000, mtimeMs: 1,
        analysis: { version: ANALYSIS_VERSION, bpm: i % 4 === 1 ? 70 + (i % 71) : null, bpmConf: 0.8, key: info.key, keyShort: info.keyShort, camelot: info.camelot, keyConf: 0.8, durationSec: 1 + (i % 20), kind: i % 4 === 0 ? 'shot' : 'loop', peaks, analysedAt: 1 }
      });
    }
  }

  const subs = { samples: new Set<(u: Sample[], r: string[]) => void>(), queue: new Set<(q: QueueItem[]) => void>(), drives: new Set<(d: Drive[]) => void>() };
  const fire = (u: Sample[], r: string[]) => subs.samples.forEach((cb) => cb(u, r));
  const sub = <T,>(set: Set<T>, cb: T) => { set.add(cb); return () => { set.delete(cb); }; };
  let n = 0;
  const isExcluded = (driveId: string) => drives.find((d) => d.id === driveId)?.excluded ?? false;

  const api: StacksApi = {
    platform: 'web',
    listDrives: async () => drives.map((d) => ({ ...d })),
    onDrives: (cb) => sub(subs.drives, cb),
    listSamples: async () => [...samples.values()].filter((s) => !isExcluded(s.driveId)),
    onSamples: (cb) => sub(subs.samples, cb),
    scanDrive: async () => undefined,
    setDriveExcluded: async (driveId, excluded) => {
      const d = drives.find((x) => x.id === driveId);
      if (!d || d.id === 'local' || d.excluded === excluded) return;
      d.excluded = excluded;
      const mine = [...samples.values()].filter((s) => s.driveId === driveId);
      if (excluded) fire([], mine.map((s) => s.id));
      else fire(mine, []);
      const snapshot = drives.map((x) => ({ ...x }));
      subs.drives.forEach((cb) => cb(snapshot));
    },
    addPaths: async (paths) => {
      const added: Sample[] = [];
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() ?? p;
        const id = `local:${name}:${++n}`;
        const bpm = 90 + (n * 17) % 60;
        const s: Sample = { id, driveId: 'local', relPath: name, path: p, name, ext: splitName(name).ext, size: 400000, mtimeMs: Date.now() };
        samples.set(id, s);
        audio.set(id, demoAudio(name, bpm, [(n * 5) % 12, n % 2 === 0], 6));
        added.push(s);
      }
      fire(added, []);
    },
    importUrl: async (url) => {
      try { new URL(url); } catch { return { ok: false, error: 'That does not look like a link' }; }
      const id = `q${++n}`;
      const item: QueueItem = { id, label: url.split('/').pop() || url, stage: 'downloading', progress: 0 };
      const push = () => subs.queue.forEach((cb) => cb([{ ...item }]));
      push();
      for (let i = 1; i <= 10; i++) { await new Promise((r) => setTimeout(r, 120)); item.progress = i / 10; push(); }
      item.stage = 'done'; push();
      await api.addPaths([item.label.endsWith('.wav') ? item.label : `${item.label}.wav`]);
      setTimeout(() => subs.queue.forEach((cb) => cb([])), 3000);
      return { ok: true, value: true };
    },
    onQueue: (cb) => sub(subs.queue, cb),
    readFile: async (id) => {
      const x = audio.get(id);
      if (!x) throw new Error('missing');
      return encodeWav(x, SR);
    },
    saveAnalysis: async (id, a) => {
      const s = samples.get(id);
      if (s) samples.set(id, { ...s, analysis: a });
    },
    renameWithMeta: async (id): Promise<Result<Sample>> => {
      const s = samples.get(id);
      if (!s?.analysis) return { ok: false, error: 'Not analysed yet' };
      const next = buildName(s.name, s.analysis.bpm, s.analysis.keyShort);
      if (!next) return { ok: false, error: 'No key or BPM to write' };
      const moved: Sample = { ...s, id: `${s.driveId}:${next}`, name: next, relPath: next, path: s.path ? s.path.replace(s.name, next) : null };
      samples.delete(id);
      samples.set(moved.id, moved);
      audio.set(moved.id, audio.get(id)!);
      fire([moved], [id]);
      return { ok: true, value: moved };
    },
    copyToDrive: async (id, driveId): Promise<Result<Sample>> => {
      const s = samples.get(id);
      const d = drives.find((x) => x.id === driveId);
      if (!s || !d) return { ok: false, error: 'Drive is not connected' };
      const copy: Sample = { ...s, id: ID_OF(`Stacks/${s.name}`, driveId), driveId, relPath: `Stacks/${s.name}`, path: `${d.mount}/Stacks/${s.name}` };
      samples.set(copy.id, copy);
      audio.set(copy.id, audio.get(id)!);
      fire([copy], []);
      return { ok: true, value: copy };
    },
    writeEdit: async (id, wav, target): Promise<Result<Sample>> => {
      const s = samples.get(id);
      const pcm = readWav(wav);
      if (!s || !pcm) return { ok: false, error: 'The edit did not produce a valid WAV file' };
      const mono = pcm.channels[0]!;
      const fresh = target.kind === 'new';
      const drive = fresh && target.driveId !== null ? drives.find((d) => d.id === target.driveId) : undefined;
      if (fresh && target.driveId !== null && !drive) return { ok: false, error: 'That drive is not connected' };
      const name = fresh ? editName(s.name, s.analysis?.bpm ?? null, s.analysis?.keyShort ?? null, target.label) : `${splitName(s.name).base}.wav`;
      const driveId = drive?.id ?? s.driveId;
      const relPath = drive ? `Stacks/${name}` : s.relPath.replace(/[^/]*$/, name);
      const where = drive ? `${drive.mount}/Stacks/${name}` : s.path ? s.path.replace(/[^/]*$/, name) : null;
      const next: Sample = { ...s, id: fresh ? ID_OF(relPath, driveId) : s.id, driveId, name, ext: 'wav', relPath, path: where, size: wav.byteLength, mtimeMs: Date.now(), analysis: undefined };
      samples.set(next.id, next);
      audio.set(next.id, mono);
      fire([next], []);
      return { ok: true, value: next };
    },
    reveal: () => undefined,
    startDrag: () => undefined,
    pathForFile: (f) => f.name,
    checkForUpdates: async () => 'Demo mode: updates only apply to an installed copy.'
  };
  return api;
}
