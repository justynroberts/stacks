import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isAudioExt } from '@shared/types';

export interface ScannedFile { abs: string; size: number; mtimeMs: number }

const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', 'lost+found', 'node_modules', '__MACOSX']);

/** Depth first walk that hands back audio files in batches. Hidden files and OS junk are skipped. */
export async function scan(
  root: string,
  onBatch: (files: ScannedFile[]) => void,
  opts: { signal?: AbortSignal; batchSize?: number } = {}
): Promise<number> {
  const batchSize = opts.batchSize ?? 250;
  let batch: ScannedFile[] = [];
  let total = 0;
  const flush = () => {
    if (batch.length) { onBatch(batch); batch = []; }
  };

  async function walk(dir: string): Promise<void> {
    if (opts.signal?.aborted) return;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for await (const entry of handle) {
      if (opts.signal?.aborted) return;
      const name = entry.name;
      if (name.startsWith('.') || name.startsWith('._')) continue;
      const abs = path.join(dir, name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(name)) subdirs.push(abs);
      } else if (entry.isFile()) {
        const ext = path.extname(name).slice(1);
        if (!isAudioExt(ext)) continue;
        try {
          const st = await stat(abs);
          batch.push({ abs, size: st.size, mtimeMs: st.mtimeMs });
          total++;
          if (batch.length >= batchSize) flush();
        } catch { /* vanished mid scan */ }
      }
    }
    for (const d of subdirs) await walk(d);
  }

  await walk(root);
  flush();
  return total;
}
