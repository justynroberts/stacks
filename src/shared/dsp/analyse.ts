import { ANALYSIS_VERSION, type Analysis } from '../types';
import { bpmFromName } from '../filename';
import { detectBpm, foldBpm } from './bpm';
import { detectKey } from './key';
import { computePeaks } from './peaks';

export const ANALYSIS_RATE = 22050;
/** Seconds of audio the detectors look at. Peaks cover the same span. */
export const ANALYSIS_MAX_SECONDS = 90;

export function analyse(mono: Float32Array, sampleRate: number, durationSec: number, fileName: string): Analysis {
  const hint = bpmFromName(fileName);
  const isLoopName = /loop|break|riff|pad|chords|arp/i.test(fileName);
  const bpm = detectBpm(mono, sampleRate, durationSec, hint);
  const key = detectKey(mono, sampleRate);

  const loop = durationSec >= 1.5 || isLoopName;
  const keepBpm = bpm.bpm !== null && bpm.conf >= 0.3 && (loop || hint !== null);

  return {
    version: ANALYSIS_VERSION,
    bpm: keepBpm ? foldBpm(bpm.bpm) : null,
    bpmConf: keepBpm ? bpm.conf : 0,
    key: key.key ?? null,
    keyShort: key.keyShort ?? null,
    camelot: key.camelot ?? null,
    keyConf: key.key ? key.conf : 0,
    durationSec,
    kind: loop ? 'loop' : 'shot',
    peaks: computePeaks(mono),
    analysedAt: Date.now()
  };
}
