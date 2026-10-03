import { useEffect, useMemo, useState } from 'react';
import type { Drive } from '@shared/types';
import { fmtBytes, folderTree, type FolderNode } from '../filters';
import { useStore } from '../store';

const KIND_LABEL: Record<string, string> = { sd: 'SD CARD', 'usb-ssd': 'USB SSD', 'usb-hdd': 'USB HDD', external: 'EXTERNAL', internal: 'INTERNAL' };

const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="flex h-7 items-center justify-between px-4 text-label font-semibold text-faint">{children}</h2>
);

function LibraryItem({ label, count, active, onClick, hot }: { label: string; count: number; active: boolean; onClick: () => void; hot?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-7 w-full items-center justify-between border-l-[3px] pl-[13px] pr-4 ${active ? 'border-accent bg-sel font-semibold' : 'border-transparent hover:bg-sel'}`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2 text-faint">
        {hot && count > 0 && <span className="h-[6px] w-[6px] bg-accent" aria-hidden="true" />}
        {count.toLocaleString()}
      </span>
    </button>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={d} /></svg>
);
const RESCAN = 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5';
const EXCLUDE = 'M2 2l12 12M6.6 4.2A6.6 6.6 0 0 1 8 4c3.5 0 5.8 3.2 6.3 4-.25.4-.9 1.35-1.9 2.2M4.5 5.3C3 6.3 2 7.6 1.7 8c.5.8 2.8 4 6.3 4 1 0 1.9-.25 2.7-.65';

/** One folder in the tree: a chevron to open it (when it has folders inside), and the folder itself to filter by. */
function Folder({ node, depth, open, toggle }: { node: FolderNode; depth: number; open: Set<string>; toggle(path: string, to?: boolean): void }) {
  const { filters, setFilters } = useStore();
  const active = filters.folder === node.path;
  const isOpen = open.has(node.path);
  const hasKids = node.children.length > 0;
  return (
    <li role="treeitem" aria-expanded={hasKids ? isOpen : undefined} aria-selected={active}>
      <div className={`flex h-7 items-center pr-4 ${active ? 'bg-fg text-bg' : 'hover:bg-sel'}`} style={{ paddingLeft: 13 + depth * 12 }}>
        <button
          type="button"
          tabIndex={hasKids ? 0 : -1}
          aria-label={hasKids ? `${isOpen ? 'Close' : 'Open'} ${node.name}` : undefined}
          aria-hidden={hasKids ? undefined : true}
          onClick={() => hasKids && toggle(node.path)}
          className={`flex h-7 w-4 flex-none items-center justify-center ${hasKids ? '' : 'invisible'}`}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className={isOpen ? 'rotate-90' : ''}><path d="M2 1l4 3-4 3z" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          title={node.path}
          onClick={() => { setFilters({ folder: active ? '' : node.path }); if (!active && hasKids) toggle(node.path, true); }}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 pl-1 text-left"
        >
          <span className="truncate">{node.name}</span>
          <span className={`flex-none text-label ${active ? '' : 'text-faint'}`}>{node.count.toLocaleString()}</span>
        </button>
      </div>
      {hasKids && isOpen && (
        <ul role="group">
          {node.children.map((c) => <Folder key={c.path} node={c} depth={depth + 1} open={open} toggle={toggle} />)}
        </ul>
      )}
    </li>
  );
}

/** The folders of the selected drive, as they are on disk. */
function FolderTree({ driveId, name }: { driveId: string; name: string }) {
  const { samples, filters } = useStore();
  const tree = useMemo(() => folderTree(samples, driveId), [samples, driveId]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // A folder chosen from the list opens the tree down to it.
  useEffect(() => {
    if (!filters.folder) return;
    const parts = filters.folder.split('/');
    setOpen((o) => {
      const n = new Set(o);
      for (let i = 1; i <= parts.length; i++) n.add(parts.slice(0, i).join('/'));
      return n;
    });
  }, [filters.folder]);
  const toggle = (path: string, to?: boolean) => setOpen((o) => {
    const n = new Set(o);
    if (to ?? !n.has(path)) n.add(path); else n.delete(path);
    return n;
  });
  if (!tree.length) return null;
  return (
    <ul role="tree" aria-label={`Folders on ${name}`} className="pb-2">
      {tree.map((n) => <Folder key={n.path} node={n} depth={0} open={open} toggle={toggle} />)}
    </ul>
  );
}

function DriveRow({ d, count }: { d: Drive; count: number }) {
  const { filters, setFilters, api, setExcluded } = useStore();
  const active = filters.drive === d.id;
  const pct = d.totalBytes ? Math.round((d.usedBytes / d.totalBytes) * 100) : 0;
  const external = d.id !== 'local';
  return (
    <div className={`group relative border-l-[3px] ${active ? 'border-accent bg-sel' : 'border-transparent hover:bg-sel'}`}>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => setFilters({ drive: active ? 'all' : d.id, folder: '' })}
        className="block w-full py-2 pl-[13px] pr-4"
      >
        <span className="flex justify-between gap-2">
          <span className={`truncate ${active ? 'font-bold' : 'font-semibold'}`}>{d.name}</span>
          <span className="text-faint">{count.toLocaleString()}</span>
        </span>
        <span className="mt-[2px] flex justify-between text-label text-faint">
          <span>{d.mounted ? KIND_LABEL[d.kind] : 'OFFLINE'}</span>
          <span>{d.totalBytes ? `${fmtBytes(d.usedBytes)} / ${fmtBytes(d.totalBytes)}` : ''}</span>
        </span>
        {d.totalBytes > 0 && (
          <span className="mt-[6px] block h-1 bg-line" role="presentation">
            <span className={`block h-1 ${pct > 90 ? 'bg-accent' : 'bg-muted'}`} style={{ width: `${pct}%` }} />
          </span>
        )}
      </button>
      {external && (
        <span className="absolute right-2 top-[6px] hidden gap-px bg-sel group-focus-within:flex group-hover:flex">
          {d.mounted && (
            <button type="button" aria-label={`Rescan ${d.name}`} title="Rescan" onClick={() => void api.scanDrive(d.id)} className="flex h-6 w-6 items-center justify-center text-muted hover:text-fg">
              <Icon d={RESCAN} />
            </button>
          )}
          <button
            type="button"
            aria-label={`Exclude ${d.name}`}
            title="Exclude: stop scanning this drive and hide its samples"
            onClick={() => { if (active) setFilters({ drive: 'all', folder: '' }); void setExcluded(d.id, true); }}
            className="flex h-6 w-6 items-center justify-center text-muted hover:text-fg"
          >
            <Icon d={EXCLUDE} />
          </button>
        </span>
      )}
    </div>
  );
}

export function Sidebar() {
  const { drives, filters, setFilters, perDrive, totals, setExcluded } = useStore();
  const shown = drives.filter((d) => !d.excluded && (d.id !== 'local' || (perDrive.get('local') ?? 0) > 0));
  const excluded = drives.filter((d) => d.excluded);
  const all = filters.drive === 'all' && filters.kind === 'all' && !filters.needsMeta && !filters.folder;
  return (
    <aside className="flex w-[240px] flex-none flex-col overflow-hidden border-r border-line-strong bg-raised pt-2" aria-label="Library and drives">
      <nav aria-label="Library" className="pb-3">
        <Heading>COLLECTIONS</Heading>
        <LibraryItem label="All samples" count={totals.all} active={all} onClick={() => setFilters({ drive: 'all', kind: 'all', needsMeta: false, folder: '' })} />
        <LibraryItem label="Loops" count={totals.loops} active={filters.kind === 'loop'} onClick={() => setFilters({ kind: filters.kind === 'loop' ? 'all' : 'loop' })} />
        <LibraryItem label="One shots" count={totals.shots} active={filters.kind === 'shot'} onClick={() => setFilters({ kind: filters.kind === 'shot' ? 'all' : 'shot' })} />
        <LibraryItem label="Needs key / BPM" count={totals.needs} hot active={filters.needsMeta} onClick={() => setFilters({ needsMeta: !filters.needsMeta })} />
      </nav>
      <nav aria-label="Drives" className="min-h-0 flex-1 overflow-y-auto border-t border-line pt-2">
        <Heading>PLACES</Heading>
        {shown.map((d) => (
          <div key={d.id}>
            <DriveRow d={d} count={perDrive.get(d.id) ?? 0} />
            {filters.drive === d.id && <FolderTree driveId={d.id} name={d.name} />}
          </div>
        ))}
        {shown.length === 0 && <p className="px-4 py-2 text-faint">No drives. Plug one in.</p>}

        {excluded.length > 0 && (
          <section aria-label="Excluded drives" className="mt-3 border-t border-line pt-2">
            <Heading><span>EXCLUDED</span><span>{excluded.length}</span></Heading>
            {excluded.map((d) => (
              <div key={d.id} className="flex h-7 items-center justify-between pl-4 pr-2 text-faint">
                <span className="truncate line-through decoration-line-strong">{d.name}</span>
                <button
                  type="button"
                  aria-label={`Include ${d.name}`}
                  onClick={() => void setExcluded(d.id, false)}
                  className="h-6 border border-line-strong px-2 text-label font-semibold text-muted hover:bg-sel hover:text-fg"
                >
                  INCLUDE
                </button>
              </div>
            ))}
          </section>
        )}
      </nav>
      <p className="border-t border-line px-4 py-3 text-label leading-relaxed tracking-normal text-faint">
        Drives are picked up when they mount. Exclude one to stop Stacks scanning it. Nothing on disk changes until you say so.
      </p>
    </aside>
  );
}
