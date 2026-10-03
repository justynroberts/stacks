import { createWriteStream, promises as fs, constants as fsc } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadable } from 'node:stream/web';
import { app, net, shell } from 'electron';
import { buildName, editName } from '@shared/filename';
import { type Analysis, type Drive, type EditTarget, isAudioExt, LOCAL_DRIVE_ID, type QueueItem, type Result, type Sample } from '@shared/types';
import { DriveWatcher, localDrive } from './drives';
import { Library, sampleId } from './library';
import { JobQueue } from './queue';
import { scan, type ScannedFile } from './scanner';
import { extractAudio } from './unzip';

const MAX_READ = 400 * 1024 * 1024;
const MAX_DOWNLOAD = 2 * 1024 * 1024 * 1024;
const MAX_EDIT = 1024 * 1024 * 1024;

/** The page sends an ArrayBuffer; only accept something that at least looks like a WAV file. */
function wavBytes(x: unknown): Buffer | null {
  const b = x instanceof ArrayBuffer ? Buffer.from(x) : x instanceof Uint8Array ? Buffer.from(x.buffer, x.byteOffset, x.byteLength) : null;
  if (!b || b.length < 44 || b.length > MAX_EDIT) return null;
  return b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE' ? b : null;
}

export interface Emit {
  drives(d: Drive[]): void;
  samples(upserts: Sample[], removed: string[]): void;
  queue(items: QueueItem[]): void;
}

const safeName = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim() || 'download';

