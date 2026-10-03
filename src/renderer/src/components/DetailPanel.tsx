import { useState } from 'react';
import { CAMELOT_CODES, compatibleCamelot } from '@shared/camelot';
import { buildName } from '@shared/filename';
import type { Analysis } from '@shared/types';
import { fmtLen } from '../filters';
import { useStore } from '../store';
import { Waveform } from './Waveform';

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-label font-semibold text-faint">{children}</div>;

/** Bar numbers and beat ticks above the waveform, when there is a tempo to count in. */
function Ruler({ a }: { a: Analysis | undefined }) {
  const beats = a?.bpm && a.kind === 'loop' ? Math.round((a.durationSec * a.bpm) / 60) : 0;
  const shown = beats > 0 && beats <= 128 ? beats : 0;
  return (
    <div className="relative h-5 flex-none border-b border-line-strong text-label text-faint" aria-hidden="true">
      {shown > 0 ? (
        Array.from({ length: shown }, (_, i) => {
          const bar = i % 4 === 0;
          return (
            <span key={i} className="absolute bottom-0" style={{ left: `${(i / shown) * 100}%` }}>
              <span className={`block w-px ${bar ? 'h-5 bg-line-strong' : 'h-[6px] bg-line-strong'}`} />
              {bar && <span className="absolute left-[4px] top-[2px] tracking-normal">{i / 4 + 1}</span>}
            </span>
          );
        })
      ) : (
        <span className="absolute left-2 top-[3px]">{a ? (a.kind === 'loop' ? 'NO TEMPO' : 'ONE SHOT') : ''}</span>
      )}
      {a && <span className="absolute right-2 top-[3px]">{fmtLen(a.durationSec)}</span>}
    </div>
  );
}

