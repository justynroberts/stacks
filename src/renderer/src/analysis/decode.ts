import { readWav } from '@shared/audio/wav';
import { ANALYSIS_MAX_SECONDS, ANALYSIS_RATE } from '@shared/dsp/analyse';
import type { StacksApi } from '@shared/types';

export interface Decoded {
  mono: Float32Array;
  sampleRate: number;
  durationSec: number;
}

/**
 * How much of a file analysis reads: 90 s of 48 kHz 24-bit stereo, the most analysis looks at anyway. On a slow USB
 * drive reading only this is the difference between minutes and hours for a big library.
 */
export const HEAD_BYTES = 26 * 1024 * 1024;

/** Mono at the analysis rate, from planar channels at any rate (linear interpolation), at most 90 s. */
function toAnalysisRate(channels: Float32Array[], rate: number): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const ratio = rate / ANALYSIS_RATE;
  const out = new Float32Array(Math.min(Math.floor(frames / ratio), ANALYSIS_RATE * ANALYSIS_MAX_SECONDS));
  const ch = channels.length;
  for (let i = 0; i < out.length; i++) {
    const p = i * ratio;
    const k = Math.floor(p), f = p - k;
    let s = 0;
    for (const c of channels) s += c[k]! + ((c[k + 1] ?? c[k]!) - c[k]!) * f;
    out[i] = s / ch;
  }
  return out;
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

/**
 * Read only the start of the file and decode that. WAV is parsed directly (it copes with a cut-off file); anything
 * else goes through Web Audio, and if a cut-off file will not decode, the whole file is read after all. The duration
 * is scaled from the bytes read to the full size, which is exact for PCM and close for compressed formats.
 */
export async function loadForAnalysis(api: StacksApi, id: string): Promise<Decoded> {
  const { bytes, total } = await api.readHead(id, HEAD_BYTES);
  const cut = total > bytes.byteLength;
  const scale = cut ? total / bytes.byteLength : 1;
  const wav = readWav(bytes);
  if (wav && (wav.channels[0]?.length ?? 0) > 0) {
    const seconds = (wav.channels[0]!.length / wav.sampleRate) * scale;
    return { mono: toAnalysisRate(wav.channels, wav.sampleRate), sampleRate: ANALYSIS_RATE, durationSec: seconds };
  }
  try {
    const dec = await decodeMono(bytes);
    return { ...dec, durationSec: dec.durationSec * scale };
  } catch (e) {
    if (!cut) throw e;
    return decodeMono(await api.readFile(id));
  }
}
