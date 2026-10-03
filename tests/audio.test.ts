import { describe, expect, it } from 'vitest';
import * as edit from '@shared/audio/edit';
import { type PcmAudio, readWav, sniffSampleRate, writeWav } from '@shared/audio/wav';
import { encodeWav } from '@shared/dsp/synth';
import { editName } from '@shared/filename';

const ramp = (n: number, sr = 48000, ch = 2): PcmAudio => ({
  sampleRate: sr,
  channels: Array.from({ length: ch }, (_, c) => Float32Array.from({ length: n }, (_, i) => ((i / n) * 2 - 1) * (c ? -0.5 : 0.5)))
});

describe('wav', () => {
  for (const format of [{ bits: 16, float: false }, { bits: 24, float: false }, { bits: 32, float: false }, { bits: 32, float: true }] as const) {
    it(`round trips stereo ${format.float ? 'float' : 'PCM'} ${format.bits}-bit at its own rate`, () => {
      const a = ramp(1000);
      const back = readWav(writeWav(a, format))!;
      expect(back.sampleRate).toBe(48000);
      expect(back.format).toEqual(format);
      expect(back.channels).toHaveLength(2);
      const tol = format.float ? 1e-7 : format.bits === 16 ? 1e-4 : 1e-6;
      for (let c = 0; c < 2; c++) for (let i = 0; i < 1000; i += 37) expect(Math.abs(back.channels[c]![i]! - a.channels[c]![i]!)).toBeLessThan(tol);
    });
  }

  it('clamps rather than wraps when writing integers', () => {
    const back = readWav(writeWav({ sampleRate: 44100, channels: [Float32Array.of(1.7, -1.7)] }, { bits: 16, float: false }))!;
    expect(back.channels[0]![0]).toBeGreaterThan(0.99);
    expect(back.channels[0]![1]).toBeLessThan(-0.99);
  });

  it('reads the mono 16-bit files the demo makes, and skips unknown chunks', () => {
    const plain = encodeWav(Float32Array.of(0, 0.5, -0.5), 22050);
    expect(readWav(plain)!.channels[0]![1]).toBeCloseTo(0.5, 3);
    // Insert a LIST chunk between fmt and data.
    const src = new Uint8Array(plain);
    const list = new Uint8Array(8 + 4);
    list.set([76, 73, 83, 84, 4, 0, 0, 0, 1, 2, 3, 4]);
    const out = new Uint8Array(src.length + list.length);
    out.set(src.subarray(0, 36)); out.set(list, 36); out.set(src.subarray(36), 36 + list.length);
    expect(readWav(out.buffer)!.channels[0]![2]).toBeCloseTo(-0.5, 3);
  });

  it('refuses things it cannot read', () => {
    expect(readWav(new ArrayBuffer(4))).toBeNull();
    expect(readWav(new TextEncoder().encode('RIFF....WAVEnope').buffer as ArrayBuffer)).toBeNull();
  });

  it('sniffs the sample rate from WAV, AIFF and FLAC headers', () => {
    expect(sniffSampleRate(writeWav(ramp(10, 96000), { bits: 24, float: false }))).toBe(96000);

    const aiff = new ArrayBuffer(12 + 8 + 18);
    const v = new DataView(aiff);
    const s = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    s(0, 'FORM'); v.setUint32(4, aiff.byteLength - 8); s(8, 'AIFF'); s(12, 'COMM'); v.setUint32(16, 18);
    // 44100 as an 80-bit extended float: exponent 0x400E, mantissa 0xAC44 << 48
    v.setUint16(28, 0x400e); v.setUint32(30, 0xac440000); v.setUint32(34, 0);
    expect(sniffSampleRate(aiff)).toBe(44100);

    const flac = new Uint8Array(42);
    flac.set([0x66, 0x4c, 0x61, 0x43]);
    // 48000 = 0x0BB80 in 20 bits at byte 18
    flac[18] = 0x0b; flac[19] = 0xb8; flac[20] = 0x00;
    expect(sniffSampleRate(flac.buffer)).toBe(48000);
    expect(sniffSampleRate(new TextEncoder().encode('ID3 mp3 data here').buffer as ArrayBuffer)).toBeNull();
  });
});