/** The clip view: the selected sample across the bottom of the window. */
export function DetailPanel() {
  const { selected: s, mounted, preview, rename, copy, api, driveNames, openEditor } = useStore();
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState<'rename' | 'copy' | null>(null);

  if (!s) {
    return (
      <section aria-label="Selected sample" className="flex h-[216px] flex-none items-center border-t border-line-strong bg-raised px-5 text-faint">
        Select a sample to see its key, BPM and what it mixes with.
      </section>
    );
  }

  const a = s.analysis;
  const compat = compatibleCamelot(a?.camelot ?? null);
  const next = a ? buildName(s.name, a.bpm, a.keyShort) : null;
  const others = mounted.filter((d) => d.id !== s.driveId);
  const dest = others.find((d) => d.id === target) ?? others[0];
  const playing = preview.playingId === s.id;
  const conf = a ? [a.bpm ? `BPM ${Math.round(a.bpmConf * 100)}%` : 'NO PULSE', a.key ? `${a.key.toUpperCase()} ${Math.round(a.keyConf * 100)}%` : 'UNPITCHED'].join(' · ') : 'READING';

  const doRename = async () => { setBusy('rename'); await rename(s.id); setBusy(null); };
  const doCopy = async () => { if (!dest) return; setBusy('copy'); await copy(s.id, dest.id); setBusy(null); };

  return (
    <section aria-label="Selected sample" className="grid h-[216px] flex-none grid-cols-[272px_minmax(0,1fr)_296px] border-t border-line-strong bg-raised">
      <div className="flex min-w-0 flex-col gap-2 overflow-y-auto border-r border-line px-4 py-3">
        <div className="flex justify-between">
          <Label>CLIP</Label>
          <Label>{a ? (a.kind === 'loop' ? 'LOOP' : 'ONE SHOT') : 'READING'}</Label>
        </div>
        <h2 className="break-all font-bold leading-tight">{s.name}</h2>
        <div className="break-all text-label tracking-normal text-faint">{s.path ?? `${driveNames.get(s.driveId) ?? 'Drive'} is not connected`}</div>
        <div className="text-label text-muted">{conf}</div>
        {next && next !== s.name && (
          <div className="mt-auto">
            <Label>RENAME TO</Label>
            <div className="mt-1 break-all border-l-[3px] border-accent bg-bg px-2 py-1 font-semibold">{next}</div>
          </div>
        )}
      </div>

      <div className="relative flex min-w-0 flex-col bg-bg">
        <Ruler a={a} />
        <button
          type="button"
          onClick={() => preview.toggle(s.id)}
          aria-pressed={playing}
          aria-label={playing ? 'Stop preview' : 'Play preview'}
          disabled={!s.path}
          className="group relative block min-h-0 flex-1 px-2 py-3 text-muted"
        >
          <Waveform
            fluid
            peaks={a?.peaks}
            width={960}
            height={140}
            bars={96}
            gridDivisions={a?.kind === 'loop' && a.bpm ? Math.max(1, Math.round((a.durationSec * a.bpm) / 240)) : undefined}
            playhead={playing ? preview.progress : null}
            label={a ? 'Waveform. Press to preview.' : undefined}
            className="h-full"
          />
          <span className="absolute bottom-2 left-2 flex items-center gap-2 bg-bg px-2 py-[2px] text-label font-semibold text-muted group-hover:text-fg">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              {playing ? <rect x="1" y="1" width="8" height="8" fill="currentColor" /> : <path d="M1.5 1v8l7-4z" fill="currentColor" />}
            </svg>
            {playing ? 'STOP' : 'PLAY'} · SPACE
          </span>
        </button>
        <button
          type="button"
          onClick={() => preview.setLoop(!preview.loop)}
          aria-pressed={preview.loop}
          title="Loop the whole sample, gaplessly, to hear whether it needs editing (L)"
          className={`absolute bottom-2 right-2 flex items-center gap-2 border bg-bg px-2 py-[2px] text-label font-semibold ${preview.loop ? 'border-fg text-fg' : 'border-line-strong text-muted hover:text-fg'}`}
        >
          <span className={`h-[6px] w-[6px] ${preview.loop ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />
          LOOP · L
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-l border-line px-4 py-3">
        <div>
          <div className="mb-2"><Label>MIXES WITH</Label></div>
          <div className="grid grid-cols-12 gap-px" role="img" aria-label={a?.camelot ? `Compatible keys: ${[...compat.keys()].join(', ')}` : 'No key'}>
            {CAMELOT_CODES.map((c) => {
              const t = compat.get(c);
              return (
                <div
                  key={c}
                  className={`flex h-6 items-center justify-center text-label tracking-normal ${t === 'self' ? 'bg-accent font-bold text-accent-ink' : t === 'near' ? 'bg-fg font-bold text-bg' : 'bg-bg text-faint'}`}
                >
                  {c}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={() => openEditor(s.id)}
            disabled={!s.path}
            title="Trim, fade, normalise and more (E)"
            className="flex h-8 items-center justify-center gap-2 border border-fg font-semibold hover:bg-fg hover:text-bg"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M1 7h2l1.5-4 2 8 2-6 1.5 2h3" /></svg>
            Edit sample
          </button>
          <button
            type="button"
            onClick={doRename}
            disabled={!next || next === s.name || !s.path || busy !== null}
            className="h-8 bg-accent text-center font-bold text-accent-ink"
          >
            {busy === 'rename' ? 'Renaming' : next === s.name ? 'Already tagged' : 'Rename with key + BPM'}
          </button>
          <div className="flex gap-2">
            {others.length > 1 && (
              <select
                aria-label="Copy to drive"
                value={dest?.id ?? ''}
                onChange={(e) => setTarget(e.target.value)}
                className="h-8 min-w-0 flex-1 border border-line-strong bg-bg px-2"
              >
                {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={doCopy}
              disabled={!dest || !s.path || busy !== null}
              className={`h-8 truncate border border-line-strong text-center hover:bg-sel ${others.length > 1 ? 'px-3' : 'flex-1'}`}
            >
              {dest ? (others.length > 1 ? 'Copy' : `Copy to ${dest.name}`) : 'No other drive'}
            </button>
            <button type="button" onClick={() => api.reveal(s.id)} disabled={!s.path} className="h-8 border border-line-strong px-3 text-center hover:bg-sel">
              Show
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
