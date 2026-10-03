import type { Analysis, StacksApi } from '@shared/types';
import { loadForAnalysis } from './decode';
import type { WorkerRequest, WorkerResponse } from './analysis.worker';

export type RunState = 'queued' | 'running' | 'failed';

interface Deps {
  api: StacksApi;
  createWorker: () => Worker;
  nameOf(id: string): string | undefined;
  onDone(id: string, analysis: Analysis): void;
  onChange(): void;
  concurrency?: number;
}

/** Decodes in the page (Web Audio does the heavy lifting off thread) and runs the maths in workers. */
export class AnalysisRunner {
  readonly state = new Map<string, RunState>();
  private pending: string[] = [];
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private active = 0;
  private limit: number;
  private waiting = new Map<string, (r: WorkerResponse) => void>();
  private retired = new WeakSet<Worker>();

  private retire(w: Worker): void {
    this.retired.add(w);
    w.terminate();
    this.workers = this.workers.filter((x) => x !== w);
  }

  constructor(private deps: Deps) {
    this.limit = deps.concurrency ?? 3;
  }

  enqueue(ids: string[], front = false): void {
    const fresh = ids.filter((id) => !this.state.has(id) || this.state.get(id) === 'failed');
    if (!fresh.length) return;
    for (const id of fresh) this.state.set(id, 'queued');
    this.pending = front ? [...fresh, ...this.pending] : [...this.pending, ...fresh];
    this.deps.onChange();
    this.pump();
  }

  /** Move an id to the front, e.g. when the user selects it. */
  bump(id: string): void {
    const i = this.pending.indexOf(id);
    if (i > 0) {
      this.pending.splice(i, 1);
      this.pending.unshift(id);
    }
  }

  get counts(): { queued: number; running: number } {
    let queued = 0, running = 0;
    for (const v of this.state.values()) {
      if (v === 'queued') queued++;
      else if (v === 'running') running++;
    }
    return { queued, running };
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.pending = [];
  }

  private worker(): Worker {
    const w = this.idle.pop();
    if (w) return w;
    const made = this.deps.createWorker();
    made.onmessage = (e: MessageEvent<WorkerResponse>) => {
      this.waiting.get(e.data.id)?.(e.data);
      this.waiting.delete(e.data.id);
    };
    this.workers.push(made);
    return made;
  }

  private pump(): void {
    while (this.active < this.limit && this.pending.length) {
      const id = this.pending.shift()!;
      this.active++;
      this.state.set(id, 'running');
      this.deps.onChange();
      void this.run(id).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const name = this.deps.nameOf(id);
    if (!name) { this.state.delete(id); return; }
    const w = this.worker();
    try {
      const dec = await loadForAnalysis(this.deps.api, id);
      // A worker that never answers would hold this slot for the rest of the session; give up on the file and
      // replace the worker instead.
      const result = await new Promise<WorkerResponse>((resolve) => {
        const timer = setTimeout(() => {
          this.waiting.delete(id);
          this.retire(w);
          resolve({ id, error: 'timed out' });
        }, 60_000);
        this.waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
        const req: WorkerRequest = { id, name, mono: dec.mono, sampleRate: dec.sampleRate, durationSec: dec.durationSec };
        w.postMessage(req, [dec.mono.buffer]);
      });
      if ('error' in result) throw new Error(result.error);
      await this.deps.api.saveAnalysis(id, result.analysis);
      this.state.delete(id);
      this.deps.onDone(id, result.analysis);
    } catch {
      this.state.set(id, 'failed');
      this.deps.onChange();
    } finally {
      if (!this.retired.has(w)) this.idle.push(w);
    }
  }
}
