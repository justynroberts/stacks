import { AnimatePresence, motion } from 'framer-motion';
import type { QueueStage } from '@shared/types';
import { useStore } from '../store';

const STAGE: Record<QueueStage, string> = { queued: 'WAITING', downloading: 'DOWNLOADING', unpacking: 'UNPACKING', scanning: 'SCANNING', done: 'DONE', error: 'FAILED' };

export function ImportQueue() {
  const { queue, analysisCounts: c } = useStore();
  const analysed = c.total ? Math.round((c.done / c.total) * 100) : 100;
  return (
    <section aria-label="Import queue" className="mx-6 mb-4 mt-3 h-[148px] flex-none overflow-hidden border-t border-line pt-3">
      <h2 className="mb-2 text-label font-medium text-faint">IMPORT QUEUE</h2>

      <div className="grid h-7 grid-cols-[minmax(0,1fr)_120px_200px_40px] items-center gap-x-4">
        <span>Key and BPM</span>
        <span className="text-label text-muted">{c.running + c.queued > 0 ? `${c.running} RUNNING` : 'IDLE'}</span>
        <div className="h-[2px] bg-line"><div className="h-[2px] bg-accent" style={{ width: `${analysed}%` }} /></div>
        <span className="text-right text-muted">{analysed}%</span>
      </div>

      <AnimatePresence initial={false}>
        {queue.slice(0, 3).map((q) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="grid h-7 grid-cols-[minmax(0,1fr)_120px_200px_40px] items-center gap-x-4"
          >
            <span className="truncate" title={q.error}>{q.error ? `${q.label}: ${q.error}` : q.label}</span>
            <span className={`text-label ${q.stage === 'error' ? 'text-accent' : 'text-muted'}`}>{STAGE[q.stage]}</span>
            <div className="h-[2px] bg-line">
              <motion.div
                className={`h-[2px] ${q.progress < 0 ? 'bg-line-strong' : 'bg-accent'}`}
                animate={{ width: q.progress < 0 ? '100%' : `${Math.round(q.progress * 100)}%` }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              />
            </div>
            <span className="text-right text-muted">{q.progress >= 0 ? `${Math.round(q.progress * 100)}%` : ''}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {queue.length > 3 && <div className="text-label text-faint">+{queue.length - 3} more</div>}
    </section>
  );
}
