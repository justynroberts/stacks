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
}

export const defaultFilters: Filters = {
  drive: 'all',
  kind: 'all',
  needsMeta: false,
  query: '',
  bpm: [BPM_MIN, BPM_MAX],
  matchSelected: false
};

export type SortKey = 'name' | 'bpm' | 'key' | 'len' | 'drive';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

export const bpmFilterActive = (f: Filters): boolean => f.bpm[0] > BPM_MIN || f.bpm[1] < BPM_MAX;

export function applyFilters(all: Sample[], f: Filters, selected: Sample | undefined, driveNames: Map<string, string>): Sample[] {
  const q = f.query.trim().toLowerCase();
  const active = bpmFilterActive(f);
  const mix = f.matchSelected && selected?.analysis ? selected.analysis : null;
  const mixKeys = mix ? compatibleCamelot(mix.camelot) : null;
  return all.filter((s) => {
    if (f.drive !== 'all' && s.driveId !== f.drive) return false;
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
      const hay = `${s.name} ${a?.key ?? ''} ${a?.keyShort ?? ''} ${a?.camelot ?? ''} ${a?.bpm ?? ''} ${driveNames.get(s.driveId) ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortSamples(list: Sample[], sort: Sort, driveNames: Map<string, string>): Sample[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const val = (s: Sample): string | number | null => {
    switch (sort.key) {
      case 'name': return s.name;
      case 'bpm': return s.analysis?.bpm ?? null;
      case 'key': return s.analysis?.camelot ? parseInt(s.analysis.camelot, 10) * 2 + (s.analysis.camelot.endsWith('B') ? 1 : 0) : null;
      case 'len': return s.analysis?.durationSec ?? null;
      case 'drive': return driveNames.get(s.driveId) ?? '';
    }
  };
  return [...list].sort((a, b) => {
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
