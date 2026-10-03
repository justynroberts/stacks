import { fmtTime } from './time';

export interface SetRow {
  start: number;
  end: number;
  bars: number;
  score: number;
  energy: number;
  include: boolean;
  reverse: boolean;
}

export type SetMode = 'best' | 'all';

interface Props {
  rows: SetRow[];
  rate: number;
  tempo: number | null;
  mode: SetMode;
  bars: number;
  stale: boolean;
  active: number | null;
  /** The editor selection differs from the active row, so "use selection" means something. */
  selectionDiffers: boolean;
  alsoReversed: boolean;
  busy: string | null;
  auditioning: number | null;
  onFind(bars: number, mode: SetMode): void;
  onPick(i: number): void;
  onAudition(i: number): void;
  onToggle(i: number, key: 'include' | 'reverse'): void;
  onUseSelection(i: number): void;
  onAlsoReversed(on: boolean): void;
  onExport(): void;
  onClose(): void;
}

const Seg = ({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick(): void }) => (
  <button type="button" title={title} aria-pressed={on} onClick={onClick} className={`h-6 px-2 text-label font-semibold ${on ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}>
    {label}
  </button>
);

/** The loops found across the whole sample, ready to audition, adjust and export as files. */
export function LoopSetPanel(p: Props) {
  const included = p.rows.filter((r) => r.include);
  const files = included.reduce((n, r) => n + (r.reverse || p.alsoReversed ? 2 : 1), 0);
  return (
    <section aria-label="Found loops" className="flex max-h-[232px] flex-none flex-col border-t border-line-strong bg-raised">
      <div className="flex h-10 flex-none items-center gap-3 border-b border-line px-4">
        <h3 className="text-label font-semibold text-faint">FOUND LOOPS</h3>
        <span className="text-label font-medium text-muted">
          {p.rows.length} · {p.tempo ? `${Number.isInteger(p.tempo) ? p.tempo : p.tempo.toFixed(2)} BPM` : 'NO TEMPO'}
          {p.stale && ' · AUDIO CHANGED, FIND AGAIN'}
        </span>
        <div role="group" aria-label="What to find" className="flex border border-line-strong">
          <Seg on={p.mode === 'best'} label="BEST" title="The strongest loops: one per section, no repeats, no overlaps" onClick={() => p.onFind(p.bars, 'best')} />
          <Seg on={p.mode === 'all'} label="SPLIT" title="Cut the whole sample into consecutive loops" onClick={() => p.onFind(p.bars, 'all')} />
        </div>
        <div role="group" aria-label="Loop length in bars" className="flex border border-line-strong">
          {[1, 2, 4, 8].map((b) => <Seg key={b} on={p.bars === b} label={`${b}`} title={`${b} bar loops`} onClick={() => p.onFind(b, p.mode)} />)}
        </div>
        <span className="text-label text-faint">BARS</span>
        <div className="flex-1" />
        {p.busy && <span role="status" className="text-label font-medium text-muted">{p.busy.toUpperCase()}</span>}
        <button
          type="button"
          aria-pressed={p.alsoReversed}
          onClick={() => p.onAlsoReversed(!p.alsoReversed)}
          title="Export a reversed copy of every loop as well"
          className={`flex h-7 items-center gap-2 border px-2 text-label font-semibold ${p.alsoReversed ? 'border-fg text-fg' : 'border-line-strong text-muted hover:text-fg'}`}
        >
          <span className={`h-[6px] w-[6px] ${p.alsoReversed ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />
          + REVERSED COPIES
        </button>
        <button type="button" onClick={p.onExport} disabled={!files || p.stale || !!p.busy} className="h-7 bg-accent px-3 text-label font-bold text-accent-ink">
          EXPORT {files} {files === 1 ? 'FILE' : 'FILES'}
        </button>
        <button type="button" onClick={p.onClose} aria-label="Close found loops" title="Close" className="flex h-7 w-7 items-center justify-center text-muted hover:bg-sel hover:text-fg">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg>
        </button>
      </div>

      <div role="list" className="min-h-0 overflow-y-auto">
        {p.rows.length === 0 && <p className="px-4 py-3 text-faint">No loops found at this length. Try fewer bars, or SPLIT.</p>}
        {p.rows.map((r, i) => {
          const on = p.active === i;
          const playing = p.auditioning === i;
          return (
            <div
              key={i}
              role="listitem"
              onClick={() => p.onPick(i)}
              className={`grid h-8 cursor-default grid-cols-[28px_32px_168px_56px_96px_48px_72px_56px_minmax(0,1fr)] items-center gap-x-2 border-b border-l-[3px] border-b-line px-3 ${on ? 'border-l-accent bg-sel' : 'border-l-transparent hover:bg-sel'}`}
            >
              <input
                type="checkbox"
                aria-label={`Include loop ${i + 1}`}
                checked={r.include}
                onClick={(e) => e.stopPropagation()}
                onChange={() => p.onToggle(i, 'include')}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              <span className="text-label font-semibold text-faint">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-medium">{fmtTime(r.start / p.rate)} – {fmtTime(r.end / p.rate)}</span>
              <span className="text-label font-semibold text-muted">{Number.isInteger(r.bars) ? `${r.bars} BAR` : `${r.bars.toFixed(2)} BAR`}</span>
              <span className="block h-1 bg-line" title="Level" aria-hidden="true"><span className="block h-1 bg-muted" style={{ width: `${Math.round(r.energy * 100)}%` }} /></span>
              <span className="text-label text-faint" title="How well it loops">{Math.round(r.score * 100)}%</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); p.onAudition(i); }}
                aria-pressed={playing}
                aria-label={`${playing ? 'Stop' : 'Play'} loop ${i + 1}`}
                className={`flex h-6 items-center justify-center gap-1 border text-label font-semibold ${playing ? 'border-fg bg-fg text-bg' : 'border-line-strong text-muted hover:text-fg'}`}
              >
                {playing ? 'STOP' : r.reverse ? 'PLAY ◂' : 'PLAY'}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); p.onToggle(i, 'reverse'); }}
                aria-pressed={r.reverse}
                aria-label={`Reverse loop ${i + 1}`}
                title="Audition reversed, and export a reversed copy"
                className={`h-6 border text-label font-semibold ${r.reverse ? 'border-fg text-fg' : 'border-line-strong text-muted hover:text-fg'}`}
              >
                REV
              </button>
              {on && p.selectionDiffers ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); p.onUseSelection(i); }}
                  className="h-6 justify-self-start border border-line-strong px-2 text-label font-semibold text-muted hover:text-fg"
                  title="Make this loop the current selection"
                >
                  USE SELECTION
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
