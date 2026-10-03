import { PEAK_BINS } from '../types';

/** Coarse waveform for drawing: 0..99 per bin, square-root compressed so quiet tails stay visible. */
export function computePeaks(x: Float32Array, bins = PEAK_BINS): number[] {
  const out = new Array<number>(bins).fill(0);
  if (x.length === 0) return out;
  const per = x.length / bins;
  let max = 1e-9;
  const raw = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let m = 0;
    for (let i = from; i < to && i < x.length; i++) {
      const v = Math.abs(x[i]!);
      if (v > m) m = v;
    }
    raw[b] = m;
    if (m > max) max = m;
  }
  for (let b = 0; b < bins; b++) out[b] = Math.round(Math.sqrt(raw[b]! / max) * 99);
  return out;
}
