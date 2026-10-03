import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { frameCount } from '@shared/audio/wav';
import type { Analysis, Drive, EditTarget, QueueItem, Sample, StacksApi } from '@shared/types';
import { AnalysisRunner, type RunState } from './analysis/runner';
import { createAnalysisWorker } from './analysis/createWorker';
import { decodeForEdit } from './editor/load';
import { Player } from './editor/player';
import { applyFilters, defaultFilters, type Filters, type Sort, sortSamples } from './filters';

export interface Preview {
  playingId: string | null;
  /** 0..1 through the file. */
  progress: number;
  /** Loop the whole sample, gaplessly, to hear whether the seam clicks. */
  loop: boolean;
  setLoop(on: boolean): void;
  toggle(id: string): void;
  stop(): void;
}

export interface Store {
  api: StacksApi;
  demo: boolean;
  drives: Drive[];
  mounted: Drive[];
  samples: Sample[];
  visible: Sample[];
  selected: Sample | undefined;
  select(id: string): void;
  filters: Filters;
  setFilters(patch: Partial<Filters>): void;
  sort: Sort;
  setSort(s: Sort): void;
  queue: QueueItem[];
  runState: Map<string, RunState>;
  analysisCounts: { queued: number; running: number; done: number; total: number };
  driveNames: Map<string, string>;
  perDrive: Map<string, number>;
  totals: { all: number; loops: number; shots: number; needs: number };
  preview: Preview;
  notice: { text: string; error: boolean } | null;
  rename(id: string): Promise<void>;
  copy(id: string, driveId: string): Promise<void>;
  importUrl(url: string): Promise<boolean>;
  setExcluded(driveId: string, excluded: boolean): Promise<void>;
  /** The sample open in the editor, if any. */
  editing: Sample | undefined;
  openEditor(id: string): void;
  closeEditor(): void;
  /** Returns the saved sample, or null after showing the error. */
  saveEdit(id: string, wav: ArrayBuffer, target: EditTarget): Promise<Sample | null>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

/**
 * Library preview. Uses the editor's Web Audio player rather than an <audio> element, because a media element
 * leaves a gap when it loops (and MP3 adds encoder padding), which would hide or fake a click at the seam.
 */
function usePreview(api: StacksApi, byId: (id: string) => Sample | undefined): Preview {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [loop, setLoopState] = useState(false);
  const player = useRef<Player | null>(null);
  const current = useRef<{ id: string; frames: number } | null>(null);
  const request = useRef(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  const stop = useCallback(() => {
    request.current++;
    player.current?.stop();
    current.current = null;
    setPlayingId(null);
    setProgress(0);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      if (playingId === id) return stop();
      stop();
      if (!byId(id)) return;
      const mine = ++request.current;
      void api.readFile(id).then(decodeForEdit).then(({ audio }) => {
        if (mine !== request.current) return; // something else was asked for meanwhile
        const p = (player.current ??= new Player());
        const frames = frameCount(audio);
        p.play(audio, 0, frames, loopRef.current, () => {
          if (current.current?.id !== id) return;
          current.current = null;
          setPlayingId(null);
          setProgress(0);
        });
        if (!p.playing) return;
        current.current = { id, frames };
        setPlayingId(id);
      }, () => undefined);
    },
    [api, byId, playingId, stop]
  );

  const setLoop = useCallback((on: boolean) => {
    setLoopState(on);
    const c = current.current;
    if (c) player.current?.setLooping(on, 0, c.frames);
  }, []);

  // A few updates a second is plenty for the waveform playhead, and keeps the whole tree from re-rendering per frame.
  useEffect(() => {
    if (!playingId) return;
    const t = setInterval(() => {
      const c = current.current;
      const pos = player.current?.position();
      if (c && pos != null) setProgress(pos / Math.max(1, c.frames));
    }, 66);
    return () => clearInterval(t);
  }, [playingId]);

  useEffect(() => () => { player.current?.dispose(); }, []);
  return { playingId, progress, loop, setLoop, toggle, stop };
}

export function StoreProvider({ api, demo, createWorker, children }: { api: StacksApi; demo: boolean; createWorker?: () => Worker; children: ReactNode }) {
  const map = useRef(new Map<string, Sample>());
  const [rev, setRev] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setRev((r) => r + 1);
    }, 80);
  }, []);

  const [drives, setDrives] = useState<Drive[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [filters, setFiltersState] = useState<Filters>(defaultFilters);
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<Store['notice']>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setRunRev] = useState(0);

  const setNotice = useCallback((text: string, error = false) => {
    setNoticeState({ text, error });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNoticeState(null), 6000);
  }, []);

  // ---- library + drives + queue wiring ----
  useEffect(() => {
    const offSamples = api.onSamples((ups, removed) => {
      for (const id of removed) map.current.delete(id);
      for (const s of ups) map.current.set(s.id, s);
      flush();
    });
    const offDrives = api.onDrives(setDrives);
    const offQueue = api.onQueue(setQueue);
    void api.listDrives().then(setDrives);
    void api.listSamples().then((list) => {
      for (const s of list) if (!map.current.has(s.id)) map.current.set(s.id, s);
      flush();
    });
    return () => { offSamples(); offDrives(); offQueue(); };
  }, [api, flush]);

  // ---- analysis ----
  const runner = useRef<AnalysisRunner | null>(null);
  useEffect(() => {
    const r = new AnalysisRunner({
      api,
      createWorker: createWorker ?? createAnalysisWorker,
      nameOf: (id) => map.current.get(id)?.name,
      onDone: (id: string, analysis: Analysis) => {
        const s = map.current.get(id);
        if (s) map.current.set(id, { ...s, analysis });
        flush();
        setRunRev((n) => n + 1);
      },
      onChange: () => setRunRev((n) => n + 1)
    });
    runner.current = r;
    return () => { r.dispose(); runner.current = null; };
  }, [api, createWorker, flush]);

  const samples = useMemo(() => Array.from(map.current.values()), [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const need = samples.filter((s) => !s.analysis && s.path).map((s) => s.id);
    if (need.length) runner.current?.enqueue(need);
  }, [samples]);

  const byId = useCallback((id: string) => map.current.get(id), []);
  const selected = selectedId ? byId(selectedId) : undefined;

  const driveNames = useMemo(() => new Map(drives.map((d) => [d.id, d.name])), [drives]);
  const visible = useMemo(
    () => sortSamples(applyFilters(samples, filters, selected, driveNames), sort, driveNames, filters.groupByFolder),
    [samples, filters, selected, sort, driveNames]
  );

  useEffect(() => {
    if (!selectedId || !map.current.has(selectedId)) {
      if (visible[0]) setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    runner.current?.bump(id);
  }, []);

  const perDrive = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of samples) m.set(s.driveId, (m.get(s.driveId) ?? 0) + 1);
    return m;
  }, [samples]);

  const totals = useMemo(() => {
    let loops = 0, shots = 0, needs = 0;
    for (const s of samples) {
      const a = s.analysis;
      if (!a) { needs++; continue; }
      if (a.kind === 'loop') { loops++; if (a.bpm === null || a.keyShort === null) needs++; } else shots++;
    }
    return { all: samples.length, loops, shots, needs };
  }, [samples]);

  const preview = usePreview(api, byId);

  const rename = useCallback(async (id: string) => {
    const r = await api.renameWithMeta(id);
    if (r.ok) { setSelectedId(r.value.id); setNotice(`Renamed to ${r.value.name}`); } else setNotice(r.error, true);
  }, [api, setNotice]);

  const copy = useCallback(async (id: string, driveId: string) => {
    const r = await api.copyToDrive(id, driveId);
    if (r.ok) setNotice(`Copied to ${driveNames.get(driveId) ?? 'drive'}`); else setNotice(r.error, true);
  }, [api, driveNames, setNotice]);

  const importUrl = useCallback(async (url: string) => {
    const r = await api.importUrl(url);
    if (!r.ok) setNotice(r.error, true);
    return r.ok;
  }, [api, setNotice]);

  const setExcluded = useCallback(async (driveId: string, excluded: boolean) => {
    await api.setDriveExcluded(driveId, excluded);
    const name = driveNames.get(driveId) ?? 'Drive';
    setNotice(excluded ? `${name} excluded. It will not be scanned.` : `${name} included. Scanning.`);
  }, [api, driveNames, setNotice]);

  // A drive filter pointing at a drive that is now excluded would show an empty list with no way to tell why.
  useEffect(() => {
    if (filters.drive !== 'all' && drives.some((d) => d.id === filters.drive && d.excluded)) setFiltersState((f) => ({ ...f, drive: 'all', folder: '' }));
  }, [drives, filters.drive]);

  const openEditor = useCallback((id: string) => {
    preview.stop();
    setSelectedId(id);
    setEditingId(id);
  }, [preview]);
  const closeEditor = useCallback(() => setEditingId(null), []);
  const saveEdit = useCallback(async (id: string, wav: ArrayBuffer, target: EditTarget) => {
    const r = await api.writeEdit(id, wav, target);
    if (!r.ok) { setNotice(r.error, true); return null; }
    // Show the result straight away; the library event that follows carries the same entry.
    map.current.set(r.value.id, r.value);
    flush();
    const where = target.kind === 'new' && target.driveId ? ` to ${driveNames.get(target.driveId) ?? 'drive'} / Stacks` : '';
    setNotice(target.kind === 'replace' ? `Replaced ${r.value.name}. The original is in the Trash.` : `Saved ${r.value.name}${where}`);
    return r.value;
  }, [api, flush, setNotice, driveNames]);
  const editing = editingId ? byId(editingId) : undefined;

  const counts = runner.current?.counts ?? { queued: 0, running: 0 };
  const analysisCounts = { ...counts, done: samples.reduce((n, s) => n + (s.analysis ? 1 : 0), 0), total: samples.length };

  const value: Store = {
    api, demo, drives, mounted: drives.filter((d) => d.mounted && !d.excluded && d.id !== 'local'), samples, visible, selected, select,
    filters, setFilters: (patch) => setFiltersState((f) => ({ ...f, ...patch })), sort, setSort,
    queue, runState: runner.current?.state ?? new Map(), analysisCounts, driveNames, perDrive, totals, preview, notice,
    rename, copy, importUrl, setExcluded, editing, openEditor, closeEditor, saveEdit
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
