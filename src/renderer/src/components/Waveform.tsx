import { memo, useMemo } from 'react';

interface Props {
  peaks: number[] | undefined;
  width: number;
  height: number;
  bars: number;
  strokeWidth?: number;
  className?: string;
  /** 0..1 */
  playhead?: number | null;
  /** Vertical lines at equal fractions, e.g. 8 for a beat grid. */
  gridDivisions?: number;
  label?: string;
}

export const Waveform = memo(function Waveform({ peaks, width, height, bars, strokeWidth = 1.5, className, playhead, gridDivisions, label }: Props) {
  const d = useMemo(() => {
    if (!peaks || !peaks.length) return '';
    const per = peaks.length / bars;
    const step = width / bars;
    let out = '';
    for (let b = 0; b < bars; b++) {
      let m = 0;
      for (let i = Math.floor(b * per); i < Math.max(Math.floor(b * per) + 1, Math.floor((b + 1) * per)); i++) m = Math.max(m, peaks[i] ?? 0);
      const half = Math.max(0.6, (m / 99) * (height / 2));
      const x = (b * step + step / 2).toFixed(1);
      out += `M${x} ${(height / 2 - half).toFixed(1)}V${(height / 2 + half).toFixed(1)}`;
    }
    return out;
  }, [peaks, width, height, bars]);

  const grid = useMemo(() => {
    if (!gridDivisions) return '';
    let g = '';
    for (let i = 0; i <= gridDivisions; i++) g += `M${Math.min(width - 0.5, (i * width) / gridDivisions + 0.5).toFixed(1)} 0V${height}`;
    return g;
  }, [gridDivisions, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" className={className} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {grid && <path d={grid} stroke="var(--color-line-strong)" strokeWidth={1} />}
      <path d={d} stroke="currentColor" strokeWidth={strokeWidth} />
      {playhead != null && playhead > 0 && <path d={`M${(playhead * width).toFixed(1)} 0V${height}`} stroke="var(--color-fg)" strokeWidth={1} />}
    </svg>
  );
});