describe('edits', () => {
  const tone = (): PcmAudio => ({ sampleRate: 1000, channels: [Float32Array.from({ length: 100 }, (_, i) => Math.sin(i / 3) * 0.5)] });

  it('trims, removes and silences without touching the input', () => {
    const a = tone();
    const before = a.channels[0]!.slice();
    expect(edit.trim(a, [10, 30]).channels[0]).toHaveLength(20);
    expect(edit.trim(a, [10, 30]).channels[0]![0]).toBe(a.channels[0]![10]);
    const cut = edit.remove(a, [10, 30]).channels[0]!;
    expect(cut).toHaveLength(80);
    expect(cut[10]).toBe(a.channels[0]![30]);
    expect([...edit.silence(a, [10, 30]).channels[0]!.subarray(10, 30)].every((x) => x === 0)).toBe(true);
    expect(a.channels[0]).toEqual(before);
  });

  it('clamps and orders ranges', () => {
    expect(edit.clampRange(tone(), [150, -5])).toEqual([0, 100]);
  });

  it('fades in from silence and out to silence', () => {
    const a: PcmAudio = { sampleRate: 1000, channels: [new Float32Array(11).fill(1)] };
    const fin = edit.fade(a, [0, 11], 'in').channels[0]!;
    expect(fin[0]).toBe(0);
    expect(fin[10]).toBe(1);
    expect(fin[5]).toBeCloseTo(0.5);
    const fout = edit.fade(a, [0, 11], 'out').channels[0]!;
    expect(fout[0]).toBe(1);
    expect(fout[10]).toBe(0);
  });

  it('applies gain, normalises to a peak, and reverses', () => {
    const a = tone();
    expect(edit.peak(edit.gain(a, [0, 100], 6), [0, 100])).toBeCloseTo(edit.peak(a, [0, 100]) * 10 ** (6 / 20), 5);
    expect(edit.peakDb(edit.normalize(a, [0, 100], -1), [0, 100])).toBeCloseTo(-1, 4);
    const silent: PcmAudio = { sampleRate: 1000, channels: [new Float32Array(10)] };
    expect(edit.normalize(silent, [0, 10])).toBe(silent);
    const r = edit.reverse(a, [0, 100]).channels[0]!;
    expect(r[0]).toBe(a.channels[0]![99]);
  });

  it('de-clicks both ends', () => {
    const a: PcmAudio = { sampleRate: 1000, channels: [new Float32Array(100).fill(0.8)] };
    const d = edit.declick(a, 4).channels[0]!;
    expect(d[0]).toBe(0);
    expect(d[99]).toBe(0);
    expect(d[50]).toBeCloseTo(0.8);
  });

  it('finds the audible part, with a little lead-in kept', () => {
    const ch = new Float32Array(1000);
    ch.fill(0.5, 300, 600);
    const r = edit.audibleRange({ sampleRate: 1000, channels: [ch] }, -60, 2)!;
    expect(r).toEqual([298, 602]);
    expect(edit.audibleRange({ sampleRate: 1000, channels: [new Float32Array(10)] })).toBeNull();
  });

  it('snaps to the nearest zero crossing', () => {
    const ch = Float32Array.from({ length: 100 }, (_, i) => (i < 40 ? 1 : -1));
    const a = { sampleRate: 1000, channels: [ch] };
    expect(edit.nearestZeroCrossing(a, 35, 10)).toBe(40);
    expect(edit.nearestZeroCrossing(a, 10, 5)).toBe(10);
  });
});

describe('editName', () => {
  it('puts _edit before the tags and always writes .wav', () => {
    expect(editName('rhodes_loop_dusty_Am_84bpm.wav', 84, 'Am')).toBe('rhodes_loop_dusty_edit_Am_84bpm.wav');
    expect(editName('kick_01.aif', null, null)).toBe('kick_01_edit.wav');
    expect(editName('bass_reese_loop_140.flac', 140, 'Gm')).toBe('bass_reese_loop_edit_140.wav');
  });
});