async function uniquePath(p: string): Promise<string> {
  const { dir, name, ext } = path.parse(p);
  let candidate = p;
  for (let i = 2; ; i++) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${name}_${i}${ext}`);
    } catch {
      return candidate;
    }
  }
}

export class Services {
  readonly watcher: DriveWatcher;
  readonly library: Library;
  private queue: JobQueue;
  private known = new Set<string>();

  constructor(private emit: Emit) {
    this.watcher = new DriveWatcher((live) => this.onDrives(live));
    this.library = new Library(path.join(app.getPath('userData'), 'library.json'), (d, r) => this.resolve(d, r));
    this.queue = new JobQueue((items) => emit.queue(items));
  }

  async start(): Promise<void> {
    await this.library.load();
    const live = await this.watcher.start();
    this.onDrives(live);
  }

  async stop(): Promise<void> {
    this.watcher.stop();
    await this.library.flush();
  }

  // ---- paths ----

  resolve(driveId: string, relPath: string): string | null {
    if (driveId === LOCAL_DRIVE_ID) return relPath;
    const d = this.watcher.drives.find((x) => x.id === driveId);
    return d ? path.join(d.mount, relPath) : null;
  }

  private locate(abs: string): { driveId: string; relPath: string } {
    const d = this.watcher.driveForPath(abs);
    return d ? { driveId: d.id, relPath: path.relative(d.mount, abs) } : { driveId: LOCAL_DRIVE_ID, relPath: abs };
  }

  private absFor(id: string): string | null {
    const s = this.library.get(id);
    return s ? this.resolve(s.driveId, s.relPath) : null;
  }

  // ---- drives ----

  driveList(): Drive[] {
    return [localDrive(), ...this.library.driveList(this.watcher.drives)];
  }

  private onDrives(live: Drive[]): void {
    this.library.rememberDrives(live);
    this.emit.drives(this.driveList());
    for (const d of live) {
      const key = `${d.id}@${d.mount}`;
      if (this.known.has(key)) continue;
      this.known.add(key);
      this.scanDrive(d.id);
    }
  }

  setDriveExcluded(driveId: string, excluded: boolean): void {
    if (!this.library.setExcluded(driveId, excluded)) return;
    if (excluded) this.emit.samples([], this.library.idsForDrive(driveId));
    else this.emit.samples(this.library.forDrive(driveId), []);
    this.emit.drives(this.driveList());
    if (!excluded) this.scanDrive(driveId);
  }

  scanDrive(driveId: string): void {
    const d = this.watcher.drives.find((x) => x.id === driveId);
    if (!d || this.library.isExcluded(driveId)) return;
    this.queue.add(`Scan ${d.name}`, async (update) => {
      update({ stage: 'scanning', progress: -1 });
      const seen = new Set<string>();
      let completed = true;
      try {
        await scan(d.mount, (files) => {
          this.ingest(files);
          for (const f of files) seen.add(this.idFor(f.abs));
        });
      } catch {
        completed = false;
      }
      if (completed && !this.library.isExcluded(d.id)) {
        const gone = this.library.idsForDrive(d.id).filter((id) => !seen.has(id));
        if (gone.length) {
          this.library.remove(gone);
          this.emit.samples([], gone);
        }
      }
    });
  }

  private idFor(abs: string): string {
    const { driveId, relPath } = this.locate(abs);
    return sampleId(driveId, relPath);
  }

  // ---- ingest ----

  private ingest(files: ScannedFile[]): Sample[] {
    const byDrive = new Map<string, Array<{ relPath: string; size: number; mtimeMs: number }>>();
    for (const f of files) {
      const { driveId, relPath } = this.locate(f.abs);
      if (this.library.isExcluded(driveId)) continue;
      const list = byDrive.get(driveId) ?? [];
      list.push({ relPath, size: f.size, mtimeMs: f.mtimeMs });
      byDrive.set(driveId, list);
    }
    const changed: Sample[] = [];
    for (const [driveId, list] of byDrive) changed.push(...this.library.upsert(driveId, list));
    if (changed.length) this.emit.samples(changed, []);
    return changed;
  }

  // ---- importing ----

  addPaths(paths: string[]): void {
    for (const p of paths) {
      void fs.stat(p).then(
        (st) => {
          const ext = path.extname(p).slice(1).toLowerCase();
          if (st.isDirectory()) this.scanFolder(p);
          else if (ext === 'zip') this.importZip(p);
          else if (isAudioExt(ext)) this.ingest([{ abs: p, size: st.size, mtimeMs: st.mtimeMs }]);
        },
        () => undefined
      );
    }
  }

  private scanFolder(dir: string): void {
    this.queue.add(`Add ${path.basename(dir)}`, async (update) => {
      update({ stage: 'scanning', progress: -1 });
      await scan(dir, (files) => this.ingest(files));
    });
  }

  private importZip(zip: string, label = path.basename(zip)): void {
    this.queue.add(label, async (update) => {
      update({ stage: 'unpacking', progress: -1 });
      const out = await uniquePath(path.join(app.getPath('music'), 'Stacks Imports', path.parse(zip).name));
      await fs.mkdir(out, { recursive: true });
      await extractAudio(zip, out);
      update({ stage: 'scanning', progress: -1 });
      await scan(out, (files) => this.ingest(files));
    });
  }

  importUrl(raw: string): Result<true> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { ok: false, error: 'That does not look like a link' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Only http and https links work' };
    const label = decodeURIComponent(path.basename(url.pathname)) || url.hostname;
    this.queue.add(label, async (update) => {
      update({ stage: 'downloading', progress: 0 });
      const res = await net.fetch(url.toString(), { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
      const finalUrl = new URL(res.url || url.toString());
      const name = safeName(path.basename(cd?.[1] ? decodeURIComponent(cd[1]) : decodeURIComponent(finalUrl.pathname)));
      const ext = path.extname(name).slice(1).toLowerCase();
      if (ext !== 'zip' && !isAudioExt(ext)) throw new Error('That link is not an audio file or a zip pack');
      update({ label: name });
      const total = Number(res.headers.get('content-length')) || 0;
      if (total > MAX_DOWNLOAD) throw new Error('File is larger than 2 GB');
      const dir = path.join(app.getPath('downloads'), 'Stacks');
      await fs.mkdir(dir, { recursive: true });
      const dest = await uniquePath(path.join(dir, name));
      let got = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          got += chunk.length;
          if (got > MAX_DOWNLOAD) return cb(new Error('File is larger than 2 GB'));
          if (total) update({ progress: got / total });
          cb(null, chunk);
        }
      });
      try {
        await pipeline(Readable.fromWeb(res.body as unknown as WebReadable), counter, createWriteStream(dest));
      } catch (e) {
        await fs.rm(dest, { force: true });
        throw e;
      }
      if (ext === 'zip') {
        update({ stage: 'unpacking', progress: -1 });
        const out = await uniquePath(path.join(app.getPath('music'), 'Stacks Imports', path.parse(dest).name));
        await fs.mkdir(out, { recursive: true });
        await extractAudio(dest, out);
        update({ stage: 'scanning', progress: -1 });
        await scan(out, (files) => this.ingest(files));
      } else {
        const st = await fs.stat(dest);
        this.ingest([{ abs: dest, size: st.size, mtimeMs: st.mtimeMs }]);
      }
    });
    return { ok: true, value: true };
  }

  // ---- per file actions ----

  async readHead(id: string, maxBytes: number): Promise<{ bytes: ArrayBuffer; total: number }> {
    const abs = this.absFor(id);
    if (!abs) throw new Error('Drive is not connected');
    const want = Math.max(1, Math.min(Number.isFinite(maxBytes) ? Math.floor(maxBytes) : MAX_READ, MAX_READ));
    const fh = await fs.open(abs, 'r');
    try {
      const { size } = await fh.stat();
      const buf = Buffer.alloc(Math.min(want, size));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) as ArrayBuffer, total: size };
    } finally {
      await fh.close();
    }
  }

  async readFile(id: string): Promise<ArrayBuffer> {
    const abs = this.absFor(id);
    if (!abs) throw new Error('Drive is not connected');
    const st = await fs.stat(abs);
    if (st.size > MAX_READ) throw new Error('File is too large to analyse');
    const buf = await fs.readFile(abs);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  saveAnalysis(id: string, a: Analysis): void {
    if (!a || !Array.isArray(a.peaks) || a.peaks.length > 256) return;
    this.library.setAnalysis(id, a);
  }

  async renameWithMeta(id: string): Promise<Result<Sample>> {
    const stored = this.library.get(id);
    const abs = this.absFor(id);
    if (!stored || !abs) return { ok: false, error: 'Drive is not connected' };
    const a = stored.analysis;
    if (!a) return { ok: false, error: 'Not analysed yet' };
    const next = buildName(path.basename(abs), a.bpm, a.keyShort);
    if (!next) return { ok: false, error: 'No key or BPM to write' };
    if (next === path.basename(abs)) return { ok: true, value: this.library.toSample(stored) };
    try {
      const dest = await uniquePath(path.join(path.dirname(abs), next));
      await fs.rename(abs, dest);
      const st = await fs.stat(dest);
      const rel = this.locate(dest).relPath;
      const moved = this.library.move(id, rel, st.mtimeMs);
      if (!moved) return { ok: false, error: 'Renamed on disk but lost track of the entry. Rescan the drive.' };
      this.emit.samples([moved], [id]);
      return { ok: true, value: moved };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async writeEdit(id: string, wav: unknown, target: EditTarget): Promise<Result<Sample>> {
    const stored = this.library.get(id);
    const abs = this.absFor(id);
    if (!stored || !abs) return { ok: false, error: 'Drive is not connected' };
    const bytes = wavBytes(wav);
    if (!bytes) return { ok: false, error: 'The edit did not produce a valid WAV file' };
    const dir = path.dirname(abs);
    const indexed = async (dest: string): Promise<Result<Sample>> => {
      const st = await fs.stat(dest);
      const [changed] = this.ingest([{ abs: dest, size: st.size, mtimeMs: st.mtimeMs }]);
      const sample = changed ?? this.library.all().find((s) => s.path === dest);
      return sample ? { ok: true, value: sample } : { ok: false, error: 'Saved, but the file was not indexed. Rescan the drive.' };
    };
    try {
      if (target.kind === 'new') {
        let into = dir;
        if (target.driveId !== null) {
          const d = this.watcher.drives.find((x) => x.id === target.driveId);
          if (!d || this.library.isExcluded(d.id)) return { ok: false, error: 'That drive is not connected' };
          into = path.join(d.mount, 'Stacks');
          await fs.mkdir(into, { recursive: true });
        }
        const a = stored.analysis;
        const dest = await uniquePath(path.join(into, editName(path.basename(abs), a?.bpm ?? null, a?.keyShort ?? null, target.label)));
        await fs.writeFile(dest, bytes, { flag: 'wx' });
        return await indexed(dest);
      }
      // Replace: write beside the original first (hidden, so a scan never picks it up), then trash, then swap in.
      const { name, ext } = path.parse(abs);
      const tmp = path.join(dir, `.${name}.stacks-edit.tmp`);
      await fs.writeFile(tmp, bytes);
      try {
        await shell.trashItem(abs);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        return { ok: false, error: `Could not move the original to the Trash, so nothing was replaced (${e instanceof Error ? e.message : e})` };
      }
      const dest = ext.toLowerCase() === '.wav' ? abs : await uniquePath(path.join(dir, `${name}.wav`));
      await fs.rename(tmp, dest);
      if (dest !== abs) {
        this.library.remove([id]);
        this.emit.samples([], [id]);
      }
      return await indexed(dest);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return { ok: false, error: err.code === 'ENOSPC' ? 'Not enough space on the drive' : err.message };
    }
  }

  async copyToDrive(id: string, driveId: string): Promise<Result<Sample>> {
    const abs = this.absFor(id);
    const target = this.watcher.drives.find((d) => d.id === driveId);
    if (!abs) return { ok: false, error: 'Source drive is not connected' };
    if (!target) return { ok: false, error: 'Target drive is not connected' };
    try {
      const dir = path.join(target.mount, 'Stacks');
      await fs.mkdir(dir, { recursive: true });
      const dest = await uniquePath(path.join(dir, path.basename(abs)));
      await fs.copyFile(abs, dest, fsc.COPYFILE_EXCL);
      const st = await fs.stat(dest);
      const [added] = this.ingest([{ abs: dest, size: st.size, mtimeMs: st.mtimeMs }]);
      const src = this.library.get(id)?.analysis;
      const sample = added ?? this.library.all().find((s) => s.path === dest);
      if (!sample) return { ok: false, error: 'Copied, but the new file was not indexed' };
      if (src) this.library.setAnalysis(sample.id, src);
      return { ok: true, value: { ...sample, analysis: src ?? sample.analysis } };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      return { ok: false, error: err.code === 'ENOSPC' ? 'Not enough space on the target drive' : err.message };
    }
  }

  reveal(id: string): void {
    const abs = this.absFor(id);
    if (abs) shell.showItemInFolder(abs);
  }

  pathForDrag(id: string): string | null {
    return this.absFor(id);
  }
}

