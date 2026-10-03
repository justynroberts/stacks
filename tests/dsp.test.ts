import { describe, expect, it } from 'vitest';
import { analyse } from '@shared/dsp/analyse';
import { detectBpm, foldBpm } from '@shared/dsp/bpm';
import { detectKey } from '@shared/dsp/key';
import { synthLoop } from '@shared/dsp/synth';
import { compatibleCamelot, keyInfo } from '@shared/camelot';
import { bpmFromName, buildName, cleanBase } from '@shared/filename';

const SR = 22050;

describe('bpm', () => {
  for (const bpm of [84, 96, 120, 140, 172]) {
    it(`finds ${bpm} bpm from a kick pattern`, () => {
      const x = synthLoop({ bpm, seconds: 12, sampleRate: SR });
      const r = detectBpm(x, SR, 12, null);
      expect(r.bpm).not.toBeNull();
      // Octave errors are the classic failure; accept the double/half only if the name hint would fix it.
      const ratio = r.bpm! / bpm;
      expect([1, 2, 0.5].some((m) => Math.abs(ratio - m) < 0.03)).toBe(true);
    });
  }
  it('lands on the exact tempo for 120 bpm', () => {
    const x = synthLoop({ bpm: 120, seconds: 12, sampleRate: SR });
    expect(detectBpm(x, SR, 12, null).bpm).toBeCloseTo(120, 0);
  });
  it('trusts a tempo in the file name when it agrees with the audio', () => {
    const x = synthLoop({ bpm: 172, seconds: 8, sampleRate: SR });
    expect(detectBpm(x, SR, 8, 172).bpm).toBe(172);
  });
  it('finds no tempo in a sustained pad or in noise', () => {
    const pad = synthLoop({ bpm: 100, seconds: 9.6, sampleRate: SR, chordPcs: [9, 0, 4], kick: false });
    expect(detectBpm(pad, SR, 9.6, null).bpm).toBeNull();
    let s = 3;
    const noise = new Float32Array(SR * 6).map(() => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.3);
    expect(detectBpm(noise, SR, 6, null).bpm).toBeNull();
  });
  it('returns no tempo for a sub second one shot', () => {
    const x = synthLoop({ bpm: 120, seconds: 0.4, sampleRate: SR, kick: true });
    expect(detectBpm(x, SR, 0.4, null).bpm).toBeNull();
  });
});

describe('key', () => {
  const cases: Array<[string, number[], string, string]> = [
    ['A minor', [9, 0, 4], 'Am', '8A'],
    ['C major', [0, 4, 7], 'C', '8B'],
    ['F minor', [5, 8, 0], 'Fm', '4A'],
    ['D major', [2, 6, 9], 'D', '10B']
  ];
  for (const [label, pcs, short, cam] of cases) {
    it(`hears ${label}`, () => {
      const x = synthLoop({ bpm: 90, seconds: 4, sampleRate: SR, chordPcs: pcs, kick: false });
      const r = detectKey(x, SR);
      expect(r.keyShort).toBe(short);
      expect(r.camelot).toBe(cam);
      expect(r.conf).toBeGreaterThan(0.3);
    });
  }
  for (const [label, pcs, short] of [['A minor', [9, 0, 4], 'Am'], ['G major', [7, 11, 2], 'G'], ['E minor', [4, 7, 11], 'Em']] as Array<[string, number[], string]>) {
    it(`still hears ${label} with a kick on every beat`, () => {
      const x = synthLoop({ bpm: 120, seconds: 8, sampleRate: SR, chordPcs: pcs, kick: true });
      expect(detectKey(x, SR).keyShort).toBe(short);
    });
  }
  it('calls noise unpitched', () => {
    let s = 7;
    const x = new Float32Array(SR * 2).map(() => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; });
    expect(detectKey(x, SR).key).toBeUndefined();
  });
});

