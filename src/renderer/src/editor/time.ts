/** 1:02.345 */
export function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** Accepts "1:02.345", "62.345" or "62". Null when it is not a time. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  const m = /^(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(t);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

/** The smallest tidy ruler interval that keeps labels at least minPx apart. */
export function rulerStep(secPerPx: number, minPx = 72): number {
  return STEPS.find((s) => s / secPerPx >= minPx) ?? STEPS[STEPS.length - 1]!;
}

export function fmtRuler(sec: number, step: number): string {
  const m = Math.floor(sec / 60);
  const rest = sec - m * 60;
  const digits = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const s = rest.toFixed(digits);
  return m > 0 ? `${m}:${s.padStart(digits ? digits + 3 : 2, '0')}` : s;
}
