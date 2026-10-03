import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { isAudioExt } from '@shared/types';

export interface UnzipLimits {
  /** Total uncompressed audio bytes we are willing to write. */
  maxBytes: number;
  maxEntries: number;
}

export const DEFAULT_LIMITS: UnzipLimits = { maxBytes: 8 * 1024 ** 3, maxEntries: 50_000 };

const S_IFMT = 0xf000;
const S_IFREG = 0x8000;

/**
 * Unpack the audio files from a zip, and nothing else.
 *
 * Packs come from the internet, so this never writes a symlink, never writes outside `dest`, ignores every
 * entry that is not an audio file, and stops at a size and entry limit (zip bombs). Returns how many files it wrote.
 */
export function extractAudio(zipPath: string, dest: string, limits: UnzipLimits = DEFAULT_LIMITS): Promise<number> {
  const root = path.resolve(dest);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Could not open the zip'));
      let written = 0;
      let bytes = 0;
      let entries = 0;
      let failed = false;
      const fail = (e: Error) => {
        if (failed) return;
        failed = true;
        zip.close();
        reject(e);
      };

      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(written); });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (++entries > limits.maxEntries) return fail(new Error('Zip has too many entries'));
        const name = entry.fileName;
        const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const type = mode & S_IFMT;
        const isDir = name.endsWith('/');
        // Skip directories (made on demand), symlinks and devices, and anything that is not audio.
        if (isDir || (type !== 0 && type !== S_IFREG) || !isAudioExt(path.extname(name).slice(1))) return zip.readEntry();
        // Hidden files and resource forks are noise (and __MACOSX is full of them).
        if (name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) return zip.readEntry();

        bytes += entry.uncompressedSize;
        if (bytes > limits.maxBytes) return fail(new Error('Zip is larger than the unpack limit'));

        const target = path.resolve(root, name);
        if (target !== root && !target.startsWith(root + path.sep)) return fail(new Error('Zip contains an unsafe path'));

        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return fail(e ?? new Error('Could not read zip entry'));
          fs.mkdir(path.dirname(target), { recursive: true })
            // 'wx' refuses to write through anything that already exists, including a planted link.
            .then(() => pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o644 })))
            .then(() => { written++; zip.readEntry(); })
            .catch((we: Error) => {
              if ((we as NodeJS.ErrnoException).code === 'EEXIST') { zip.readEntry(); return; }
              fail(we);
            });
        });
      });
      zip.readEntry();
    });
  });
}
