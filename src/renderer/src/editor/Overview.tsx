import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { frameCount, type PcmAudio } from '@shared/audio/wav';
import { span, type Summary } from './peaks';
import { fit, palette, type View } from './WaveView';

/** The whole sample in one strip, with the visible window drawn on it. Drag to move the window. */
export function Overview({ audio, summary, view, width, sel, onView }: { audio: PcmAudio; summary: Summary; view: View; width: number; sel: readonly [number, number]; onView(v: View): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = frameCount(audio);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const got = fit(c);
    if (!got) return;
    const { ctx, w, h } = got;
    const p = palette();
    const fpp = n / w;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = p.raised;
    ctx.fillRect(0, 0, w, h);
    const [s, e] = sel;
    if (e > s) { ctx.fillStyle = p.sel; ctx.fillRect((s / n) * w, 0, ((e - s) / n) * w, h); }
    const mid = h / 2, amp = h / 2 - 3;
    ctx.fillStyle = p.muted;
    for (let px = 0; px < w; px++) {
      let mx = 0;
      for (let ch = 0; ch < audio.channels.length; ch++) {
        const [lo, hi] = span(audio, summary, ch, px * fpp, (px + 1) * fpp);
        mx = Math.max(mx, Math.abs(lo), Math.abs(hi));
      }
      const hh = Math.max(0.5, Math.min(1, mx) * amp);
      ctx.fillRect(px, mid - hh, 1, hh * 2);
    }
    // The window currently on screen.
    const vx = (view.start / n) * w;
    const vw = Math.max(3, ((width * view.spp) / n) * w);
    ctx.strokeStyle = p.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.round(vx) + 0.75, 0.75, Math.min(w - 1.5, vw - 1.5), h - 1.5);
  }, [audio, summary, view, width, sel, n]);

  useLayoutEffect(draw, [draw]);
  useEffect(() => {
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', draw);
    return () => { mo.disconnect(); window.removeEventListener('resize', draw); };
  }, [draw]);

  const dragging = useRef(false);
  const jump = (clientX: number) => {
    const rect = canvas.current!.getBoundingClientRect();
    const at = ((clientX - rect.left) / rect.width) * n;
    onView({ spp: view.spp, start: at - (width * view.spp) / 2 });
  };

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label="Whole sample overview. Drag to move the view."
      onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); jump(e.clientX); }}
      onPointerMove={(e) => { if (dragging.current) jump(e.clientX); }}
      onPointerUp={() => { dragging.current = false; }}
      className="block h-11 w-full flex-none cursor-pointer touch-none border-t border-line-strong"
    />
  );
}
