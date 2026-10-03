import { fft, hann } from './fft';

export interface BpmResult {
  bpm: number | null;
  /** 0..1 */
  conf: number;
  /** Raw periodicity of the onset envelope at the chosen tempo (about 0 for a drone, 0.3+ for a steady pulse). Debug aid. */
  strength?: number;
}

/** Every tempo is reported inside one octave: above 140 is halved, below 70 is doubled. */
export const BPM_FLOOR = 70;
export const BPM_CEIL = 140;

export function foldBpm(bpm: number | null): number | null {
  if (bpm === null || !(bpm > 0)) return bpm;
  let b = bpm;
  while (b > BPM_CEIL) b /= 2;
  while (b < BPM_FLOOR) b *= 2;
  return Math.round(b * 10) / 10;
}

const FRAME = 1024;
const HOP = 256;
const MIN_BPM = 55;
const MAX_BPM = 215;

/** Onset strength: positive log-spectral flux per hop, with the local mean removed. */
export function onsetEnvelope(x: Float32Array, sr: number): { env: Float32Array; fps: number } {
  const frames = Math.max(0, Math.floor((x.length - FRAME) / HOP));
  const win = hann(FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const bins = Math.min(FRAME / 2, Math.floor((8000 / sr) * FRAME));
  let prev = new Float32Array(bins);
  let cur = new Float32Array(bins);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = x[off + i]! * win[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const mag = Math.hypot(re[k]!, im[k]!);
      cur[k] = Math.log1p(100 * mag);
      const d = cur[k]! - prev[k]!;
      if (d > 0) flux += d;
    }
    env[f] = flux;
    const t = prev; prev = cur; cur = t;
  }
  // Remove a ~0.5 s moving average so steady loud sections do not dominate.
  const fps = sr / HOP;
  const w = Math.max(2, Math.round(fps * 0.25));
  const out = new Float32Array(frames);
  let acc = 0;
  const csum = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) { acc += env[i]!; csum[i + 1] = acc; }
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(frames, i + w + 1);
    const mean = (csum[b]! - csum[a]!) / (b - a);
    out[i] = Math.max(0, env[i]! - mean);
  }
  return { env: out, fps };
}

function acfAt(acf: Float64Array, lag: number): number {
  const i = Math.floor(lag);
  if (i < 0 || i + 1 >= acf.length) return 0;
  const f = lag - i;
  return acf[i]! * (1 - f) + acf[i + 1]! * f;
}

const prior = (bpm: number): number => {
  const o = Math.log2(bpm / 112);
  return Math.exp(-0.5 * (o / 0.9) ** 2);
};

/** Beats a clean loop of `durationSec` could contain, snapped to the nearest believable tempo. */
function snapToLoopLength(bpm: number, durationSec: number): number | null {
  const beatsList = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  let best: number | null = null;
  let bestErr = 0.025;
  for (const beats of beatsList) {
    const cand = (60 * beats) / durationSec;
    if (cand < MIN_BPM || cand > MAX_BPM) continue;
    for (const mult of [1, 2, 0.5]) {
      const err = Math.abs(cand * mult - bpm) / bpm;
      if (err < bestErr) {
        bestErr = err;
        best = cand * mult;
      }
    }
  }
  return best;
}

export function detectBpm(x: Float32Array, sr: number, durationSec: number, hint: number | null): BpmResult {
  if (durationSec < 1.0 || x.length < sr) return { bpm: hint, conf: hint ? 0.5 : 0 };
  const { env, fps } = onsetEnvelope(x, sr);
  const n = env.length;
  if (n < fps * 1.5) return { bpm: hint, conf: hint ? 0.5 : 0 };

  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i]!;
  if (energy < 1e-3) return { bpm: hint, conf: hint ? 0.5 : 0 };

  const maxLag = Math.ceil((fps * 60) / MIN_BPM) * 4 + 2;
  const acf = new Float64Array(Math.min(maxLag, n - 1));
  for (let lag = 0; lag < acf.length; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i]! * env[i + lag]!;
    acf[lag] = s / (n - lag);
  }
  const zero = acf[0]! || 1;

  let best = 0;
  let bestBpm = 0;
  let bestRaw = 0;
  const scores: number[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const lag = (fps * 60) / bpm;
    const s = (acfAt(acf, lag) + 0.5 * acfAt(acf, lag * 2) + 0.25 * acfAt(acf, lag * 4)) / zero;
    const weighted = s * (0.55 + 0.45 * prior(bpm));
    scores.push(weighted);
    if (weighted > best) { best = weighted; bestBpm = bpm; bestRaw = s; }
  }
  if (bestBpm === 0 || best <= 0) return { bpm: hint, conf: hint ? 0.5 : 0 };

  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let conf = Math.max(0, Math.min(1, (best - median) / (best + 1e-9)));
  conf = Math.min(1, conf * 1.15);

  // A drone, a pad or noise has no real pulse (raw periodicity near 0), however neat the best guess looks.
  const gate = Math.max(0, Math.min(1, (bestRaw - 0.08) / 0.32));
  if (gate === 0) return { bpm: hint, conf: hint ? 0.5 : 0, strength: bestRaw };
  conf *= gate;

  let bpm = bestBpm;
  if (hint) {
    for (const m of [1, 2, 0.5]) {
      if (Math.abs(bpm * m - hint) / hint < 0.04) {
        return { bpm: hint, conf: Math.max(conf, 0.9) };
      }
    }
  }
  const snapped = snapToLoopLength(bpm, durationSec);
  if (snapped) {
    bpm = snapped;
    conf = Math.min(1, conf + 0.1);
  }
  return { bpm: Math.round(bpm * 10) / 10, conf, strength: bestRaw };
}
