import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { splitName } from '@shared/filename';
import { type Analysis, ANALYSIS_VERSION, type Drive, LOCAL_DRIVE_ID, type Sample } from '@shared/types';

interface Stored {
  id: string;
  driveId: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  analysis?: Analysis;
}

interface Persisted {
  version: 1;
  drives: Record<string, Drive>;
  samples: Record<string, Stored>;
}

export const sampleId = (driveId: string, relPath: string): string =>
  createHash('sha1').update(`${driveId}\0${relPath}`).digest('hex').slice(0, 16);

export class Library {
  private samples = new Map<string, Stored>();
  private drives = new Map<string, Drive>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(private file: string, private resolve: (driveId: string, relPath: string) => string | null) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as Persisted;
      if (data.version !== 1) return;
      for (const [k, v] of Object.entries(data.samples)) this.samples.set(k, v);
      for (const [k, v] of Object.entries(data.drives)) this.drives.set(k, v);
    } catch {
      /* first run, or unreadable cache: start empty */
    }
  }

  private schedule(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.flush(), 1500);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const data: Persisted = { version: 1, drives: Object.fromEntries(this.drives), samples: Object.fromEntries(this.samples) };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, this.file);
  }

  rememberDrives(live: Drive[]): Drive[] {
    for (const d of live) this.drives.set(d.id, { ...d, mounted: true });
    this.schedule();
    return this.driveList(live);
  }

  /** Mounted drives first, then drives we have seen before that are not plugged in. */
  driveList(live: Drive[]): Drive[] {
    const liveIds = new Set(live.map((d) => d.id));
    const offline = [...this.drives.values()].filter((d) => !liveIds.has(d.id) && d.id !== LOCAL_DRIVE_ID).map((d) => ({ ...d, mounted: false }));
    return [...live, ...offline];
  }

  toSample(s: Stored): Sample {
    const { base, ext } = splitName(path.basename(s.relPath));
    return {
      id: s.id,
      driveId: s.driveId,
      relPath: s.relPath,
      path: this.resolve(s.driveId, s.relPath),
      name: ext ? `${base}.${ext}` : base,
      ext,
      size: s.size,
      mtimeMs: s.mtimeMs,
      analysis: s.analysis
    };
  }

  all(): Sample[] {
    return [...this.samples.values()].map((s) => this.toSample(s));
  }

  get(id: string): Stored | undefined {
    return this.samples.get(id);
  }

  /** Insert or refresh files. Analysis survives only if the file is unchanged. Returns what changed. */
  upsert(driveId: string, files: Array<{ relPath: string; size: number; mtimeMs: number }>): Sample[] {
    const changed: Sample[] = [];
    for (const f of files) {
      const id = sampleId(driveId, f.relPath);
      const prev = this.samples.get(id);
      const same = prev && prev.size === f.size && Math.abs(prev.mtimeMs - f.mtimeMs) < 1;
      if (same && prev.analysis?.version === ANALYSIS_VERSION) continue;
      const next: Stored = { id, driveId, relPath: f.relPath, size: f.size, mtimeMs: f.mtimeMs, analysis: same ? prev.analysis : undefined };
      this.samples.set(id, next);
      changed.push(this.toSample(next));
    }
    if (changed.length) this.schedule();
    return changed;
  }

  idsForDrive(driveId: string): string[] {
    return [...this.samples.values()].filter((s) => s.driveId === driveId).map((s) => s.id);
  }

  remove(ids: string[]): void {
    for (const id of ids) this.samples.delete(id);
    if (ids.length) this.schedule();
  }

  setAnalysis(id: string, analysis: Analysis): Sample | null {
    const s = this.samples.get(id);
    if (!s) return null;
    s.analysis = analysis;
    this.schedule();
    return this.toSample(s);
  }

  /** Point an existing entry at a new relative path (after a rename on disk). */
  move(id: string, relPath: string, mtimeMs: number): Sample | null {
    const s = this.samples.get(id);
    if (!s) return null;
    this.samples.delete(id);
    const next: Stored = { ...s, id: sampleId(s.driveId, relPath), relPath, mtimeMs };
    this.samples.set(next.id, next);
    this.schedule();
    return this.toSample(next);
  }
}
