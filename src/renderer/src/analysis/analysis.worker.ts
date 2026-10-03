import { analyse } from '@shared/dsp/analyse';
import type { Analysis } from '@shared/types';

export interface WorkerRequest { id: string; name: string; mono: Float32Array; sampleRate: number; durationSec: number }
export type WorkerResponse = { id: string; analysis: Analysis } | { id: string; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, name, mono, sampleRate, durationSec } = e.data;
  try {
    const analysis = analyse(mono, sampleRate, durationSec, name);
    (self as unknown as Worker).postMessage({ id, analysis } satisfies WorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};
