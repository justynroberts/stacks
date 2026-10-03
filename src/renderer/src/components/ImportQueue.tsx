import { AnimatePresence, motion } from 'framer-motion';
import type { QueueStage } from '@shared/types';
import { useStore } from '../store';

const STAGE: Record<QueueStage, string> = { queued: 'WAITING', downloading: 'DOWNLOADING', unpacking: 'UNPACKING', scanning: 'SCANNING', done: 'DONE', error: 'FAILED' };
const ROW = 'grid h-7 grid-cols-[minmax(0,1fr)_104px_180px_40px] items-center gap-x-4 px-4';

/** Imports in flight. Takes no room when there are none. */
export function ImportQueue() {
  const { queue } = useStore();
  return (
    <section aria-label="Import queue" className={queue.length ? 'flex-none border-t border-line py-1' : 'hidden'}>
      <AnimatePresence initial={false}>
        {queue.slice(0, 3).map((q) => (
          <motion.div key={q.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: 'easeOut' }} className={ROW}>
            <span className="truncate" title={q.error}>{q.error ? `${q.label}: ${q.error}` : q.label}</span>
            <span className={`flex items-center gap-2 text-label font-medium ${q.stage === 'error' ? 'text-fg' : 'text-muted'}`}>
              {q.stage === 'error' && <span className="h-[6px] w-[6px] bg-accent" aria-hidden="true" />}
              {STAGE[q.stage]}
            </span>
            <div className="h-1 bg-line">
              <motion.div
                className={`h-1 ${q.progress < 0 ? 'bg-line-strong' : 'bg-accent'}`}
                animate={{ width: q.progress < 0 ? '100%' : `${Math.round(q.progress * 100)}%` }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              />
            </div>
            <span className="text-right text-label text-muted">{q.progress >= 0 ? `${Math.round(q.progress * 100)}%` : ''}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {queue.length > 3 && <div className="px-4 text-label text-faint">+{queue.length - 3} MORE</div>}
    </section>
  );
}
