import { detectBpm, foldBpm, onsetEnvelope } from '../dsp/bpm';
import { nearestZeroCrossing } from './edit';
import { frameCount, type PcmAudio } from './wav';

export interface LoopPick {
  start: number;
  end: number;
  bars: number;
  /** 0..1, higher is better. Only meaningful for ranking. */
  score: number;
}

const BEATS_PER_BAR = 4;

function mixdown(a: PcmAudio): Float32Array {
  const n = frameCount(a);
  const out = new Float32Array(n);
  for (const ch of a.channels) for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! / a.channels.length;
  return out;
}

/** The tempo to cut to: the one we already know, or a fresh detection on the first minute. */
export function loopTempo(a: PcmAudio, known: number | null): number | null {
  if (known) return known;
  const mono = mixdown(a);
  const head = mono.subarray(0, Math.min(mono.length, a.sampleRate * 60));
  return foldBpm(detectBpm(head, a.sampleRate, head.length / a.sampleRate, null).bpm);
}

/**
 * Where a transient really begins inside [from, from + span): the 1 ms block with the biggest jump in level over
 * the block before it. That finds a kick even when a chord is already ringing underneath. Steps back one block so
 * the attack is kept whole.
 */
function attackAt(x: Float32Array, from: number, span: number, sr: number): number {
  const blk = Math.max(8, Math.round(sr * 0.001));
  const end = Math.min(x.length, from + span);
  // Before the start of the file counts as silence, so a hit on sample 0 is found at 0.
  let best = -1, at = from, prev = from - blk < 0 ? 0 : -1;
  for (let o = Math.max(0, from - blk); o + blk <= end; o += blk) {
    let e = 0;
    for (let i = o; i < o + blk; i++) e += x[i]! * x[i]!;
    const level = Math.sqrt(e / blk);
    if (prev >= 0 && level - prev > best) { best = level - prev; at = o; }
    prev = level;
  }
  return best > 1e-4 ? (at === 0 ? 0 : Math.max(0, at - blk)) : from;
}

/**
 * How alike the audio is just after `end` and just after `start` (or just before both): 1 means a seamless wrap.
 * A loop that is the whole file has nothing to compare, so it gets a neutral-good 0.8 rather than a penalty.
 */
function seam(x: Float32Array, start: number, end: number, w: number): number {
  let num = 0, den = 1e-9;
  const after = end + w <= x.length;
  for (let i = 0; i < w; i++) {
    const p = after ? start + i : start - w + i;
    const q = after ? end + i : end - w + i;
    if (p < 0 || q < 0) return 0.8;
    num += Math.abs(x[p]! - x[q]!);
    den += Math.abs(x[p]!) + Math.abs(x[q]!);
  }
  return 1 - Math.min(1, num / den);
}

/**
 * Ranked whole-bar loops (4, 2 or 1 bars, longest that fits first), best first. Each candidate starts on a
 * transient, and is scored on how well the beat grid lands on hits, how strong the downbeat is, and how cleanly
 * the end wraps back to the start. Edges sit on zero crossings.
 */
export function findLoops(a: PcmAudio, bpm: number, opts: { bars?: number[]; max?: number } = {}): LoopPick[] {
  const n = frameCount(a);
  const sr = a.sampleRate;
  if (n < sr * 0.25 || !(bpm > 0)) return [];
  const x = mixdown(a);
  const beat = (sr * 60) / bpm;
  const { env, fps } = onsetEnvelope(x, sr);
  if (!env.length) return [];
  const hop = sr / fps;
  let envMax = 1e-9;
  for (const v of env) envMax = Math.max(envMax, v);
  // Onset strength near a frame, tolerant of a few milliseconds of timing. Envelope frame i is a 4-hop window
  // starting at i * hop, so a hit at frame f peaks around index f / hop - 2.
  const at = (f: number) => {
    const c = Math.round(f / hop - 2);
    let m = 0;
    for (let k = c - 2; k <= c + 2; k++) m = Math.max(m, env[k] ?? 0);
    return m / envMax;
  };

  // Candidate starts: the beginning, plus every clear onset peak.
  const starts = new Set<number>([attackAt(x, 0, Math.round(hop * 6), sr)]);
  for (let i = 1; i + 1 < env.length; i++) {
    if (env[i]! >= env[i - 1]! && env[i]! >= env[i + 1]! && env[i]! > envMax * 0.3) starts.add(attackAt(x, Math.round(i * hop), Math.round(hop * 6), sr));
  }

  const picks: LoopPick[] = [];
  const window = Math.round(sr * 0.006);
  for (const bars of opts.bars ?? [4, 2, 1]) {
    const len = bars * BEATS_PER_BAR * beat;
    // Allow a hair over the end, for files cut exactly to length.
    if (len > n * 1.002) continue;
    for (const s of starts) {
      if (s + len > n * 1.002) continue;
      let grid = 0;
      const beats = bars * BEATS_PER_BAR;
      for (let k = 0; k < beats; k++) grid += at(s + k * beat);
      grid /= beats;
      const e = Math.min(n, Math.round(s + len));
      // Longer loops win when they line up about as well: that is the musically useful answer.
      const score = grid * 0.55 + at(s) * 0.15 + seam(x, s, e, window) * 0.2 + 0.12 * Math.log2(bars);
      picks.push({ start: s, end: e, bars, score });
    }
  }

  picks.sort((p, q) => q.score - p.score);
  const out: LoopPick[] = [];
  for (const p of picks) {
    if (out.some((o) => o.bars === p.bars && Math.abs(o.start - p.start) < beat / 2)) continue;
    const start = nearestZeroCrossing(a, p.start, Math.round(sr * 0.002));
    const end = p.end >= n ? n : nearestZeroCrossing(a, p.end, Math.round(sr * 0.002));
    out.push({ ...p, start, end });
    if (out.length >= (opts.max ?? 8)) break;
  }
  return out;
}
