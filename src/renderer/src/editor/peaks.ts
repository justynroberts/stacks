import { frameCount, type PcmAudio } from '@shared/audio/wav';

/** Min / max per block of samples, so drawing a zoomed-out view never walks every sample. */
export interface Summary {
  block: number;
  min: Float32Array[];
  max: Float32Array[];
}

export function summarise(a: PcmAudio, block = 256): Summary {
  const n = frameCount(a);
  const blocks = Math.ceil(n / block);
  const min: Float32Array[] = [];
  const max: Float32Array[] = [];
  for (const ch of a.channels) {
    const lo = new Float32Array(blocks);
    const hi = new Float32Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let mn = Infinity, mx = -Infinity;
      for (let i = b * block, end = Math.min(n, i + block); i < end; i++) {
        const v = ch[i]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      lo[b] = mn === Infinity ? 0 : mn;
      hi[b] = mx === -Infinity ? 0 : mx;
    }
    min.push(lo);
    max.push(hi);
  }
  return { block, min, max };
}

/** Min and max of one channel over frames [from, to). Uses the summary when the span is wide enough. */
export function span(a: PcmAudio, s: Summary, c: number, from: number, to: number): [number, number] {
  const n = frameCount(a);
  const f = Math.max(0, Math.floor(from));
  const t = Math.min(n, Math.max(f + 1, Math.ceil(to)));
  let mn = Infinity, mx = -Infinity;
  if (t - f >= s.block * 2) {
    const lo = s.min[c]!, hi = s.max[c]!;
    for (let b = Math.floor(f / s.block), end = Math.min(lo.length, Math.ceil(t / s.block)); b < end; b++) {
      if (lo[b]! < mn) mn = lo[b]!;
      if (hi[b]! > mx) mx = hi[b]!;
    }
  } else {
    const ch = a.channels[c]!;
    for (let i = f; i < t; i++) {
      const v = ch[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  return mn === Infinity ? [0, 0] : [mn, mx];
}
