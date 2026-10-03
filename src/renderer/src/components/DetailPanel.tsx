import { useState } from 'react';
import { CAMELOT_CODES, compatibleCamelot } from '@shared/camelot';
import { buildName } from '@shared/filename';
import { fmtLen } from '../filters';
import { useStore } from '../store';
import { Waveform } from './Waveform';

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-label font-medium text-faint">{children}</div>;

export function DetailPanel() {
  const { selected: s, mounted, preview, rename, copy, api, driveNames } = useStore();
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState<'rename' | 'copy' | null>(null);

  if (!s) {
    return (
      <section aria-label="Selected sample" className="flex w-[340px] flex-none flex-col border-l border-line px-5 py-4 text-faint">
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

  const doRename = async () => { setBusy('rename'); await rename(s.id); setBusy(null); };
  const doCopy = async () => { if (!dest) return; setBusy('copy'); await copy(s.id, dest.id); setBusy(null); };

  return (
    <section aria-label="Selected sample" className="flex w-[340px] flex-none flex-col gap-4 overflow-y-auto border-l border-line px-5 py-4">
      <div>
        <div className="flex justify-between text-label font-medium text-faint">
          <span>SELECTED</span>
          <span>{a ? (a.kind === 'loop' ? 'LOOP' : 'ONE SHOT') : 'READING'}</span>
        </div>
        <h2 className="mt-[6px] break-all font-bold">{s.name}</h2>
        <div className="mt-[2px] break-all text-label text-faint">{s.path ?? `${driveNames.get(s.driveId) ?? 'Drive'} is not connected`}</div>
      </div>

      <div className="grid grid-cols-3 border-y border-line">
        <div className="py-3">
          <Label>BPM</Label>
          <div className="text-readout font-bold tabular-nums">{a?.bpm ? Math.round(a.bpm) : '··'}</div>
          <div className="text-label text-faint">{!a ? 'reading' : a.bpm ? `conf ${Math.round(a.bpmConf * 100)}%` : 'no pulse'}</div>
        </div>
        <div className="border-l border-line py-3 pl-3">
          <Label>KEY</Label>
          <div className="text-readout font-bold">{a?.keyShort ?? '··'}</div>
          <div className="text-label text-faint">{!a ? 'reading' : a.key ? `${a.key} ${Math.round(a.keyConf * 100)}%` : 'unpitched'}</div>
        </div>
        <div className="border-l border-line py-3 pl-3">
          <Label>CAMELOT</Label>
          <div className="text-readout font-bold">{a?.camelot ?? '··'}</div>
          <div className="text-label text-faint">{a ? fmtLen(a.durationSec) : ''}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => preview.toggle(s.id)}
        aria-pressed={playing}
        aria-label={playing ? 'Stop preview' : 'Play preview'}
        disabled={!s.path}
        className="block text-accent"
      >
        <Waveform
          peaks={a?.peaks}
          width={300}
          height={72}
          bars={75}
          strokeWidth={2}
          gridDivisions={a?.kind === 'loop' && a.bpm ? 8 : undefined}
          playhead={playing ? preview.progress : null}
          label={a ? 'Waveform. Press to preview.' : undefined}
        />
      </button>

      <div>
        <div className="mb-2"><Label>MIXES WITH</Label></div>
        <div className="grid grid-cols-12 gap-px" role="img" aria-label={a?.camelot ? `Compatible keys: ${[...compat.keys()].join(', ')}` : 'No key'}>
          {CAMELOT_CODES.map((c) => {
            const t = compat.get(c);
            return (
              <div
                key={c}
                className={`flex h-6 items-center justify-center border text-label tracking-normal ${t === 'self' ? 'border-accent bg-accent font-bold text-accent-ink' : t === 'near' ? 'border-line-strong bg-line-strong font-bold text-fg' : 'border-line text-faint'}`}
              >
                {c}
              </div>
            );
          })}
        </div>
      </div>

      {next && next !== s.name && (
        <div>
          <div className="mb-2"><Label>FILENAME</Label></div>
          <div className="break-all text-faint line-through">{s.name}</div>
          <div className="mt-[6px] break-all border border-accent p-2 font-medium">{next}</div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={doRename}
          disabled={!next || next === s.name || !s.path || busy !== null}
          className="h-9 bg-accent text-center font-bold text-accent-ink"
        >
          {busy === 'rename' ? 'Renaming' : next === s.name ? 'Already tagged' : 'Rename with key + BPM'}
        </button>
        <div className="flex gap-2">
          {others.length > 1 && (
            <select
              aria-label="Copy to drive"
              value={dest?.id ?? ''}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 min-w-0 flex-1 border border-line-strong bg-bg px-2"
            >
              {others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <button
            type="button"
            onClick={doCopy}
            disabled={!dest || !s.path || busy !== null}
            className={`h-9 border border-line-strong text-center ${others.length > 1 ? 'px-3' : 'flex-1'}`}
          >
            {dest ? (others.length > 1 ? 'Copy' : `Copy to ${dest.name}`) : 'No other drive'}
          </button>
        </div>
        <button type="button" onClick={() => api.reveal(s.id)} disabled={!s.path} className="h-9 border border-line-strong text-center">
          Show in folder
        </button>
      </div>
    </section>
  );
}
