import { ANALYSIS_MAX_SECONDS, ANALYSIS_RATE } from '@shared/dsp/analyse';

export interface Decoded {
  mono: Float32Array;
  sampleRate: number;
  durationSec: number;
}

/** Decode any format Chromium understands, resampled to the analysis rate and folded to mono. */
export async function decodeMono(bytes: ArrayBuffer): Promise<Decoded> {
  const ctx = new OfflineAudioContext(1, ANALYSIS_RATE, ANALYSIS_RATE);
  const buf = await ctx.decodeAudioData(bytes);
  const frames = Math.min(buf.length, ANALYSIS_RATE * ANALYSIS_MAX_SECONDS);
  const mono = new Float32Array(frames);
  const ch = buf.numberOfChannels;
  for (let c = 0; c < ch; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i] = mono[i]! + data[i]! / ch;
  }
  return { mono, sampleRate: buf.sampleRate, durationSec: buf.duration };
}