describe('findLoops', () => {
  const SR = 22050;
  it('finds a 4 bar loop on the downbeat of a clean 120 bpm loop', async () => {
    const { synthLoop } = await import('@shared/dsp/synth');
    const { findLoops } = await import('@shared/audio/loop');
    const x = synthLoop({ bpm: 120, seconds: 8, sampleRate: SR, chordPcs: [9, 0, 4] });
    const [best] = findLoops({ sampleRate: SR, channels: [x] }, 120);
    expect(best).toBeDefined();
    expect(best!.bars).toBe(4);
    expect(best!.start).toBeLessThan(SR * 0.01);
    expect(Math.abs(best!.end - best!.start - SR * 8)).toBeLessThan(SR * 0.01);
  });

  it('skips leading silence and falls back to fewer bars when 4 do not fit', async () => {
    const { synthLoop } = await import('@shared/dsp/synth');
    const { findLoops } = await import('@shared/audio/loop');
    const body = synthLoop({ bpm: 120, seconds: 5, sampleRate: SR });
    const pad = Math.round(SR * 0.37);
    const x = new Float32Array(pad + body.length);
    x.set(body, pad);
    const [best] = findLoops({ sampleRate: SR, channels: [x] }, 120);
    expect(best!.bars).toBe(2);
    // Starts on the first kick, not in the silence before it.
    expect(Math.abs(best!.start - pad)).toBeLessThan(SR * 0.005);
    expect(Math.abs(best!.end - best!.start - SR * 4)).toBeLessThan(SR * 0.005);
  });

  it('detects the tempo itself when none is known', async () => {
    const { synthLoop } = await import('@shared/dsp/synth');
    const { loopTempo } = await import('@shared/audio/loop');
    const x = synthLoop({ bpm: 96, seconds: 10, sampleRate: SR });
    expect(loopTempo({ sampleRate: SR, channels: [x] }, null)).toBeCloseTo(96, 0);
    expect(loopTempo({ sampleRate: SR, channels: [x] }, 140)).toBe(140);
  });

  it('gives nothing for a sound too short to loop', async () => {
    const { findLoops } = await import('@shared/audio/loop');
    expect(findLoops({ sampleRate: SR, channels: [new Float32Array(1000)] }, 120)).toEqual([]);
  });
});

describe('findLoopSet', () => {
  const SR = 22050;
  /** An A B A arrangement at 120 bpm (one bar = 2 s), with a little silence first, plus hats in B. */
  async function song() {
    const { synthLoop } = await import('@shared/dsp/synth');
    const a = synthLoop({ bpm: 120, seconds: 16, sampleRate: SR, chordPcs: [9, 0, 4] });
    const b = synthLoop({ bpm: 120, seconds: 16, sampleRate: SR, chordPcs: [2, 5, 9] });
    for (let i = 0; i < b.length; i++) {
      const t = (i % (SR / 4)) / SR; // a hat every 8th
      b[i] = b[i]! + (t < 0.02 ? (Math.sin(i * 1.7) * 0.3 * (1 - t / 0.02)) : 0);
    }
    const lead = Math.round(SR * 0.5);
    const x = new Float32Array(lead + a.length * 2 + b.length);
    x.set(a, lead); x.set(b, lead + a.length); x.set(a, lead + a.length + b.length);
    return { audio: { sampleRate: SR, channels: [x] }, lead, sec: SR * 16 };
  }

  it('finds distinct, bar-aligned, non-overlapping loops: one per section', async () => {
    const { findLoopSet } = await import('@shared/audio/loopset');
    const { audio, lead, sec } = await song();
    const set = findLoopSet(audio, 120, { bars: 4 });
    expect(set.loops.length).toBeGreaterThanOrEqual(2);
    const bar = SR * 2;
    for (const l of set.loops) {
      const off = ((l.start - lead) % bar + bar) % bar;
      expect(Math.min(off, bar - off)).toBeLessThan(SR * 0.01);
      expect(Math.abs(l.end - l.start - bar * 4)).toBeLessThan(SR * 0.005);
    }
    for (let i = 1; i < set.loops.length; i++) expect(set.loops[i]!.start).toBeGreaterThanOrEqual(set.loops[i - 1]!.end - SR * 0.005);
    const inside = (l: { start: number; end: number }, from: number, to: number) => l.start >= from - SR * 0.01 && l.end <= to + SR * 0.01;
    const inA = set.loops.filter((l) => inside(l, lead, lead + sec) || inside(l, lead + 2 * sec, lead + 3 * sec));
    const inB = set.loops.filter((l) => inside(l, lead + sec, lead + 2 * sec));
    expect(inB.length).toBe(1);
    expect(inA.length).toBe(1); // A comes round twice but is kept once
    expect(inA.length + inB.length).toBe(set.loops.length); // nothing straddles a section change
  });

  it('splits the whole track into consecutive loops in "all" mode', async () => {
    const { findLoopSet } = await import('@shared/audio/loopset');
    const { audio } = await song();
    const set = findLoopSet(audio, 120, { bars: 4, mode: 'all' });
    expect(set.loops.length).toBe(6); // 24 bars of music
    for (let i = 1; i < set.loops.length; i++) expect(Math.abs(set.loops[i]!.start - set.loops[i - 1]!.end)).toBeLessThan(SR * 0.05);
  });
});

