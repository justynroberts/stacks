import { compatibleCamelot } from '@shared/camelot';
import { BPM_CEIL, BPM_FLOOR } from '@shared/dsp/bpm';
import type { Sample } from '@shared/types';

// Tempos are folded into one octave on analysis, so the filter covers exactly that.
export const BPM_MIN = BPM_FLOOR;
export const BPM_MAX = BPM_CEIL;

export interface Filters {
  drive: string;
  kind: 'all' | 'loop' | 'shot';
  needsMeta: boolean;
  query: string;
  bpm: [number, number];
  /** Only show things that mix with the selected sample (compatible key, tempo within 6%). */
  matchSelected: boolean;
  /** A folder on the selected drive ('' for all of it): the folder and everything below it. */
  folder: string;
  /** Order the list folder by folder, with a heading for each. */
  groupByFolder: boolean;
}

export const defaultFilters: Filters = {
  drive: 'all',
  kind: 'all',
  needsMeta: false,
  query: '',
  bpm: [BPM_MIN, BPM_MAX],
  matchSelected: false,
  folder: '',
  groupByFolder: false
};

/** The folder a sample sits in, relative to its drive, with forward slashes ('' at the top of the drive). */
export const dirOf = (relPath: string): string => {
  const parts = relPath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.join('/').replace(/^\/+/, '');
};

export interface FolderNode {
  /** What to show: one folder, or a chain of single folders joined ("Users/me/Downloads"). */
  name: string;
  /** Full folder path relative to the drive. */
  path: string;
  /** Samples here and in every folder below. */
  count: number;
  children: FolderNode[];
}

/**
 * The folder tree of one drive, from the samples in it, with counts. A folder whose only content is one other
 * folder is merged into it, so a deep path with nothing along the way is one line rather than five.
 */
export function folderTree(samples: Sample[], driveId: string): FolderNode[] {
  interface Raw { name: string; path: string; count: number; direct: number; kids: Map<string, Raw> }
  const root: Raw = { name: '', path: '', count: 0, direct: 0, kids: new Map() };
  for (const s of samples) {
    if (s.driveId !== driveId) continue;
    const dir = dirOf(s.relPath);
    let node = root;
    node.count++;
    if (!dir) { node.direct++; continue; }
    for (const part of dir.split('/')) {
      let next = node.kids.get(part);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, count: 0, direct: 0, kids: new Map() };
        node.kids.set(part, next);
      }
      next.count++;
      node = next;
    }
    node.direct++;
  }
  const finish = (r: Raw): FolderNode => {
    let name = r.name;
    let cur = r;
    while (cur.direct === 0 && cur.kids.size === 1) {
      cur = [...cur.kids.values()][0]!;
      name = `${name}/${cur.name}`;
    }
    return {
      name,
      path: cur.path,
      count: r.count,
      children: [...cur.kids.values()].sort((a, b) => collator.compare(a.name, b.name)).map(finish)
    };
  };
  return [...root.kids.values()].sort((a, b) => collator.compare(a.name, b.name)).map(finish);
}

export type SortKey = 'name' | 'bpm' | 'key' | 'len' | 'drive' | 'folder';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

export const bpmFilterActive = (f: Filters): boolean => f.bpm[0] > BPM_MIN || f.bpm[1] < BPM_MAX;

export function applyFilters(all: Sample[], f: Filters, selected: Sample | undefined, driveNames: Map<string, string>): Sample[] {
  const q = f.query.trim().toLowerCase();
  const active = bpmFilterActive(f);
  const mix = f.matchSelected && selected?.analysis ? selected.analysis : null;
  const mixKeys = mix ? compatibleCamelot(mix.camelot) : null;
  return all.filter((s) => {
    if (f.drive !== 'all' && s.driveId !== f.drive) return false;
    if (f.folder && f.drive !== 'all') {
      const dir = dirOf(s.relPath);
      if (dir !== f.folder && !dir.startsWith(`${f.folder}/`)) return false;
    }
    const a = s.analysis;
    if (f.kind !== 'all' && a && a.kind !== f.kind) return false;
    if (f.kind !== 'all' && !a) return false;
    if (f.needsMeta && a && !(a.kind === 'loop' && (a.bpm === null || a.keyShort === null))) return false;
    if (active) {
      if (!a || a.bpm === null || a.bpm < f.bpm[0] || a.bpm > f.bpm[1]) return false;
    }
    if (mix) {
      if (s.id === selected!.id) return true;
      if (!a) return false;
      if (mixKeys && mixKeys.size && (!a.camelot || !mixKeys.has(a.camelot))) return false;
      if (mix.bpm && a.bpm && Math.abs(a.bpm - mix.bpm) / mix.bpm > 0.06) return false;
    }
    if (q) {
      const hay = `${s.name} ${dirOf(s.relPath)} ${a?.key ?? ''} ${a?.keyShort ?? ''} ${a?.camelot ?? ''} ${a?.bpm ?? ''} ${driveNames.get(s.driveId) ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The key a sample is grouped under: drive, then folder. */
export const folderKey = (s: Sample, driveNames: Map<string, string>): string => `${driveNames.get(s.driveId) ?? ''}\u0000${dirOf(s.relPath)}`;

export function sortSamples(list: Sample[], sort: Sort, driveNames: Map<string, string>, groupByFolder = false): Sample[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const val = (s: Sample): string | number | null => {
    switch (sort.key) {
      case 'name': return s.name;
      case 'bpm': return s.analysis?.bpm ?? null;
      case 'key': return s.analysis?.camelot ? parseInt(s.analysis.camelot, 10) * 2 + (s.analysis.camelot.endsWith('B') ? 1 : 0) : null;
      case 'len': return s.analysis?.durationSec ?? null;
      case 'drive': return driveNames.get(s.driveId) ?? '';
      case 'folder': return `${driveNames.get(s.driveId) ?? ''}/${dirOf(s.relPath)}`;
    }
  };
  return [...list].sort((a, b) => {
    if (groupByFolder) {
      const g = collator.compare(folderKey(a, driveNames), folderKey(b, driveNames));
      if (g) return g;
    }
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return collator.compare(a.name, b.name);
    if (x === null) return 1; // unknowns sink to the bottom in either direction
    if (y === null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir || collator.compare(a.name, b.name);
    return collator.compare(String(x), String(y)) * dir || collator.compare(a.name, b.name);
  });
}

export const fmtLen = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export const fmtBytes = (n: number): string => {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2).replace(/\.?0+$/, '')} TB`;
  if (n >= 1e9) return `${Math.round(n / 1e9)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
};
