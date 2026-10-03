import { frameCount, type PcmAudio } from '@shared/audio/wav';

const defaultContext = (rate: number): AudioContext => {
  try { return new AudioContext({ sampleRate: rate }); } catch { return new AudioContext(); }
};

/** How far ahead loop passes are queued. Long enough to survive a busy main thread, short enough to feel live. */
const LOOKAHEAD = 0.25;
const TICK_MS = 25;

interface Pass {
  src: AudioBufferSourceNode;
  /** Context time it starts. */
  at: number;
  from: number;
  to: number;
}

/**
 * Plays a stretch of the edit buffer through Web Audio and reports where it is.
 *
 * A loop is played as a chain of single passes, each its own source scheduled sample-accurately at the end of the
 * one before, a short way ahead of time. A pass's end is a stop time, not a fixed duration, so it can move either
 * way. When the loop changes, the new end is honoured as soon as the playhead reaches it, in the pass that is
 * playing (an end pulled in behind the playhead wraps at once), and the new start is where the next pass begins.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private cache = new WeakMap<PcmAudio, AudioBuffer>();
  private audio: PcmAudio | null = null;
  private onEnd: (() => void) | null = null;
  private rate = 44100;
  private passes: Pass[] = [];
  private looping = false;
  private loopFrom = 0;
  private loopTo = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private makeContext: (rate: number) => AudioContext = defaultContext, private autoTick = true) {}

  get available(): boolean {
    return typeof AudioContext !== 'undefined' || this.makeContext !== defaultContext;
  }

  get playing(): boolean {
    return this.passes.length > 0;
  }

  private buffer(ctx: AudioContext, a: PcmAudio): AudioBuffer {
    let b = this.cache.get(a);
    if (!b) {
      b = ctx.createBuffer(a.channels.length, Math.max(1, frameCount(a)), a.sampleRate);
      a.channels.forEach((ch, c) => b!.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      this.cache.set(a, b);
    }
    return b;
  }

  /**
   * Frames [from, to), once or as a loop. The first pass can begin part way in, at startAt (a loop over the whole
   * sample started from the cursor). onEnd fires when playback runs out on its own.
   */
  play(a: PcmAudio, from: number, to: number, loop: boolean, onEnd: () => void, startAt = from): void {
    this.stop();
    if (!this.available || to - from < 1) return;
    if (!this.ctx || this.ctx.sampleRate !== a.sampleRate) {
      void this.ctx?.close();
      this.ctx = this.makeContext(a.sampleRate);
    }
    void this.ctx.resume();
    this.audio = a;
    this.onEnd = onEnd;
    this.rate = a.sampleRate;
    this.looping = loop;
    this.loopFrom = from;
    this.loopTo = to;
    this.passes.push(this.schedule(this.ctx.currentTime, Math.max(from, Math.min(startAt, to - 1)), to));
    if (this.autoTick) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private schedule(at: number, from: number, to: number): Pass {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(ctx, this.audio!);
    src.connect(ctx.destination);
    src.start(at, from / this.rate);
    src.stop(at + (to - from) / this.rate);
    const pass: Pass = { src, at, from, to };
    src.onended = () => this.ended(pass);
    return pass;
  }

  private endOf(p: Pass): number {
    return p.at + (p.to - p.from) / this.rate;
  }

  private cancel(p: Pass): void {
    p.src.onended = null;
    try { p.src.stop(); } catch { /* never started, or already stopped */ }
  }

  private ended(p: Pass): void {
    this.passes = this.passes.filter((x) => x !== p);
    if (this.passes.length === 0) this.finish();
  }

  private finish(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }

  /** Keep the queue of loop passes topped up. Public so tests can drive the clock. */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.passes.length) return;
    const now = ctx.currentTime;
    // Forget passes that are over (their onended may not have arrived yet), but always keep the latest one.
    while (this.passes.length > 1 && this.endOf(this.passes[0]!) <= now) this.passes.shift();
    if (!this.looping) return;
    let last = this.passes[this.passes.length - 1]!;
    while (this.endOf(last) < now + LOOKAHEAD) {
      last = this.schedule(this.endOf(last), this.loopFrom, this.loopTo);
      this.passes.push(last);
    }
  }

  /** The pass playing right now, or the first queued one. */
  private current(): Pass | undefined {
    const now = this.ctx?.currentTime ?? 0;
    return this.passes.find((p) => p.at <= now && now < this.endOf(p)) ?? this.passes[0];
  }

  /** Drop every pass that has not started yet. */
  private dropFuture(): void {
    const now = this.ctx?.currentTime ?? 0;
    const cur = this.current();
    this.passes = this.passes.filter((p) => {
      if (p === cur || p.at <= now) return true;
      this.cancel(p);
      return false;
    });
  }

  /**
   * New loop points. The pass that is playing now ends at the new end when it gets there (or right away if the
   * playhead is already past it); the next pass starts at the new start.
   */
  updateLoop(from: number, to: number): void {
    if (to - from < 1 || (from === this.loopFrom && to === this.loopTo)) return;
    this.loopFrom = from;
    this.loopTo = to;
    if (!this.playing || !this.looping || !this.ctx) return;
    this.dropFuture();
    const cur = this.current();
    const now = this.ctx.currentTime;
    if (cur && cur.at <= now) {
      const pos = cur.from + (now - cur.at) * this.rate;
      cur.to = pos < to ? to : Math.max(cur.from, pos);
      cur.src.stop(cur.at + (cur.to - cur.from) / this.rate);
    }
    this.tick();
  }

  /** Turn looping on or off without stopping: on loops [from, to) after this pass; off ends after this pass. */
  setLooping(on: boolean, from: number, to: number): void {
    if (!this.playing || on === this.looping) return;
    this.looping = on;
    if (on) {
      if (to - from < 1) { this.looping = false; return; }
      this.loopFrom = from;
      this.loopTo = to;
    }
    this.dropFuture();
    this.tick();
  }

  stop(): void {
    for (const p of this.passes) this.cancel(p);
    this.passes = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onEnd = null;
  }

  /** Current frame, or null when stopped. */
  position(): number | null {
    if (!this.ctx || !this.passes.length) return null;
    const now = this.ctx.currentTime;
    const p = this.current()!;
    if (now < p.at) return p.from;
    return Math.min(p.to, p.from + (now - p.at) * this.rate);
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
