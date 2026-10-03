import { useStore } from '../store';
import { ThemeToggle } from './ThemeToggle';

export function Header() {
  const { api, filters, setFilters, analysisCounts } = useStore();
  const busy = analysisCounts.running + analysisCounts.queued;
  const mac = api.platform === 'darwin';
  return (
    <header className={`drag-region flex h-11 flex-none items-center gap-6 border-b border-line pr-4 ${mac ? 'pl-[88px]' : 'pl-4'}`}>
      <div className="flex w-[136px] flex-none items-baseline gap-2">
        <span className="font-bold tracking-[0.12em]">STACKS</span>
        <span className="text-label text-faint">0.1</span>
      </div>
      <label className="no-drag flex h-7 w-[420px] items-center gap-2 border border-line-strong px-[10px] focus-within:border-accent">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-faint)" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <input
          aria-label="Search samples"
          placeholder="Search name, key, bpm"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value })}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none focus-visible:outline-none"
        />
      </label>
      <div className="flex-1" />
      <div className="flex items-center gap-2 text-label text-muted" role="status" aria-live="polite">
        {busy > 0 && <span className="inline-block h-[6px] w-[6px] bg-accent" aria-hidden="true" />}
        {busy > 0 ? `ANALYSING ${busy}` : 'ALL ANALYSED'}
      </div>
      <ThemeToggle />
    </header>
  );
}
