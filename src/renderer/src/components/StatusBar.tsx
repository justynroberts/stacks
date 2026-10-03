import { useStore } from '../store';

export function StatusBar() {
  const { mounted, demo, notice, visible, samples, analysisCounts: c } = useStore();
  const analysed = c.total ? Math.round((c.done / c.total) * 100) : 100;
  return (
    <footer className="flex h-7 flex-none items-center gap-5 border-t border-line-strong bg-raised px-4 text-label font-medium text-faint">
      <span className="min-w-0 flex-1 truncate" role="status" aria-live="polite">
        {notice ? (
          <span className={notice.error ? 'font-semibold text-fg' : 'text-muted'}>
            {notice.error && <span className="mr-2 inline-block h-[6px] w-[6px] bg-accent align-middle" aria-hidden="true" />}
            {notice.text}
          </span>
        ) : demo ? 'DEMO MODE · sample data, nothing touches your disk' : mounted.length ? `${mounted.map((d) => d.name).join(' · ')} mounted` : 'No external drives connected'}
      </span>
      <span className="flex items-center gap-2" title="Samples with key and BPM read">
        KEY / BPM
        <span className="block h-1 w-20 bg-line" aria-hidden="true"><span className="block h-1 bg-accent" style={{ width: `${analysed}%` }} /></span>
        <span className="w-8 text-muted">{analysed}%</span>
      </span>
      <span aria-live="polite">{visible.length.toLocaleString()} / {samples.length.toLocaleString()} SHOWN</span>
      <span className="hidden xl:inline">SPACE PREVIEWS · DRAG A ROW INTO YOUR DAW</span>
    </footer>
  );
}