describe('whole-track tempo and headers', () => {
  it('refines a slightly wrong tempo against the whole track', async () => {
    const { synthLoop } = await import('@shared/dsp/synth');
    const { findLoopSet } = await import('@shared/audio/loopset');
    const SR = 22050;
    const x = synthLoop({ bpm: 120, seconds: 60, sampleRate: SR, chordPcs: [9, 0, 4] });
    const set = findLoopSet({ sampleRate: SR, channels: [x] }, 121, { bars: 4 });
    expect(Math.abs(set.bpm - 120)).toBeLessThan(0.05);
    // Every loop is the true 4 bars long, not 4 bars at the wrong tempo.
    for (const l of set.loops) expect(Math.abs(l.end - l.start - SR * 8)).toBeLessThan(SR * 0.005);
  });

  it('reads the sample rate of an MP3 behind an ID3 tag, and of Opus', () => {
    const mp3 = new Uint8Array(10 + 20 + 8);
    mp3.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]); // ID3v2.4, 20 byte tag
    mp3.set([0xff, 0xfb, 0x94, 0x64], 30); // MPEG1 layer III, 128 kbps, 48 kHz
    expect(sniffSampleRate(mp3.buffer)).toBe(48000);
    const bare = Uint8Array.of(0xff, 0xf3, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0); // MPEG2 layer III, 22.05 kHz
    expect(sniffSampleRate(bare.buffer)).toBe(22050);
    const opus = new TextEncoder().encode('OggS\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0OpusHead');
    expect(sniffSampleRate(opus.buffer as ArrayBuffer)).toBe(48000);
  });
});

describe('3:2 tempo mistakes', () => {
  it('a loop set given 2/3 of the real tempo finds the real one', async () => {
    const { synthLoop } = await import('@shared/dsp/synth');
    const { findLoopSet } = await import('@shared/audio/loopset');
    const SR = 22050;
    const x = synthLoop({ bpm: 123, seconds: 40, sampleRate: SR, chordPcs: [9, 0, 4] });
    const set = findLoopSet({ sampleRate: SR, channels: [x] }, 82, { bars: 4 });
    expect(Math.abs(set.bpm - 123)).toBeLessThan(0.1);
    expect(set.loops.length).toBeGreaterThan(0);
  });

  it('a "123 BPM" in the name settles a 3:2 detection', async () => {
    const { detectBpm } = await import('@shared/dsp/bpm');
    const SR = 22050;
    // Kicks on every other beat of 123 read as a slower pulse; the name says what it is.
    const x = new Float32Array(SR * 12);
    const beat = (60 / 123) * SR;
    for (let b = 0; b * beat < x.length; b++) for (let i = 0; i < 2000 && b * beat + i < x.length; i++) x[Math.floor(b * beat) + i] = x[Math.floor(b * beat) + i]! + (b % 3 === 0 ? 0.9 : 0.35) * Math.exp(-i / 300) * Math.sin(i / 6);
    expect(detectBpm(x, SR, 12, 123).bpm).toBe(123);
  });
});
