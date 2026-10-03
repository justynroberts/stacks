import { onsetEnvelope } from '../dsp/bpm';
import { fft, hann } from '../dsp/fft';
import { nearestZeroCrossing } from './edit';
import { attackAt, mixdown } from './loop';
import { frameCount, type PcmAudio } from './wav';

/**
 * Loops across a whole track: the "load a full song, get a folder of loops" case.
 *
 * 1. A bar grid for the track: tempo from the caller, beat phase from the onsets, downbeat as the beat of the bar
 *    that carries the most weight. Assumes a steady tempo (anything made to a click); a drifting live recording will
 *    still give loops, but their edges are snapped to the nearest hit rather than trusted to the grid.
 * 2. A fingerprint per bar: energy in 12 log-spaced bands (what is playing) plus a 12-bin chroma (which notes),
 *    each normalised; and the bar's loudness.
 * 3. Section changes: bars that differ from the bar before far more than bars in this track usually do.
 * 4. Every bar-aligned loop of the chosen length, scored on: hits landing on the beat (relative to the strongest hit
 *    in each beat, so a sparse section is not marked down against a busy one), steady content inside the loop, the
 *    bar after the loop sounding like its first bar (the music really repeats there, so it loops naturally), and
 *    enough energy to be worth keeping. In 'best' mode a loop that crosses a section change is not a loop.
 * 5. 'best' keeps the strongest loops that neither overlap nor duplicate one already kept, so a chorus that comes
 *    round three times gives one loop, not three. 'all' is a straight split into consecutive loops.
 */

export interface FoundLoop {
  start: number;
  end: number;
  /** Bars at the given tempo. */
  bars: number;
  /** 0..1, for ranking. */
  score: number;
  /** Loudness relative to the loudest loop found, 0..1. */
  energy: number;
}

export interface LoopSet {
  /** The tempo the grid was cut to: the one given, refined against the whole track. */
  bpm: number;
  /** Frames per beat. */
  beat: number;
  /** Frame of the first downbeat. */
  downbeat: number;
  loops: FoundLoop[];
}

const BANDS = 12;
const WIN = 2048;

function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[i * factor + k]!;
    out[i] = s / factor;
  }
  return out;
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; };
function normalise(v: Float32Array): Float32Array {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map((x) => x / n);
}

/** Band energies (log, 60 Hz .. 8 kHz) plus chroma (60 Hz .. 5 kHz), and the RMS of x[from, to). */
function barFeature(x: Float32Array, sr: number, from: number, to: number, win: Float32Array): { feat: Float32Array; rms: number } {
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((60 * (8000 / 60) ** (i / BANDS) * WIN) / sr));
  const acc = new Float32Array(BANDS);
  const chroma = new Float32Array(12);
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  let frames = 0, sq = 0;
  for (let i = from; i < to; i++) sq += x[i]! * x[i]!;
  for (let o = from; o + WIN <= to; o += WIN) {
    for (let i = 0; i < WIN; i++) { re[i] = x[o + i]! * win[i]!; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = Math.max(1, edges[b]!); k < Math.max(edges[b]! + 1, edges[b + 1]!) && k < WIN / 2; k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
      acc[b] = acc[b]! + e;
    }
    for (let k = Math.ceil((60 * WIN) / sr); k < Math.min(WIN / 2, (5000 * WIN) / sr); k++) {
      const pc = (((Math.round(12 * Math.log2(((k * sr) / WIN) / 440)) + 9) % 12) + 12) % 12;
      chroma[pc] = chroma[pc]! + Math.hypot(re[k]!, im[k]!);
    }
    frames++;
  }
  const bands = normalise(acc.map((e) => Math.log1p(e / Math.max(1, frames))));
  const notes = normalise(chroma);
  const feat = new Float32Array(BANDS + 12);
  feat.set(bands.map((v) => v * Math.SQRT1_2));
  feat.set(notes.map((v) => v * Math.SQRT1_2), BANDS);
  return { feat, rms: Math.sqrt(sq / Math.max(1, to - from)) };
}

