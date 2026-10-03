import { frameCount, type PcmAudio } from './wav';

/** Half-open frame range [start, end). */
export type Range = readonly [number, number];

/** Every edit returns new audio and leaves its input alone, so undo is just keeping the old object. */
const each = (a: PcmAudio, fn: (ch: Float32Array) => Float32Array): PcmAudio => ({ sampleRate: a.sampleRate, channels: a.channels.map(fn) });

export function clampRange(a: PcmAudio, [s, e]: Range): [number, number] {
  const n = frameCount(a);
  const lo = Math.max(0, Math.min(n, Math.round(Math.min(s, e))));
  const hi = Math.max(0, Math.min(n, Math.round(Math.max(s, e))));
  return [lo, hi];
}

const dbToGain = (db: number): number => 10 ** (db / 20);

/** Keep only the range. */
export function trim(a: PcmAudio, r: Range): PcmAudio {
  const [s, e] = clampRange(a, r);
  return each(a, (ch) => ch.slice(s, e));
}

/** Cut the range out and close the gap. */
export function remove(a: PcmAudio, r: Range): PcmAudio {
  const [s, e] = clampRange(a, r);
  return each(a, (ch) => {
    const out = new Float32Array(ch.length - (e - s));
    out.set(ch.subarray(0, s));
    out.set(ch.subarray(e), s);
    return out;
  });
}

export function silence(a: PcmAudio, r: Range): PcmAudio {
  const [s, e] = clampRange(a, r);
  return each(a, (ch) => {
    const out = ch.slice();
    out.fill(0, s, e);
    return out;
  });
}

/** Linear fade across the range, from silence (in) or to silence (out). */
export function fade(a: PcmAudio, r: Range, dir: 'in' | 'out'): PcmAudio {
  const [s, e] = clampRange(a, r);
  const len = e - s;
  if (len < 1) return a;
  return each(a, (ch) => {
    const out = ch.slice();
    for (let i = 0; i < len; i++) {
      const t = len === 1 ? 0 : i / (len - 1);
      out[s + i] = out[s + i]! * (dir === 'in' ? t : 1 - t);
    }
    return out;
  });
}

export function gain(a: PcmAudio, r: Range, db: number): PcmAudio {
  const [s, e] = clampRange(a, r);
  const g = dbToGain(db);
  return each(a, (ch) => {
    const out = ch.slice();
    for (let i = s; i < e; i++) out[i] = out[i]! * g;
    return out;
  });
}

export function peak(a: PcmAudio, r: Range): number {
  const [s, e] = clampRange(a, r);
  let m = 0;
  for (const ch of a.channels) for (let i = s; i < e; i++) { const v = Math.abs(ch[i]!); if (v > m) m = v; }
  return m;
}

export const peakDb = (a: PcmAudio, r: Range): number => {
  const p = peak(a, r);
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
};

/** Scale the range so its loudest sample (across all channels) sits at targetDb. Silence is left alone. */
export function normalize(a: PcmAudio, r: Range, targetDb = -0.1): PcmAudio {
  const p = peak(a, r);
  if (p < 1e-9) return a;
  return gain(a, r, targetDb - 20 * Math.log10(p));
}

export function reverse(a: PcmAudio, r: Range): PcmAudio {
  const [s, e] = clampRange(a, r);
  return each(a, (ch) => {
    const out = ch.slice();
    out.subarray(s, e).reverse();
    return out;
  });
}

/** Short fades at both ends of the whole sample, so it starts and stops without a click. */
export function declick(a: PcmAudio, ms = 4): PcmAudio {
  const n = frameCount(a);
  const len = Math.min(Math.floor(n / 2), Math.max(1, Math.round((a.sampleRate * ms) / 1000)));
  if (n < 2) return a;
  return fade(fade(a, [0, len], 'in'), [n - len, n], 'out');
}

/**
 * The part of the sample louder than thresholdDb, with a little padding kept before the first sound so the attack
 * survives. Null when the whole thing is below the threshold.
 */
export function audibleRange(a: PcmAudio, thresholdDb = -60, padMs = 2): [number, number] | null {
  const n = frameCount(a);
  const t = dbToGain(thresholdDb);
  const loud = (i: number) => a.channels.some((ch) => Math.abs(ch[i]!) > t);
  let s = 0;
  while (s < n && !loud(s)) s++;
  if (s === n) return null;
  let e = n;
  while (e > s && !loud(e - 1)) e--;
  const pad = Math.round((a.sampleRate * padMs) / 1000);
  return [Math.max(0, s - pad), Math.min(n, e + pad)];
}

/** The nearest frame to `at`, within maxDist, where the summed signal crosses zero. Returns `at` if there is none. */
export function nearestZeroCrossing(a: PcmAudio, at: number, maxDist: number): number {
  const n = frameCount(a);
  if (n < 2) return at;
  const sum = (i: number) => a.channels.reduce((acc, ch) => acc + ch[i]!, 0);
  const crosses = (i: number) => i > 0 && i < n && (sum(i - 1) <= 0) !== (sum(i) <= 0);
  const c = Math.max(0, Math.min(n, Math.round(at)));
  if (c === 0 || c === n) return c;
  for (let d = 0; d <= maxDist; d++) {
    if (crosses(c - d)) return c - d;
    if (crosses(c + d)) return c + d;
  }
  return c;
}
