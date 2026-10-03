import { fmtBytes } from '../filters';
import { useStore } from '../store';

function LibraryItem({ label, count, active, onClick, hot }: { label: string; count: number; active: boolean; onClick: () => void; hot?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full justify-between border-l-2 py-[6px] pl-[14px] pr-4 hover:bg-raised ${active ? 'border-accent bg-sel' : 'border-transparent'}`}
    >
      <span>{label}</span>
      <span className={hot && count > 0 ? 'text-accent' : 'text-faint'}>{count.toLocaleString()}</span>
    </button>
  );
}

const KIND_LABEL: Record<string, string> = { sd: 'SD card', 'usb-ssd': 'USB SSD', 'usb-hdd': 'USB HDD', external: 'External', internal: 'Internal' };

export function Sidebar() {
  const { drives, filters, setFilters, perDrive, totals, api } = useStore();
  const shown = drives.filter((d) => d.id !== 'local' || (perDrive.get('local') ?? 0) > 0);
  const all = filters.drive === 'all' && filters.kind === 'all' && !filters.needsMeta;
  return (
    <aside className="flex w-[248px] flex-none flex-col gap-6 overflow-hidden border-r border-line py-4" aria-label="Library and drives">
      <nav aria-label="Library">
        <h2 className="px-4 pb-2 text-label font-medium text-faint">LIBRARY</h2>
        <LibraryItem label="All samples" count={totals.all} active={all} onClick={() => setFilters({ drive: 'all', kind: 'all', needsMeta: false })} />
        <LibraryItem label="Loops" count={totals.loops} active={filters.kind === 'loop'} onClick={() => setFilters({ kind: filters.kind === 'loop' ? 'all' : 'loop' })} />
        <LibraryItem label="One shots" count={totals.shots} active={filters.kind === 'shot'} onClick={() => setFilters({ kind: filters.kind === 'shot' ? 'all' : 'shot' })} />
        <LibraryItem label="Needs key / BPM" count={totals.needs} hot active={filters.needsMeta} onClick={() => setFilters({ needsMeta: !filters.needsMeta })} />
      </nav>
      <nav aria-label="Drives" className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="px-4 pb-2 text-label font-medium text-faint">DRIVES</h2>
        {shown.map((d) => {
          const active = filters.drive === d.id;
          const pct = d.totalBytes ? Math.round((d.usedBytes / d.totalBytes) * 100) : 0;
          return (
            <div key={d.id} className={`group relative border-l-2 hover:bg-raised ${active ? 'border-accent bg-sel' : 'border-transparent'} ${d.mounted ? '' : 'opacity-60'}`}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setFilters({ drive: active ? 'all' : d.id })}
                className="block w-full py-2 pb-[10px] pl-[14px] pr-4"
              >
                <span className="flex justify-between gap-2">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="text-faint">{(perDrive.get(d.id) ?? 0).toLocaleString()}</span>
                </span>
                <span className="mt-[2px] flex justify-between text-label text-faint">
                  <span>{d.mounted ? KIND_LABEL[d.kind] : 'OFFLINE'}</span>
                  <span>{d.totalBytes ? `${fmtBytes(d.usedBytes)} / ${fmtBytes(d.totalBytes)}` : ''}</span>
                </span>
                {d.totalBytes > 0 && (
                  <span className="mt-2 block h-[2px] bg-line" role="presentation">
                    <span className="block h-[2px] bg-muted" style={{ width: `${pct}%` }} />
                  </span>
                )}
              </button>
              {d.mounted && d.id !== 'local' && (
                <button
                  type="button"
                  aria-label={`Rescan ${d.name}`}
                  onClick={() => void api.scanDrive(d.id)}
                  className="absolute right-[10px] top-[30px] hidden h-5 w-5 items-center justify-center text-faint hover:text-fg focus-visible:flex group-hover:flex"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                    <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </nav>
      <p className="border-t border-line px-4 pt-3 text-label leading-relaxed text-faint">
        SD cards and drives are picked up the moment they mount. Nothing is copied or changed until you say so.
      </p>
    </aside>
  );
}
