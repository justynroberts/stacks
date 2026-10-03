import { type PcmAudio, readWav, sniffSampleRate, type WavFormat } from '@shared/audio/wav';

export interface Loaded {
  audio: PcmAudio;
  /** What a save writes: the source's own WAV format, or 24-bit PCM for anything that was not WAV. */
  format: WavFormat;
  sourceIsWav: boolean;
}

/**
 * WAV is read directly, sample for sample at its own rate and depth. Everything else goes through Web Audio,
 * decoded at the rate the header declares so nothing is resampled where that can be avoided.
 */
export async function decodeForEdit(bytes: ArrayBuffer): Promise<Loaded> {
  const wav = readWav(bytes);
  if (wav) return { audio: { sampleRate: wav.sampleRate, channels: wav.channels }, format: wav.format, sourceIsWav: true };
  if (typeof OfflineAudioContext === 'undefined') throw new Error('This format needs Web Audio to decode');
  const rate = sniffSampleRate(bytes) ?? 44100;
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(bytes);
  const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
  return { audio: { sampleRate: buf.sampleRate, channels }, format: { bits: 24, float: false }, sourceIsWav: false };
}
