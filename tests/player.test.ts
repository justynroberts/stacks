import { describe, expect, it } from 'vitest';
import { Player } from '@/editor/player';

interface FakeSource { when?: number; offset?: number; stops: number[]; onended: (() => void) | null }

/** Just enough of Web Audio to drive the Player, with a clock the test moves by hand. */
function fakeAudio(rate = 1000) {
  const sources: FakeSource[] = [];
  const ctx = {
    currentTime: 0,
    sampleRate: rate,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    createBuffer: () => ({ copyToChannel() {} }),
    createBufferSource: () => {
      const s: FakeSource & Record<string, unknown> = {
        stops: [],
        onended: null,
        connect() {},
        // stop() with no time is a cancel; the last stop time wins, as in Web Audio.
        start(when: number, offset: number) { s.when = when; s.offset = offset; },
        stop(when?: number) { s.stops.push(when ?? -1); }
      };
      sources.push(s);
      return s;
    }
  };
  const player = new Player(() => ctx as unknown as AudioContext, false);
  const at = (t: number) => { ctx.currentTime = t; player.tick(); };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  /** Passes that will actually sound: [start time, first frame, last frame]. */
  const live = () => sources
    .filter((s) => s.stops.at(-1) !== -1)
    .map((s) => [r(s.when!), r(s.offset! * rate), r((s.offset! + s.stops.at(-1)! - s.when!) * rate)]);
  return { sources, player, at, live };
}

const audio = { sampleRate: 1000, channels: [new Float32Array(10_000)] };

describe('Player loops', () => {
  it('chains passes back to back, a little ahead of time', () => {
    const { player, at, live } = fakeAudio();
    player.play(audio, 1000, 2000, true, () => undefined);
    expect(live()).toEqual([[0, 1000, 2000]]);
    at(0.8);
    expect(live()).toEqual([[0, 1000, 2000], [1, 1000, 2000]]);
    at(1.2);
    expect(player.position()).toBe(1200);
  });

  it('wraps at a new end pulled in ahead of the playhead, in this pass', () => {
    const { player, at, live } = fakeAudio();
    player.play(audio, 1000, 2000, true, () => undefined);
    at(0.3); // at 1300
    player.updateLoop(1000, 1600);
    expect(live()).toEqual([[0, 1000, 1600]]);
    at(0.4); // inside the queue-ahead window now
    expect(live()).toEqual([[0, 1000, 1600], [0.6, 1000, 1600]]);
    at(0.65);
    expect(player.position()).toBe(1050);
  });

  it('plays on to a new end pushed out, in this pass', () => {
    const { player, at, live } = fakeAudio();
    player.play(audio, 1000, 2000, true, () => undefined);
    at(0.9); // next pass already queued at t = 1
    player.updateLoop(1000, 2500);
    expect(live()).toEqual([[0, 1000, 2500]]);
    at(1.4);
    expect(player.position()).toBe(2400);
    expect(live()).toEqual([[0, 1000, 2500], [1.5, 1000, 2500]]);
  });

  it('wraps at once when the end is pulled in behind the playhead', () => {
    const { player, at, live } = fakeAudio();
    player.play(audio, 1000, 2000, true, () => undefined);
    at(0.8); // at 1800
    player.updateLoop(1000, 1500);
    expect(live()).toEqual([[0, 1000, 1800], [0.8, 1000, 1500]]);
    at(0.9);
    expect(player.position()).toBe(1100);
  });

  it('starts the next pass at a moved start', () => {
    const { player, at } = fakeAudio();
    player.play(audio, 1000, 2000, true, () => undefined);
    at(0.5);
    player.updateLoop(1200, 2000);
    at(0.9);
    at(1.1);
    expect(player.position()).toBe(1300);
  });

  it('keeps very short loops gapless by queuing several passes', () => {
    const { player, at, live } = fakeAudio();
    player.play(audio, 1000, 1050, true, () => undefined); // 50 ms
    at(0);
    const q = live();
    expect(q.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < q.length; i++) expect(q[i]![0]).toBeCloseTo(q[i - 1]![0]! + 0.05, 6);
  });

  it('turns looping on after the current pass, and off by finishing it', () => {
    const { sources, player, at, live } = fakeAudio();
    let ended = 0;
    player.play(audio, 1000, 2000, false, () => { ended++; });
    at(0.9);
    expect(live()).toHaveLength(1);
    player.setLooping(true, 1000, 2000);
    expect(live()).toEqual([[0, 1000, 2000], [1, 1000, 2000]]);
    at(1.5);
    player.setLooping(false, 1000, 2000);
    at(1.9);
    expect(live().filter(([t]) => t! > 1.5)).toEqual([]);
    for (const s of sources.filter((x) => x.stops.at(-1) !== -1)) s.onended?.();
    expect(ended).toBe(1);
    expect(player.playing).toBe(false);
  });
});
