import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as edit from '@shared/audio/edit';
import { findLoops, type LoopPick, loopTempo } from '@shared/audio/loop';
import { frameCount, type PcmAudio, writeWav } from '@shared/audio/wav';
import type { EditTarget, Sample } from '@shared/types';
import { useStore } from '../store';
import { decodeForEdit, type Loaded } from './load';
import { Overview } from './Overview';
import { span, summarise } from './peaks';
import { Player } from './player';
import { fmtTime, parseTime } from './time';
import { MIN_SPP, type View, WaveView } from './WaveView';

type Snap = 'off' | 'zero' | 'beat';
type Sel = [number, number];

/** Undo keeps whole snapshots; cap them by memory so a long file cannot eat the machine. */
const HISTORY_BYTES = 768 * 1024 * 1024;
const bytesOf = (a: PcmAudio) => a.channels.reduce((n, ch) => n + ch.byteLength, 0);

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

function Tool({ label, title, onClick, disabled, active }: { label: string; title: string; onClick(): void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-7 whitespace-nowrap px-[10px] text-label font-semibold ${active ? 'bg-fg text-bg' : 'text-muted hover:bg-sel hover:text-fg'}`}
    >
      {label}
    </button>
  );
}

const Group = ({ children, label }: { children: React.ReactNode; label: string }) => (
  <div role="group" aria-label={label} className="flex items-center border-r border-line pr-2">{children}</div>
);

/** A counter cell whose value can be typed into, Pro Tools style. */
function TimeField({ label, frames, rate, onCommit }: { label: string; frames: number; rate: number; onCommit(frames: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? fmtTime(frames / rate);
  const commit = () => {
    if (draft === null) return;
    const t = parseTime(draft);
    if (t !== null) onCommit(Math.round(t * rate));
    setDraft(null);
  };
  return (
    <label className="flex flex-col justify-center border-l border-inset-line px-3 first:border-l-0">
      <span className="text-label font-medium opacity-70">{label}</span>
      <input
        aria-label={`Selection ${label.toLowerCase()}`}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
        className="w-[96px] border-0 bg-transparent p-0 text-body font-semibold text-lcd outline-none focus-visible:outline-none focus:underline focus:decoration-accent focus:decoration-2 focus:underline-offset-4"
      />
    </label>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col justify-center border-l border-inset-line px-3">
    <span className="text-label font-medium opacity-70">{label}</span>
    <span className="text-body font-semibold">{value}</span>
  </div>
);

export function Editor({ sample }: { sample: Sample }) {
  const { api, closeEditor, saveEdit, select, mounted } = useStore();
  /** '' means beside the original; otherwise a drive id (into its Stacks folder). */
  const [dest, setDest] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audio, setAudio] = useState<PcmAudio | null>(null);
  const [past, setPast] = useState<Array<{ audio: PcmAudio; label: string }>>([]);
  const [future, setFuture] = useState<Array<{ audio: PcmAudio; label: string }>>([]);
  const [sel, setSel] = useState<Sel>([0, 0]);
  const [view, setViewRaw] = useState<View>({ start: 0, spp: 64 });
  const [width, setWidth] = useState(800);
  const [snapMode, setSnap] = useState<Snap>('zero');
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [confirm, setConfirm] = useState<'replace' | 'close' | null>(null);
  const [saving, setSaving] = useState(false);
  const player = useRef(new Player());
  const playhead = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);

  // ---- load ----
  useEffect(() => {
    let live = true;
    api.readFile(sample.id).then(decodeForEdit).then(
      (l) => {
        if (!live) return;
        setLoaded(l);
        setAudio(l.audio);
        setSel([0, 0]);
      },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); }
    );
    return () => { live = false; };
  }, [api, sample.id]);

  useEffect(() => () => player.current.dispose(), []);
  useEffect(() => { root.current?.focus(); }, [loaded]);

  const n = audio ? frameCount(audio) : 0;
  const rate = audio?.sampleRate ?? 44100;
  const summary = useMemo(() => (audio ? summarise(audio) : null), [audio]);
  // A tempo found by autoloop stands in when the analysis has none.
  const [foundBpm, setFoundBpm] = useState<number | null>(null);
  const bpm = sample.analysis?.bpm ?? foundBpm;
  const [picks, setPicks] = useState<{ for: PcmAudio; list: LoopPick[]; i: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(t);
  }, [hint]);
  const beat = bpm ? (rate * 60) / bpm : null;

  const maxSpp = Math.max(MIN_SPP, n / Math.max(1, width));
  const setView = useCallback((v: View) => {
    const spp = Math.max(MIN_SPP, Math.min(maxSpp, v.spp));
    const start = Math.max(0, Math.min(Math.max(0, n - width * spp), v.start));
    setViewRaw({ start, spp });
  }, [maxSpp, n, width]);
  // Stay fitted to the whole sample (as the width settles, and after edits change the length) until the user
  // zooms or scrolls.
  const autoFit = useRef(true);
  const userView = useCallback((v: View) => { autoFit.current = false; setView(v); }, [setView]);
  const fitAll = useCallback(() => { autoFit.current = true; setView({ start: 0, spp: maxSpp }); }, [setView, maxSpp]);
  useEffect(() => { autoFit.current = true; }, [loaded]);
  useEffect(() => { if (loaded && autoFit.current) setView({ start: 0, spp: maxSpp }); }, [loaded, maxSpp, setView]);

  const hasSel = sel[1] > sel[0];
  const range: edit.Range = hasSel ? sel : [0, n];

  const snap = useCallback((f: number, bypass: boolean) => {
    if (!audio || bypass || snapMode === 'off') return Math.round(f);
    if (snapMode === 'beat' && beat) {
      const sixteenth = beat / 4;
      return Math.min(n, Math.round(Math.round(f / sixteenth) * sixteenth));
    }
    return edit.nearestZeroCrossing(audio, f, Math.round(rate * 0.005));
  }, [audio, snapMode, beat, n, rate]);

  // ---- history ----
  const stop = useCallback(() => { player.current.stop(); setPlaying(false); }, []);
  const apply = useCallback((label: string, fn: (a: PcmAudio) => { audio: PcmAudio; sel?: Sel } | null) => {
    if (!audio) return;
    const out = fn(audio);
    if (!out || out.audio === audio) return;
    stop();
    setPast((p) => {
      const next = [...p, { audio, label }];
      let total = next.reduce((t, x) => t + bytesOf(x.audio), 0);
      while (next.length > 1 && total > HISTORY_BYTES) total -= bytesOf(next.shift()!.audio);
      return next;
    });
    setFuture([]);
    setAudio(out.audio);
    const len = frameCount(out.audio);
    setSel(out.sel ?? [Math.min(sel[0], len), Math.min(sel[1], len)]);
    setConfirm(null);
  }, [audio, sel, stop]);

  const undo = useCallback(() => {
    const last = past[past.length - 1];
    if (!last || !audio) return;
    stop();
    setPast(past.slice(0, -1));
    setFuture([{ audio, label: last.label }, ...future]);
    setAudio(last.audio);
    const len = frameCount(last.audio);
    setSel(([s, e]) => [Math.min(s, len), Math.min(e, len)]);
  }, [past, future, audio, stop]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next || !audio) return;
    stop();
    setFuture(future.slice(1));
    setPast([...past, { audio, label: next.label }]);
    setAudio(next.audio);
    const len = frameCount(next.audio);
    setSel(([s, e]) => [Math.min(s, len), Math.min(e, len)]);
  }, [past, future, audio, stop]);

  // Keep the view inside the audio after a length or width change.
  useEffect(() => { if (!autoFit.current) setView(view); }, [n, width]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- operations ----
  const ops = {
    trim: () => apply('Trim', (a) => ({ audio: edit.trim(a, sel), sel: [0, sel[1] - sel[0]] })),
    remove: () => apply('Delete', (a) => ({ audio: edit.remove(a, sel), sel: [sel[0], sel[0]] })),
    silence: () => apply('Silence', (a) => ({ audio: edit.silence(a, sel) })),
    fadeIn: () => apply('Fade in', (a) => ({ audio: edit.fade(a, sel, 'in') })),
    fadeOut: () => apply('Fade out', (a) => ({ audio: edit.fade(a, sel, 'out') })),
    declick: () => apply('De-click', (a) => ({ audio: edit.declick(a) })),
    quieter: () => apply('Gain -3 dB', (a) => ({ audio: edit.gain(a, range, -3) })),
    louder: () => apply('Gain +3 dB', (a) => ({ audio: edit.gain(a, range, 3) })),
    normalize: () => apply('Normalize', (a) => ({ audio: edit.normalize(a, range) })),
    reverse: () => apply('Reverse', (a) => ({ audio: edit.reverse(a, range) })),
    autoTrim: () => apply('Trim silence', (a) => {
      const r = edit.audibleRange(a);
      if (!r || (r[0] === 0 && r[1] === frameCount(a))) return null;
      return { audio: edit.trim(a, r), sel: [0, 0] };
    })
  };

  // ---- transport ----
  const play = useCallback(() => {
    if (!audio) return;
    if (player.current.playing) return stop();
    const [from, to] = hasSel ? sel : [sel[0] >= n ? 0 : sel[0], n];
    player.current.play(audio, from, to, loop && hasSel, () => setPlaying(false));
    setPlaying(player.current.playing);
  }, [audio, hasSel, sel, n, loop, stop]);

  // Moving the loop points while a loop plays: the running sound picks them up (new end when it gets there, new
  // start on the next pass). Toggling Loop mid-play carries on rather than restarting.
  // Selections under 10 ms (a drag just starting) are skipped so the loop never buzzes.
  useEffect(() => {
    if (playing && sel[1] - sel[0] >= rate * 0.01) player.current.updateLoop(sel[0], sel[1]);
  }, [playing, sel, rate]);
  useEffect(() => {
    if (playing && (hasSel || !loop)) player.current.setLooping(loop && hasSel, sel[0], sel[1]);
  }, [loop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Playhead follows the audio without re-rendering React every frame.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    if (!playing) { if (playhead.current) playhead.current.style.display = 'none'; return; }
    let raf = 0;
    const tick = () => {
      const pos = player.current.position();
      const el = playhead.current;
      if (el) {
        const v = viewRef.current;
        const x = pos === null ? -1 : (pos - v.start) / v.spp;
        el.style.display = x >= 0 && x <= width ? 'block' : 'none';
        el.style.transform = `translateX(${x}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, width]);

  const zoom = useCallback((factor: number) => {
    const centre = hasSel ? (sel[0] + sel[1]) / 2 : view.start + (width * view.spp) / 2;
    const spp = view.spp * factor;
    userView({ spp, start: centre - (width * spp) / 2 });
  }, [hasSel, sel, view, width, userView]);
  const zoomSel = useCallback(() => {
    if (!hasSel) return;
    const spp = ((sel[1] - sel[0]) * 1.1) / width;
    userView({ spp, start: sel[0] - (sel[1] - sel[0]) * 0.05 });
  }, [hasSel, sel, width, userView]);

  // ---- save / close ----
  const dirty = past.length > 0;
  // A drive that went away (or was excluded) since it was picked falls back to beside the original.
  const destId = mounted.some((d) => d.id === dest) ? dest : '';
  const bars = beat && hasSel ? (sel[1] - sel[0]) / (beat * 4) : null;
  const loopLabel = bars !== null && Math.round(bars) >= 1 && Math.abs(bars - Math.round(bars)) < 0.02 ? `loop_${Math.round(bars)}bar` : 'loop';

  const save = useCallback(async (kind: 'copy' | 'loop' | 'replace') => {
    if (!audio || !loaded || saving) return;
    if (kind === 'replace' && confirm !== 'replace') { setConfirm('replace'); return; }
    if (kind === 'loop' && !hasSel) return;
    if (kind === 'copy' && !dirty) return;
    const target: EditTarget = kind === 'replace' ? { kind: 'replace' } : { kind: 'new', driveId: destId || null, label: kind === 'loop' ? loopLabel : 'edit' };
    const out = kind === 'loop' ? edit.trim(audio, sel) : audio;
    setSaving(true);
    const saved = await saveEdit(sample.id, writeWav(out, loaded.format), target);
    setSaving(false);
    setConfirm(null);
    if (!saved || kind === 'loop') return; // a saved loop leaves the editor open for the next one
    stop();
    closeEditor();
    select(saved.id);
  }, [audio, loaded, saving, confirm, hasSel, dirty, destId, loopLabel, sel, stop, saveEdit, sample.id, closeEditor, select]);

  /** Pick the best whole-bar loop; pressing again steps to the next candidate. */
  const autoLoop = useCallback(() => {
    if (!audio) return;
    let current = picks && picks.for === audio ? picks : null;
    if (!current) {
      const tempo = loopTempo(audio, bpm);
      if (!tempo) { setHint('No steady tempo to loop to'); return; }
      if (!bpm) setFoundBpm(tempo);
      const list = findLoops(audio, tempo);
      if (!list.length) { setHint('Too short to loop'); return; }
      current = { for: audio, list, i: -1 };
    }
    const i = (current.i + 1) % current.list.length;
    const p = current.list[i]!;
    setPicks({ ...current, i });
    setSel([p.start, p.end]);
    setLoop(true);
    setHint(`${p.bars} ${p.bars === 1 ? 'bar' : 'bars'} · candidate ${i + 1} of ${current.list.length}`);
  }, [audio, picks, bpm]);

  /** Select n bars from the cursor (or the start of the selection). */
  const selectBars = useCallback((count: number) => {
    if (!beat) return;
    const from = sel[0];
    setSel([from, Math.min(n, Math.round(from + beat * 4 * count))]);
  }, [beat, sel, n]);

  const close = useCallback(() => {
    if (dirty && confirm !== 'close') { setConfirm('close'); return; }
    stop();
    closeEditor();
  }, [dirty, confirm, stop, closeEditor]);

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(null), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  // ---- keyboard ----
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    const step = Math.max(1, Math.round((width * view.spp) / 20));
    const k = e.key.toLowerCase();
    let used = true;
    if (k === ' ') play();
    else if (mod(e) && k === 'z') (e.shiftKey ? redo : undo)();
    else if (mod(e) && k === 'y') redo();
    else if (mod(e) && k === 'a') setSel([0, n]);
    else if (mod(e) && k === 't') { if (hasSel) ops.trim(); }
    else if (mod(e) && k === 's') void save(e.shiftKey ? 'loop' : 'copy');
    else if (k === 'backspace' || k === 'delete') { if (hasSel) ops.remove(); }
    else if (k === 'l' && !mod(e)) setLoop((x) => !x);
    else if (k === '=' || k === '+') zoom(0.5);
    else if (k === '-' || k === '_') zoom(2);
    else if (k === '0') fitAll();
    else if (k === 'escape') { if (hasSel) setSel([sel[0], sel[0]]); else close(); }
    else if (k === 'home') setSel([0, 0]);
    else if (k === 'end') setSel([n, n]);
    else if (k === 'arrowleft' || k === 'arrowright') {
      const d = k === 'arrowleft' ? -step : step;
      if (e.shiftKey) setSel(([s, en]) => [s, Math.max(s, Math.min(n, en + d))]);
      else { const c = Math.max(0, Math.min(n, (hasSel ? (d < 0 ? sel[0] : sel[1]) : sel[0]) + (hasSel ? 0 : d))); setSel([c, c]); }
    } else used = false;
    if (used) e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const peakText = useMemo(() => {
    if (!audio || !summary) return '—';
    let m = 0;
    for (let c = 0; c < audio.channels.length; c++) { const [lo, hi] = span(audio, summary, c, range[0], range[1]); m = Math.max(m, Math.abs(lo), Math.abs(hi)); }
    if (m <= 0) return '-∞ dB';
    const db = 20 * Math.log10(m);
    return `${Math.abs(db) < 0.05 ? '0.0' : db.toFixed(1)} dB`;
  }, [audio, summary, range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const lenFrames = hasSel ? sel[1] - sel[0] : n;
  const beats = beat ? lenFrames / beat : null;
  const fmtLabel = loaded ? (loaded.format.float ? '32-BIT FLOAT' : `${loaded.format.bits}-BIT`) : '';

  return (
    <section ref={root} tabIndex={-1} aria-label="Sample editor" className="flex min-h-0 flex-1 flex-col outline-none focus-visible:outline-none">
      {/* Title and save */}
      <div className="flex h-11 flex-none items-center gap-3 border-b border-line px-4">
        <button type="button" onClick={close} className="flex h-7 items-center gap-2 px-2 text-label font-semibold text-muted hover:bg-sel hover:text-fg" title="Back to the library (Esc)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7.5 2L3.5 6l4 4" /></svg>
          {confirm === 'close' ? 'DISCARD EDITS?' : 'LIBRARY'}
        </button>
        <h2 className="min-w-0 truncate font-bold">
          {sample.name}
          {dirty && <span className="ml-3 text-label font-medium text-faint">EDITED · {past.length} {past.length === 1 ? 'CHANGE' : 'CHANGES'}</span>}
          {hint && <span role="status" className="ml-3 text-label font-medium text-muted">{hint.toUpperCase()}</span>}
        </h2>
        <div className="flex-1" />
        {!loaded?.sourceIsWav && loaded && <span className="text-label text-faint">SAVES AS WAV</span>}
        <label className="flex items-center gap-2 text-label font-semibold text-faint">
          SAVE TO
          <select
            aria-label="Save new files to"
            value={destId}
            onChange={(e) => setDest(e.target.value)}
            className="h-7 max-w-[200px] border border-line-strong bg-bg px-2 text-body font-medium text-fg"
          >
            <option value="">Beside the original</option>
            {mounted.map((d) => <option key={d.id} value={d.id}>{d.name} / Stacks</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void save('loop')}
          disabled={!hasSel || saving}
          title={`Save just the selection as a new file, ${loopLabel}.wav (Shift+Cmd+S). The editor stays open.`}
          className="h-7 border border-fg px-3 text-label font-bold text-fg hover:bg-fg hover:text-bg"
        >
          SAVE LOOP
        </button>
        <button
          type="button"
          onClick={() => void save('replace')}
          disabled={!dirty || saving}
          title="Write the edit over the original. The original goes to the Trash."
          className={`h-7 border px-3 text-label font-semibold ${confirm === 'replace' ? 'border-fg bg-fg text-bg' : 'border-line-strong text-muted hover:bg-sel hover:text-fg'}`}
        >
          {confirm === 'replace' ? 'CONFIRM: ORIGINAL TO TRASH' : 'REPLACE ORIGINAL'}
        </button>
        <button type="button" onClick={() => void save('copy')} disabled={!dirty || saving} title="Save the whole edit as a new file (Cmd+S)" className="h-7 bg-accent px-4 text-label font-bold text-accent-ink">
          {saving ? 'SAVING' : 'SAVE AS COPY'}
        </button>
      </div>

      {/* Tools */}
      <div className="flex h-10 flex-none items-center gap-2 overflow-x-auto border-b border-line px-2" role="toolbar" aria-label="Edit tools">
        <Group label="Cut">
          <Tool label="TRIM" title="Keep only the selection (Cmd+T)" onClick={ops.trim} disabled={!hasSel} />
          <Tool label="DELETE" title="Cut the selection out (Backspace)" onClick={ops.remove} disabled={!hasSel} />
          <Tool label="SILENCE" title="Replace the selection with silence" onClick={ops.silence} disabled={!hasSel} />
          <Tool label="TRIM SILENCE" title="Cut the silence from both ends" onClick={ops.autoTrim} disabled={!audio} />
        </Group>
        <Group label="Fades">
          <Tool label="FADE IN" title="Fade the selection in from silence" onClick={ops.fadeIn} disabled={!hasSel} />
          <Tool label="FADE OUT" title="Fade the selection out to silence" onClick={ops.fadeOut} disabled={!hasSel} />
          <Tool label="DE-CLICK" title="4 ms fades at both ends of the sample" onClick={ops.declick} disabled={!audio} />
        </Group>
        <Group label="Level">
          <Tool label="−3 DB" title="Quieter (selection, or everything)" onClick={ops.quieter} disabled={!audio} />
          <Tool label="+3 DB" title="Louder (selection, or everything). Clips above 0 dB." onClick={ops.louder} disabled={!audio} />
          <Tool label="NORMALIZE" title="Peak to -0.1 dB (selection, or everything)" onClick={ops.normalize} disabled={!audio} />
          <Tool label="REVERSE" title="Play backwards (selection, or everything)" onClick={ops.reverse} disabled={!audio} />
        </Group>
        <Group label="Loop">
          <Tool
            label={picks && picks.for === audio ? `AUTO LOOP ${picks.i + 1}/${picks.list.length}` : 'AUTO LOOP'}
            title="Find the best 4, 2 or 1 bar loop: on the beat, starting on a hit, wrapping cleanly. Press again for the next candidate."
            onClick={autoLoop}
            disabled={!audio}
          />
          <Tool label="1 BAR" title="Select one bar from the cursor" onClick={() => selectBars(1)} disabled={!audio || !beat || sel[0] + beat * 4 > n + 1} />
          <Tool label="2" title="Select two bars from the cursor" onClick={() => selectBars(2)} disabled={!audio || !beat || sel[0] + beat * 8 > n + 1} />
          <Tool label="4" title="Select four bars from the cursor" onClick={() => selectBars(4)} disabled={!audio || !beat || sel[0] + beat * 16 > n + 1} />
        </Group>
        <Group label="History">
          <Tool label="UNDO" title={past.length ? `Undo ${past[past.length - 1]!.label} (Cmd+Z)` : 'Nothing to undo'} onClick={undo} disabled={!past.length} />
          <Tool label="REDO" title={future.length ? `Redo ${future[0]!.label} (Shift+Cmd+Z)` : 'Nothing to redo'} onClick={redo} disabled={!future.length} />
        </Group>
      </div>

      {/* Waveform */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {audio && summary ? (
          <WaveView
            audio={audio}
            summary={summary}
            view={view}
            onView={userView}
            sel={sel}
            onSel={setSel}
            snap={snap}
            beat={beat}
            playhead={playhead}
            onWidth={setWidth}
            label={`Waveform of ${sample.name}, ${audio.channels.length === 1 ? 'mono' : `${audio.channels.length} channels`}. Drag to select.`}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-faint" role="status">{error ? `Could not open this file: ${error}` : 'Reading the file…'}</div>
        )}
        {audio && summary && <Overview audio={audio} summary={summary} view={view} width={width} sel={sel} onView={userView} />}
      </div>

      {/* Transport and selection counter */}
      <div className="flex h-16 flex-none items-center gap-4 border-t border-line-strong bg-raised px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={play}
            disabled={!audio}
            aria-pressed={playing}
            title={hasSel ? 'Play the selection (Space)' : 'Play from the cursor (Space)'}
            className="flex h-9 w-[84px] items-center justify-center gap-2 bg-fg font-bold text-bg"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">{playing ? <rect x="1" y="1" width="8" height="8" fill="currentColor" /> : <path d="M1.5 1v8l7-4z" fill="currentColor" />}</svg>
            {playing ? 'STOP' : 'PLAY'}
          </button>
          <button type="button" onClick={() => setLoop((x) => !x)} aria-pressed={loop} title="Loop the selection (L)" className={`flex h-9 items-center gap-2 border px-3 text-label font-semibold ${loop ? 'border-fg text-fg' : 'border-line-strong text-muted hover:text-fg'}`}>
            <span className={`h-[6px] w-[6px] ${loop ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />LOOP
          </button>
        </div>
        <div role="group" aria-label="Zoom" className="flex items-center border border-line-strong">
          <Tool label="−" title="Zoom out (-)" onClick={() => zoom(2)} disabled={!audio} />
          <Tool label="+" title="Zoom in (+). Ctrl or pinch on the waveform to zoom where you point." onClick={() => zoom(0.5)} disabled={!audio} />
          <Tool label="FIT" title="Show the whole sample (0)" onClick={fitAll} disabled={!audio} />
          <Tool label="SEL" title="Zoom to the selection" onClick={zoomSel} disabled={!hasSel} />
        </div>
        <div className="flex items-center gap-2">
        <span className="text-label font-semibold text-faint">SNAP</span>
          <div role="group" aria-label="Snap" className="flex border border-line-strong">
            <Tool label="OFF" title="Free selection" onClick={() => setSnap('off')} active={snapMode === 'off'} />
            <Tool label="ZERO" title="Snap edges to zero crossings, so cuts do not click. Hold Alt to bypass." onClick={() => setSnap('zero')} active={snapMode === 'zero'} />
            <Tool label="1/16" title={beat ? 'Snap edges to 16th notes at the sample tempo. Hold Alt to bypass.' : 'Needs a tempo'} onClick={() => setSnap('beat')} active={snapMode === 'beat'} disabled={!beat} />
          </div>
        </div>
        <div className="flex-1" />
        <div role="group" aria-label="Selection" className="flex h-12 items-stretch bg-inset text-lcd">
          <TimeField label="START" frames={sel[0]} rate={rate} onCommit={(f) => setSel([Math.max(0, Math.min(f, n)), Math.max(Math.max(0, Math.min(f, n)), sel[1])])} />
          <TimeField label="END" frames={sel[1]} rate={rate} onCommit={(f) => setSel([Math.min(sel[0], Math.max(0, Math.min(f, n))), Math.max(0, Math.min(f, n))])} />
          <Info label={hasSel ? 'LENGTH' : 'TOTAL'} value={`${fmtTime(lenFrames / rate)}${beats !== null ? ` · ${beats.toFixed(2)} BT` : ''}`} />
          <Info label="PEAK" value={peakText} />
          <Info label="FORMAT" value={audio ? `${(rate / 1000).toFixed(1)}K · ${fmtLabel} · ${audio.channels.length === 1 ? 'MONO' : audio.channels.length === 2 ? 'STEREO' : `${audio.channels.length} CH`}` : '—'} />
        </div>
      </div>
    </section>
  );
}
