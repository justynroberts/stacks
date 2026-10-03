// Pitch classes 0..11 starting at C.
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export interface KeyInfo {
  /** "A min" / "Eb maj" */
  key: string;
  /** "Am" / "Eb" */
  keyShort: string;
  /** "8A" */
  camelot: string;
}

export function keyInfo(pc: number, minor: boolean): KeyInfo {
  const p = ((pc % 12) + 12) % 12;
  if (minor) {
    const n = MINOR_NAMES[p]!;
    return { key: `${n} min`, keyShort: `${n}m`, camelot: `${MINOR_CAMELOT[p]}A` };
  }
  const n = MAJOR_NAMES[p]!;
  return { key: `${n} maj`, keyShort: n, camelot: `${MAJOR_CAMELOT[p]}B` };
}

const wrap = (n: number): number => ((n - 1 + 12) % 12) + 1;

/** Camelot codes that mix cleanly with `camelot` (itself, +-1, relative major/minor). */
export function compatibleCamelot(camelot: string | null): Map<string, 'self' | 'near'> {
  const out = new Map<string, 'self' | 'near'>();
  if (!camelot) return out;
  const n = parseInt(camelot, 10);
  const letter = camelot.slice(-1);
  if (!n || (letter !== 'A' && letter !== 'B')) return out;
  const other = letter === 'A' ? 'B' : 'A';
  out.set(`${n}${letter}`, 'self');
  out.set(`${wrap(n + 1)}${letter}`, 'near');
  out.set(`${wrap(n - 1)}${letter}`, 'near');
  out.set(`${n}${other}`, 'near');
  return out;
}

export const CAMELOT_CODES: string[] = ['A', 'B'].flatMap((l) => Array.from({ length: 12 }, (_, i) => `${i + 1}${l}`));
