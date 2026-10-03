import { keyInfo, type KeyInfo } from '../camelot';
import { fft, hann, nextPow2 } from './fft';

export interface KeyResult extends Partial<KeyInfo> {
  /** 0..1, 0 when the sound is unpitched */
  conf: number;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Summed pitch-class energy across the sample (C = 0). */
export function chromagram(x: Float32Array, sr: number): { chroma: number[]; bass: number[]; voiced: number } {
  const size = Math.min(8192, nextPow2(x.length));
  const hop = size / 2;
  const win = hann(size);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const chroma = new Array<number>(12).fill(0);
  // Votes for the lowest strong partial in each frame: usually the root, which settles major vs relative minor.
  const bass = new Array<number>(12).fill(0);
  const lo = Math.max(1, Math.floor((38 / sr) * size));
  const hi = Math.min(size / 2, Math.floor((2200 / sr) * size));
  const width = hi - lo;

  const starts: number[] = [];
  for (let off = 0; off + size <= Math.max(size, x.length); off += hop) starts.push(off);
  const energies = starts.map((off) => {
    let e = 0;
    for (let i = 0; i < size; i++) { const v = x[off + i] ?? 0; e += v * v; }
    return e;
  });
  const maxE = Math.max(...energies, 1e-12);

  // Magnitudes for every frame, then a 3 frame median per bin. Sustained notes survive it; a kick or snare
  // that lands in one frame does not, so drums stop dragging the key towards their own pitch.
  const mags: Float32Array[] = starts.map((off) => {
    for (let i = 0; i < size; i++) { re[i] = (x[off + i] ?? 0) * win[i]!; im[i] = 0; }
    fft(re, im);
    const m = new Float32Array(width);
    for (let k = 0; k < width; k++) m[k] = Math.hypot(re[lo + k]!, im[lo + k]!);
    return m;
  });
  const smooth = (fi: number): Float32Array => {
    const a = mags[Math.max(0, fi - 1)]!;
    const b = mags[fi]!;
    const c = mags[Math.min(mags.length - 1, fi + 1)]!;
    if (mags.length < 3) return b;
    const out = new Float32Array(width);
    for (let k = 0; k < width; k++) {
      const p = a[k]!, q = b[k]!, r = c[k]!;
      out[k] = Math.max(Math.min(p, q), Math.min(Math.max(p, q), r));
    }
    return out;
  };

  let voiced = 0;
  starts.forEach((_off, fi) => {
    if (energies[fi]! < maxE * 0.02) return;
    voiced++;
    const m = smooth(fi);
    let top = 0;
    for (let k = 0; k < width; k++) top = Math.max(top, m[k]!);
    for (let k = 1; k < width - 1; k++) {
      const v = m[k]!;
      if (v >= top * 0.4 && v >= m[k - 1]! && v >= m[k + 1]!) {
        const midi = 69 + 12 * Math.log2(((lo + k) * sr) / size / 440);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        bass[pc] = bass[pc]! + energies[fi]! / maxE;
        break;
      }
    }
    for (let k = 0; k < width; k++) {
      const mag = m[k]!;
      if (mag < 1e-6) continue;
      const midi = 69 + 12 * Math.log2(((lo + k) * sr) / size / 440);
      const r = Math.round(midi);
      if (Math.abs(midi - r) > 0.38) continue;
      const pc = ((r % 12) + 12) % 12;
      chroma[pc] = chroma[pc]! + Math.sqrt(mag);
    }
  });
  return { chroma, bass, voiced };
}

export function detectKey(x: Float32Array, sr: number): KeyResult {
  if (x.length < 512) return { conf: 0 };
  const { chroma: raw, bass, voiced } = chromagram(x, sr);
  const total = raw.reduce((s, v) => s + v, 0);
  if (voiced === 0 || total <= 0) return { conf: 0 };

  const p = raw.map((v) => v / total);
  const bassTotal = bass.reduce((s, v) => s + v, 0);
  const chroma = p.map((v, i) => v + (bassTotal > 0 ? (0.5 * bass[i]!) / bassTotal : 0));
  const entropy = -p.reduce((s, v) => (v > 0 ? s + v * Math.log(v) : s), 0) / Math.log(12);
  if (entropy > 0.985) return { conf: 0 };

  let best = -2, second = -2, bestPc = 0, bestMinor = false;
  for (let pc = 0; pc < 12; pc++) {
    const rotate = (prof: number[]) => prof.map((_, i) => prof[(i - pc + 12) % 12]!);
    const maj = pearson(chroma, rotate(MAJOR));
    const min = pearson(chroma, rotate(MINOR));
    for (const [score, minor] of [[maj, false], [min, true]] as const) {
      if (score > best) { second = best; best = score; bestPc = pc; bestMinor = minor; }
      else if (score > second) second = score;
    }
  }
  if (best < 0.4) return { conf: 0 };
  const strength = Math.max(0, Math.min(1, (best - 0.35) / 0.5));
  const margin = Math.max(0, Math.min(1, (best - second) / 0.12));
  const conf = strength * 0.6 + margin * 0.4;
  return { ...keyInfo(bestPc, bestMinor), conf };
}
