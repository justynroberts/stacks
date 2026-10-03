import { memo, useId, useMemo } from 'react';

interface Props {
  peaks: number[] | undefined;
  width: number;
  height: number;
  /** Horizontal resolution of the drawing. */
  bars: number;
  className?: string;
  /** 0..1. The part already played is drawn in the accent. */
  playhead?: number | null;
  /** Vertical lines at equal fractions, e.g. one per bar. */
  gridDivisions?: number;
  label?: string;
  /** Stretch to the parent's width; width and height then only set the drawing's proportions. */
  fluid?: boolean;
}

/** A filled, mirrored envelope, the way a DAW draws a clip. */
export const Waveform = memo(function Waveform({ peaks, width, height, bars, className, playhead, gridDivisions, label, fluid }: Props) {
  const clip = useId();
  const d = useMemo(() => {
    if (!peaks || !peaks.length) return '';
    const per = peaks.length / bars;
    const step = width / (bars - 1);
    const mid = height / 2;
    const half: number[] = [];
    for (let b = 0; b < bars; b++) {
      let m = 0;
      const from = Math.floor(b * per);
      for (let i = from; i < Math.max(from + 1, Math.floor((b + 1) * per)); i++) m = Math.max(m, peaks[i] ?? 0);
      half.push(Math.max(0.5, (m / 99) * mid));
    }
    const top = half.map((h, b) => `${(b * step).toFixed(1)} ${(mid - h).toFixed(1)}`);
    const bottom = half.map((h, b) => `${(b * step).toFixed(1)} ${(mid + h).toFixed(1)}`).reverse();
    return `M${top.join('L')}L${bottom.join('L')}Z`;
  }, [peaks, width, height, bars]);

  const grid = useMemo(() => {
    if (!gridDivisions) return '';
    let g = '';
    for (let i = 0; i <= gridDivisions; i++) g += `M${Math.min(width - 0.5, (i * width) / gridDivisions + 0.5).toFixed(1)} 0V${height}`;
    return g;
  }, [gridDivisions, width, height]);

  const played = playhead != null && playhead > 0 ? playhead * width : 0;

  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {grid && <path d={grid} stroke="var(--color-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      <path d={`M0 ${height / 2}H${width}`} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.5} />
      <path d={d} fill="currentColor" />
      {played > 0 && (
        <>
          <clipPath id={clip}><rect width={played} height={height} /></clipPath>
          <path d={d} fill="var(--color-accent)" clipPath={`url(#${clip})`} />
          <path d={`M${played.toFixed(1)} 0V${height}`} stroke="var(--color-fg)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
});