describe('analyse', () => {
  it('reads a loop end to end', () => {
    const x = synthLoop({ bpm: 120, seconds: 8, sampleRate: SR, chordPcs: [9, 0, 4] });
    const a = analyse(x, SR, 8, 'rhodes_loop_dusty.wav');
    expect(a.kind).toBe('loop');
    expect(a.bpm).toBeCloseTo(120, 0);
    expect(a.camelot).toBe('8A');
    expect(a.peaks).toHaveLength(96);
  });
  it('reports a 172 bpm break at half time, folded into 70-140', () => {
    const x = synthLoop({ bpm: 172, seconds: 8, sampleRate: SR });
    expect(analyse(x, SR, 8, 'amen_break_172.wav').bpm).toBe(86);
  });
  it('leaves a short unpitched hit without bpm or key', () => {
    const x = new Float32Array(SR * 0.2);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * Math.exp(-i / 800);
    const a = analyse(x, SR, 0.2, 'hat_closed_tight_12.wav');
    expect(a.kind).toBe('shot');
    expect(a.bpm).toBeNull();
  });
});

describe('foldBpm', () => {
  it('halves above 140 and doubles below 70', () => {
    expect(foldBpm(172)).toBe(86);
    expect(foldBpm(290)).toBe(72.5);
    expect(foldBpm(141)).toBe(70.5);
    expect(foldBpm(140)).toBe(140);
    expect(foldBpm(70)).toBe(70);
    expect(foldBpm(69)).toBe(138);
    expect(foldBpm(60)).toBe(120);
    expect(foldBpm(32)).toBe(128);
    expect(foldBpm(null)).toBeNull();
  });
});

describe('camelot', () => {
  it('maps keys', () => {
    expect(keyInfo(9, true).camelot).toBe('8A');
    expect(keyInfo(3, false).camelot).toBe('5B');
    expect(keyInfo(1, true).keyShort).toBe('C#m');
  });
  it('lists mixable neighbours with wraparound', () => {
    const c = compatibleCamelot('12A');
    expect([...c.keys()].sort()).toEqual(['11A', '12A', '12B', '1A']);
    expect(c.get('12A')).toBe('self');
  });
});

describe('filenames', () => {
  it('finds a tempo in a name', () => {
    expect(bpmFromName('bass_reese_loop_140.wav')).toBe(140);
    expect(bpmFromName('amen_break_chopped_172.wav')).toBe(172);
    expect(bpmFromName('drums 98bpm.wav')).toBe(98);
    expect(bpmFromName('808_sub_glide_F.wav')).toBeNull();
    expect(bpmFromName('hat_closed_tight_12.wav')).toBeNull();
  });
  it('builds the tagged name and stays idempotent', () => {
    // Tags go at the end, so the name still sorts where it did.
    expect(buildName('rhodes_loop_dusty_Am.wav', 84, 'Am')).toBe('rhodes_loop_dusty_Am_84bpm.wav');
    expect(buildName('rhodes_loop_dusty_Am_84bpm.wav', 84, 'Am')).toBe('rhodes_loop_dusty_Am_84bpm.wav');
    expect(buildName('808_sub_glide_F.wav', null, 'F')).toBe('808_sub_glide_F.wav');
    expect(buildName('bass_reese_loop_140.wav', 140, 'Gm')).toBe('bass_reese_loop_Gm_140bpm.wav');
    expect(buildName('amen_break_172.wav', 86, null)).toBe('amen_break_86bpm.wav');
    expect(buildName('kick_01.wav', 120, null)).toBe('kick_01_120bpm.wav');
    expect(buildName('hat.wav', null, null)).toBeNull();
    // Names from the older prefix format are moved over.
    expect(buildName('084_Am_rhodes_loop_dusty.wav', 84, 'Am')).toBe('rhodes_loop_dusty_Am_84bpm.wav');
    expect(buildName('F_808_sub_glide.wav', null, 'F')).toBe('808_sub_glide_F.wav');
    expect(buildName('120_drums_tight.wav', 120, null)).toBe('drums_tight_120bpm.wav');
    expect(cleanBase('bass_reese_loop_140.wav', 140)).toBe('bass_reese_loop');
    expect(cleanBase('kick_01.wav', 120)).toBe('kick_01');
  });
});
