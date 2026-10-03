const EXT_RE = /\.([A-Za-z0-9]{2,5})$/;
const KEY_TOKEN = /^[A-G](?:#|b)?m?$/;

export function splitName(name: string): { base: string; ext: string } {
  const m = EXT_RE.exec(name);
  if (!m) return { base: name, ext: '' };
  return { base: name.slice(0, -m[0].length), ext: m[1]!.toLowerCase() };
}

/** A tempo written into the file name ("140bpm", "_172"), if there is a believable one. */
export function bpmFromName(name: string): number | null {
  const { base } = splitName(name);
  const explicit = /(\d{2,3})\s*bpm/i.exec(base);
  if (explicit) {
    const v = Number(explicit[1]);
    if (v >= 50 && v <= 220) return v;
  }
  const tokens = base.split(/[_\-\s.]+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (/^\d{2,3}$/.test(t)) {
      const v = Number(t);
      if (v >= 60 && v <= 200) return v;
    }
  }
  return null;
}

/** Within 4% of the tempo, or of double or half it (tempos are folded, so a "172" in the name can mean 86). */
const nearTempo = (v: number, bpm: number): boolean => [bpm, bpm * 2, bpm / 2].some((t) => Math.abs(v - t) / t < 0.04);

/**
 * The descriptive part of a name, with key and tempo tags removed: ours ("_Am_84bpm" at the end, or the older
 * "084_Am_" prefix) and the pack's own. A bare trailing number only counts as a tempo when it matches `bpm`,
 * so "kick_01" keeps its number.
 */
export function cleanBase(name: string, bpm: number | null = null, keyShort: string | null = null): string {
  let { base } = splitName(name);
  base = base.replace(/^(?:0[5-9]\d|1\d\d|2[01]\d|220)_[A-G](?:#|b)?m?_/, '').replace(/^0[5-9]\d_/, '');
  const lead = /^(\d{3})_/.exec(base);
  if (lead && bpm && nearTempo(Number(lead[1]), bpm)) base = base.slice(lead[0].length);
  if (keyShort && base.startsWith(`${keyShort}_`)) base = base.slice(keyShort.length + 1);
  const parts = base.split('_');
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    const bare = /^\d{2,3}$/.test(last) && bpm !== null && nearTempo(Number(last), bpm);
    if (KEY_TOKEN.test(last) || /^\d{2,3}bpm$/i.test(last) || bare) parts.pop();
    else break;
  }
  return parts.join('_');
}

/** "rhodes_loop_dusty.wav" -> "rhodes_loop_dusty_Am_84bpm.wav". Tags go at the end so sort order never changes. */
export function buildName(name: string, bpm: number | null, keyShort: string | null): string | null {
  if (!bpm && !keyShort) return null;
  const { ext } = splitName(name);
  const bits = [cleanBase(name, bpm, keyShort)];
  if (keyShort) bits.push(keyShort);
  if (bpm) bits.push(`${Math.round(bpm)}bpm`);
  return `${bits.join('_')}${ext ? '.' + ext : ''}`;
}

/**
 * Name for a file made in the editor: "_edit" (or another label, such as "loop_2bar") goes before any key / tempo
 * tags, so a later rename still finds them at the end. Always .wav, since that is what the editor writes.
 */
export function editName(name: string, bpm: number | null, keyShort: string | null, label = 'edit'): string {
  const { base } = splitName(name);
  const clean = cleanBase(name, bpm, keyShort);
  const tail = base.startsWith(clean) ? base.slice(clean.length) : '';
  return `${clean}_${label}${tail}.wav`;
}
