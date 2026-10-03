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

/** The descriptive part of a name, with any BPM / key tags we (or the pack) added removed. */
export function cleanBase(name: string): string {
  let { base } = splitName(name);
  // We always write the tempo as three digits (050..220), so only that shape counts as ours.
  base = base.replace(/^(?:0[5-9]\d|1\d\d|2[01]\d|220)_(?:[A-G](?:#|b)?m?_)?/, '');
  const parts = base.split('_');
  while (parts.length > 1) {
    const last = parts[parts.length - 1]!;
    if (KEY_TOKEN.test(last) || /^\d{2,3}(bpm)?$/i.test(last)) parts.pop();
    else break;
  }
  return parts.join('_');
}

export function buildName(name: string, bpm: number | null, keyShort: string | null): string | null {
  if (!bpm && !keyShort) return null;
  const { ext } = splitName(name);
  const bits: string[] = [];
  if (bpm) bits.push(String(Math.round(bpm)).padStart(3, '0'));
  if (keyShort) bits.push(keyShort);
  const prefix = bits.join('_');
  if (splitName(name).base.startsWith(prefix + '_')) return name;
  bits.push(cleanBase(name));
  return `${bits.join('_')}${ext ? '.' + ext : ''}`;
}