export function findLoopSet(a: PcmAudio, bpm: number, opts: { bars?: number; max?: number; mode?: 'best' | 'all' } = {}): LoopSet {
  const bars = opts.bars ?? 4;
  const max = opts.max ?? 12;
  const mode = opts.mode ?? 'best';
  const n = frameCount(a);
  const sr = a.sampleRate;
  const empty: LoopSet = { bpm, beat: (sr * 60) / bpm, downbeat: 0, loops: [] };
  if (!(bpm > 0) || n < sr) return empty;

  // Analyse at ~22 kHz mono: plenty for rhythm and band energy, half the work of 44.1k.
  const factor = Math.max(1, Math.floor(sr / 22050));
  const full = mixdown(a);
  const x = decimate(full, factor);
  const xsr = sr / factor;
  const { env, fps } = onsetEnvelope(x, xsr);
  const hop = xsr / fps;
  let envMax = 1e-9;
  for (const v of env) envMax = Math.max(envMax, v);
  // Envelope frame i is a 4-hop window from i * hop, so a hit at f peaks near index f / hop - 2 (see loop.ts).
  const at = (f: number) => {
    const c = Math.round(f / hop - 2);
    let m = 0;
    for (let k = c - 2; k <= c + 2; k++) m = Math.max(m, env[k] ?? 0);
    return m / envMax;
  };

  /** Best phase for a beat length, and how much onset energy that grid lands on per beat. */
  const fitGrid = (beatLen: number, step: number): { phase: number; fit: number } => {
    let phase = 0, best = -1;
    for (let p = 0; p < beatLen; p += step) {
      let s = 0, k = 0;
      for (let f = p; f < x.length; f += beatLen, k++) s += at(f);
      if (k && s / k > best) { best = s / k; phase = p; }
    }
    return { phase, fit: best };
  };

  // Tempo, refined against the whole track. A tempo detected on a short stretch can be a fraction of a BPM out,
  // which over a song drifts the grid off the beat, and inside a 4 bar loop is an audible jump at the seam.
  // First a coarse search either side for the grid that lands on the most onset energy. The envelope only places
  // hits to a couple of hops, so then measure: find the real attack near every grid beat and fit a straight line
  // through attack time against beat number. Its slope is the beat length, its intercept the phase, to the sample.
  // The given tempo can be the classic 3:2 mistake (82 for a 123 song). Compare it with 3/2 and 2/3 of itself by
  // hits per minute: the tempo times the share of its grid beats that land on a clear hit. The real tempo hits
  // nearly every beat at the highest rate; 2/3 of it hits fewer, slower; 3/2 of it falls on triplet positions that
  // straight music rarely has. (Average onset strength per beat would not do: it favours slower grids, which can
  // sit on only the strongest beats.)
  const hitsPerMinute = (t: number) => {
    const beatLen = (xsr * 60) / t;
    const { phase: p } = fitGrid(beatLen, hop);
    let hits = 0, total = 0;
    for (let f = p; f < x.length; f += beatLen, total++) if (at(f) > 0.25) hits++;
    return total ? (t * hits) / total : 0;
  };
  /** The tempo within 1.5% of t whose grid lands on the most onset energy. */
  const coarse = (t: number) => {
    let best = t, bestFit = fitGrid((xsr * 60) / t, hop).fit;
    for (let b = t * 0.985; b <= t * 1.015; b += t * 0.0004) {
      const { fit } = fitGrid((xsr * 60) / b, hop);
      if (fit > bestFit) { bestFit = fit; best = b; }
    }
    return best;
  };
  // Each hypothesis is judged at its best fit, or a slightly wrong tempo drifts off the beat over a song and loses
  // to a denser wrong grid that hits things by chance.
  let tempo = coarse(bpm);
  {
    let pick = hitsPerMinute(tempo);
    for (const m of [1.5, 2 / 3]) {
      if (bpm * m < 50 || bpm * m > 220) continue;
      const t = coarse(bpm * m);
      const h = hitsPerMinute(t);
      if (h > pick * 1.1) { pick = h; tempo = t; }
    }
  }
  let beat = (xsr * 60) / tempo;
  let { phase } = fitGrid(beat, hop / 2);
  {
    const reach = Math.round(xsr * 0.04);
    for (let pass = 0; pass < 3; pass++) {
      const ks: number[] = [], ts: number[] = [];
      for (let k = 0, f = phase; f < x.length - reach; k++, f = phase + k * beat) {
        const from = Math.max(0, Math.round(f) - reach);
        const hit = attackAt(x, from, reach * 2, xsr);
        if (hit !== from) { ks.push(k); ts.push(hit); }
      }
      if (ks.length < 8) break;
      // Least squares, then again without the hits far off the line (fills, swing, ghost notes).
      const fitLine = (idx: number[]) => {
        const n = idx.length;
        let sk = 0, st = 0, skk = 0, skt = 0;
        for (const i of idx) { sk += ks[i]!; st += ts[i]!; skk += ks[i]! * ks[i]!; skt += ks[i]! * ts[i]!; }
        const slope = (n * skt - sk * st) / (n * skk - sk * sk);
        return { slope, icpt: (st - slope * sk) / n };
      };
      let line = fitLine(ks.map((_, i) => i));
      const keep = ks.map((_, i) => i).filter((i) => Math.abs(ts[i]! - (line.icpt + line.slope * ks[i]!)) < xsr * 0.01);
      if (keep.length >= 8) line = fitLine(keep);
      if (!(line.slope > beat * 0.97 && line.slope < beat * 1.03)) break;
      beat = line.slope;
      phase = line.icpt;
    }
    while (phase < 0) phase += beat;
    while (phase >= beat) phase -= beat;
    tempo = (xsr * 60) / beat;
  }
  const barLen = beat * 4;
  if (x.length < barLen * bars) return { ...empty, bpm: tempo };

  // Downbeat: which of the four beats carries the most weight bar after bar.
  let down = 0, bestDown = -1;
  for (let b = 0; b < 4; b++) {
    let s = 0;
    for (let f = phase + b * beat; f < x.length; f += barLen) s += at(f);
    if (s > bestDown) { bestDown = s; down = b; }
  }
  let first = phase + down * beat;
  while (first - barLen >= 0) first -= barLen;

  const barStarts: number[] = [];
  // A little grace (1% of a bar), so a track cut on its last bar line keeps that bar despite a hair of tempo error;
  // the loop's end is clamped to the end of the audio below.
  for (let f = first; f + barLen <= x.length + barLen * 0.01; f += barLen) barStarts.push(f);
  const win = hann(WIN);
  const feats = barStarts.map((s) => barFeature(x, xsr, Math.round(s), Math.min(x.length, Math.round(s + barLen)), win));
  if (bars > barStarts.length) return { ...empty, bpm: tempo };
  const rmsSorted = feats.map((f) => f.rms).sort((p, q) => p - q);
  const typical = rmsSorted[Math.floor(rmsSorted.length / 2)] ?? 0;

  // Section changes, judged against how much this track's bars normally differ from their neighbours.
  const change = feats.map((f, k) => (k === 0 ? 0 : 1 - dot(feats[k - 1]!.feat, f.feat)));
  const sortedChange = change.slice(1).sort((p, q) => p - q);
  const med = sortedChange[Math.floor(sortedChange.length / 2)] ?? 0;
  const mad = sortedChange.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[Math.floor(sortedChange.length / 2)] ?? 0;
  const threshold = Math.max(0.05, med + 4 * mad);
  const boundary = change.map((v, k) => k > 0 && v > threshold && v >= (change[k - 1] ?? 0) && v >= (change[k + 1] ?? 0));

  // How squarely the hits sit on the grid in [from, from + beat): the onset at the beat (or its 8th) against the
  // strongest onset anywhere in that beat.
  const onBeat = (f: number) => {
    let peak = 1e-9;
    for (let k = Math.round(f / hop - 2); k < Math.round((f + beat) / hop - 2); k++) peak = Math.max(peak, (env[k] ?? 0) / envMax);
    return Math.min(1, Math.max(at(f), at(f + beat / 2)) / peak);
  };

  interface Cand { i: number; score: number; energy: number; fp: Float32Array }
  const cands: Cand[] = [];
  for (let i = 0; i + bars <= barStarts.length; i++) {
    const inLoop = feats.slice(i, i + bars);
    const energy = inLoop.reduce((t, f) => t + f.rms, 0) / bars;
    if (energy < typical * 0.15) continue; // silence, a fade, a gap
    if (mode === 'best' && boundary.slice(i + 1, i + bars).some(Boolean)) continue;
    let grid = 0;
    for (let k = 0; k < bars * 4; k++) grid += onBeat(barStarts[i]! + k * beat);
    grid /= bars * 4;
    // The least alike pair of neighbouring bars: one section change anywhere inside is enough to rule it down.
    let steady = 1;
    for (let k = 1; k < bars; k++) steady = Math.min(steady, dot(inLoop[k - 1]!.feat, inLoop[k]!.feat));
    const after = feats[i + bars];
    const repeats = after ? dot(inLoop[0]!.feat, after.feat) : 0.9;
    const fp = normalise(inLoop.reduce((acc, f) => acc.map((v, k) => v + f.feat[k]!), new Float32Array(BANDS + 12)));
    const score = 0.35 * grid + 0.25 * steady + 0.3 * repeats + 0.1 * Math.min(1, energy / Math.max(1e-9, typical));
    cands.push({ i, score, energy, fp });
  }
  if (!cands.length) return { bpm: tempo, beat: beat * factor, downbeat: first * factor, loops: [] };

  let chosen: Cand[];
  if (mode === 'all') {
    chosen = [];
    for (const c of cands) if (!chosen.length || c.i >= chosen[chosen.length - 1]!.i + bars) chosen.push(c);
  } else {
    const ranked = [...cands].sort((p, q) => q.score - p.score);
    const floor = ranked[0]!.score * 0.8;
    chosen = [];
    for (const c of ranked) {
      if (chosen.length >= max || c.score < floor) break;
      if (chosen.some((k) => Math.abs(k.i - c.i) < bars)) continue; // overlaps one already kept
      if (chosen.some((k) => dot(k.fp, c.fp) > 0.995)) continue; // the same section, again
      chosen.push(c);
    }
    chosen.sort((p, q) => p.i - q.i);
  }

  const loudest = Math.max(...chosen.map((c) => c.energy), 1e-9);
  const len = Math.round(barLen * bars * factor);
  const loops = chosen.map((c) => {
    // Trust the grid for the length; let the start find the actual hit nearby, then a zero crossing.
    const gridStart = Math.round(barStarts[c.i]! * factor);
    const reach = Math.round(sr * 0.03);
    const from = Math.max(0, gridStart - reach);
    let start = attackAt(full, from, reach * 2, sr);
    if (start === from) start = gridStart; // no clear hit near the bar line: keep the grid
    start = nearestZeroCrossing(a, start, Math.round(sr * 0.002));
    const end = Math.min(n, nearestZeroCrossing(a, start + len, Math.round(sr * 0.002)));
    return { start, end, bars, score: c.score, energy: c.energy / loudest };
  });
  return { bpm: Math.round(tempo * 100) / 100, beat: beat * factor, downbeat: Math.round(first * factor), loops };
}
