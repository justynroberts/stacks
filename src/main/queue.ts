import { randomUUID } from 'node:crypto';
import type { QueueItem } from '@shared/types';

type Patch = Partial<Pick<QueueItem, 'stage' | 'progress' | 'label'>>;

/** Runs import jobs one at a time and reports each job's stage and progress. */
export class JobQueue {
  private items: QueueItem[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(private onChange: (items: QueueItem[]) => void) {}

  add(label: string, job: (update: (p: Patch) => void) => Promise<void>): string {
    const item: QueueItem = { id: randomUUID(), label, stage: 'queued', progress: 0 };
    this.items.push(item);
    this.emit();
    const update = (p: Patch) => {
      Object.assign(item, p);
      this.emit();
    };
    this.chain = this.chain.then(async () => {
      try {
        await job(update);
        update({ stage: 'done', progress: 1 });
      } catch (e) {
        item.error = e instanceof Error ? e.message : String(e);
        update({ stage: 'error' });
      }
      setTimeout(() => {
        this.items = this.items.filter((i) => i.id !== item.id);
        this.emit();
      }, item.stage === 'error' ? 12000 : 5000);
    });
    return item.id;
  }

  private emit(): void {
    this.onChange(this.items.map((i) => ({ ...i })));
  }
}
