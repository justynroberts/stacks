import { useVirtualizer } from '@tanstack/react-virtual';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import type { Sample } from '@shared/types';
import { fmtLen, type SortKey } from '../filters';
import { useStore } from '../store';
import { Waveform } from './Waveform';

export const ROW = 30;
const rowId = (id: string): string => `row-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const GRID = 'grid grid-cols-[40px_112px_minmax(0,1fr)_112px_48px_56px_40px_52px_96px] gap-x-3';

const COLS: Array<{ key: SortKey | null; label: string; right?: boolean; pad?: boolean }> = [
  { key: null, label: '#' },
  { key: null, label: 'CLIP' },
  { key: 'name', label: 'NAME' },
  { key: 'drive', label: 'DRIVE' },
  { key: 'bpm', label: 'BPM', right: true },
  { key: 'key', label: 'KEY', pad: true },
  { key: null, label: 'CAM' },
  { key: 'len', label: 'LEN', right: true },
  { key: null, label: 'STATUS' }
];

function status(s: Sample, run: string | undefined): { text: string; hot: boolean } {
  if (run === 'running') return { text: 'ANALYSING', hot: true };
  if (run === 'queued') return { text: 'QUEUED', hot: true };
  if (run === 'failed') return { text: 'FAILED', hot: false };
  if (!s.path) return { text: 'OFFLINE', hot: false };
  const a = s.analysis;
  if (!a) return { text: 'QUEUED', hot: true };
  const c = Math.round(Math.max(a.bpmConf, a.keyConf) * 100);
  return { text: c ? `READY ${c}%` : 'READY', hot: false };
}

export function SampleTable() {
  const { visible, selected, select, sort, setSort, driveNames, runState, preview, api, openEditor } = useStore();
  const scroller = useRef<HTMLDivElement>(null);

  const virt = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 12,
    initialRect: { width: 800, height: 640 }
  });

  const selIndex = selected ? visible.findIndex((s) => s.id === selected.id) : -1;
  useEffect(() => {
    if (selIndex >= 0) virt.scrollToIndex(selIndex, { align: 'auto' });
  }, [selIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    const move = (to: number) => {
      const s = visible[Math.max(0, Math.min(visible.length - 1, to))];
      if (s) select(s.id);
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(selIndex + 1); break;
      case 'ArrowUp': e.preventDefault(); move(selIndex - 1); break;
      case 'PageDown': e.preventDefault(); move(selIndex + 10); break;
      case 'PageUp': e.preventDefault(); move(selIndex - 10); break;
      case 'Home': e.preventDefault(); move(0); break;
      case 'End': e.preventDefault(); move(visible.length - 1); break;
      case ' ': if (selected) { e.preventDefault(); preview.toggle(selected.id); } break;
      case 'l': case 'L': if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); preview.setLoop(!preview.loop); } break;
      case 'e': case 'E': if (selected?.path && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openEditor(selected.id); } break;
    }
  };

  return (
    <div
      role="grid"
      aria-label="Samples"
      aria-rowcount={visible.length + 1}
      aria-activedescendant={selected ? rowId(selected.id) : undefined}
      tabIndex={0}
      onKeyDown={onKey}
      title="Arrow keys move, space previews, L loops, E edits"
      className="flex min-h-0 flex-1 flex-col outline-offset-[-2px]"
    >
      <div role="row" className={`${GRID} h-7 flex-none items-center border-b border-line-strong pl-[3px] pr-4 text-label font-semibold text-faint`}>
        {COLS.map((c) => {
          const active = c.key !== null && sort.key === c.key;
          return (
            <div
              key={c.label}
              role="columnheader"
              aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              className={c.right ? 'text-right' : c.pad ? 'pl-3' : ''}
            >
              {c.key ? (
                <button
                  type="button"
                  onClick={() => setSort({ key: c.key!, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
                  className={`hover:text-fg ${active ? 'text-fg underline decoration-accent decoration-2 underline-offset-4' : ''}`}
                >
                  {c.label}
                  {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              ) : (
                c.label
              )}
            </div>
          );
        })}
      </div>

      <div ref={scroller} role="rowgroup" className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div role="row">
            <div role="gridcell" aria-colspan={9} className="px-4 py-10 text-faint">No samples match. Drop files anywhere on the window, or plug in a drive.</div>
          </div>
        )}
        <div role="presentation" style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((v) => {
            const s = visible[v.index];
            if (!s) return null;
            const on = selected?.id === s.id;
            const a = s.analysis;
            const st = status(s, runState.get(s.id));
            return (
              <div
                key={s.id}
                id={rowId(s.id)}
                role="row"
                aria-rowindex={v.index + 2}
                aria-selected={on}
                draggable={!!s.path}
                onDragStart={(e) => { e.preventDefault(); api.startDrag(s.id); }}
                onClick={() => select(s.id)}
                onDoubleClick={() => preview.toggle(s.id)}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW, transform: `translateY(${v.start}px)` }}
                className={`${GRID} cursor-default items-center border-b border-l-[3px] border-b-line pr-4 ${on ? 'border-l-accent bg-sel' : 'border-l-transparent hover:bg-raised'} ${s.path ? '' : 'opacity-60'}`}
              >
                <span role="gridcell" className="pl-2 text-label text-faint">{String(v.index + 1).padStart(3, '0')}</span>
                {/* Each sample is drawn as a clip; the selected one is lit. */}
                <span role="gridcell" className={`flex h-[22px] items-center border px-1 ${on ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-raised text-muted'}`}>
                  <Waveform peaks={a?.peaks} width={102} height={18} bars={48} />
                </span>
                <span role="gridcell" className={`truncate ${on ? 'font-bold' : 'font-medium'}`}>
                  {preview.playingId === s.id ? '▶ ' : ''}{s.name}
                </span>
                <span role="gridcell" className="truncate text-muted">{driveNames.get(s.driveId) ?? '··'}</span>
                <span role="gridcell" className="text-right font-semibold">{a?.bpm ? Math.round(a.bpm) : '··'}</span>
                <span role="gridcell" className="pl-3 font-semibold">{a?.keyShort ?? '··'}</span>
                <span role="gridcell" className="text-muted">{a?.camelot ?? '··'}</span>
                <span role="gridcell" className="text-right text-muted">{a ? fmtLen(a.durationSec) : '··'}</span>
                <span role="gridcell" className={`flex items-center gap-2 text-label font-medium ${st.hot ? 'text-muted' : 'text-faint'}`}>
                  {st.hot && <span className="h-[6px] w-[6px] flex-none bg-accent" aria-hidden="true" />}
                  {st.text}
                </span>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
