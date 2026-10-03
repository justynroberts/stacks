import { fmtLen } from '../filters';
import { useStore } from '../store';
import { AboutButton } from './AboutButton';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

function Cell({ label, value, width, first }: { label: string; value: string; width: string; first?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-3 ${width} ${first ? '' : 'border-l border-inset-line'}`}>
      <span className="text-label font-medium opacity-70">{label}</span>
      <span className="text-readout font-semibold">{value}</span>
    </div>
  );
}

export function Header() {
  const { api, filters, setFilters, analysisCounts, selected } = useStore();
  const busy = analysisCounts.running + analysisCounts.queued;
  const mac = api.platform === 'darwin';
  const a = selected?.analysis;
  return (
    <header className={`drag-region flex h-14 flex-none items-center gap-5 border-b border-line-strong bg-raised pr-3 ${mac ? 'pl-[84px]' : 'pl-4'}`}>
      <div className="w-[112px] flex-none"><Logo /></div>

      {/* The counter: what the selected sample is, read like a transport display. */}
      <div role="group" aria-label="Selected sample readout" className="flex h-12 flex-none items-stretch bg-inset text-lcd">
        <Cell first label="BPM" width="w-[76px]" value={a?.bpm ? String(Math.round(a.bpm)).padStart(3, '0') : '—'} />
        <Cell label="KEY" width="w-[68px]" value={a?.keyShort ?? '—'} />
        <Cell label="CAM" width="w-[60px]" value={a?.camelot ?? '—'} />
        <Cell label="LEN" width="w-[104px]" value={a ? fmtLen(a.durationSec) : '—'} />
      </div>

      <label className="no-drag flex h-8 w-[300px] items-center gap-2 border border-line-strong bg-bg px-[10px] focus-within:border-fg">
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
      <div className="flex items-center gap-2 text-label font-medium text-muted" role="status" aria-live="polite">
        <span className={`inline-block h-2 w-2 ${busy > 0 ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />
        {busy > 0 ? `ANALYSING ${busy}` : 'ALL ANALYSED'}
      </div>
      <div className="flex items-center border-l border-line pl-2">
        <ThemeToggle />
        <AboutButton />
      </div>
    </header>
  );
}
