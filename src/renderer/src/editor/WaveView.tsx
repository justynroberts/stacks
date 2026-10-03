import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { frameCount, type PcmAudio } from '@shared/audio/wav';
import { span, type Summary } from './peaks';
import { fmtRuler, rulerStep } from './time';

export interface View {
  /** First frame on screen. */
  start: number;
  /** Frames per CSS pixel. */
  spp: number;
}

export const RULER_H = 22;
export const MIN_SPP = 0.05;

/** The design tokens, read at draw time so a theme switch is picked up on the next paint. */
export function palette(): Record<'bg' | 'raised' | 'sel' | 'line' | 'lineStrong' | 'fg' | 'muted' | 'faint' | 'accent', string> {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(`--color-${n}`).trim() || '#888';
  return { bg: v('bg'), raised: v('raised'), sel: v('sel'), line: v('line'), lineStrong: v('line-strong'), fg: v('fg'), muted: v('muted'), faint: v('faint'), accent: v('accent') };
}

/** Size a canvas to its box at device resolution and hand back a context in CSS pixels. */
export function fit(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const rect = canvas.getBoundingClientRect();
  const ctx = canvas.getContext('2d');
  if (!ctx || rect.width < 1 || rect.height < 1) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

interface Props {
  audio: PcmAudio;
  summary: Summary;
  view: View;
  onView(v: View): void;
  sel: readonly [number, number];
  onSel(s: [number, number]): void;
  /** Snap a frame to the grid in force. Alt held bypasses it. */
  snap(frame: number, bypass: boolean): number;
  /** Frames per beat, when the tempo is known. */
  beat: number | null;
  playhead: RefObject<HTMLDivElement | null>;
  onWidth(w: number): void;
  label: string;
  /** Found loops, drawn as numbered bands under the ruler. */
  regions?: Array<{ start: number; end: number; active: boolean }>;
}

export function WaveView({ audio, summary, view, onView, sel, onSel, snap, beat, playhead, onWidth, label, regions }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = frameCount(audio);

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const got = fit(c);
    if (!got) return;
    const { ctx, w, h } = got;
    const p = palette();
    const x = (f: number) => (f - view.start) / view.spp;
    const [s, e] = sel;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, RULER_H, w, h - RULER_H);

    // Selection band, behind everything.
    if (e > s) {
      ctx.fillStyle = p.sel;
      ctx.fillRect(Math.max(0, x(s)), RULER_H, Math.min(w, x(e)) - Math.max(0, x(s)), h - RULER_H);
    }

    // Beat grid, bars stronger.
    const endFrame = view.start + w * view.spp;
    if (beat && beat / view.spp >= 4) {
      for (let b = Math.ceil(view.start / beat); b * beat < endFrame; b++) {
        const gx = Math.round(x(b * beat)) + 0.5;
        ctx.fillStyle = b % 4 === 0 ? p.lineStrong : p.line;
        ctx.fillRect(gx, RULER_H, 1, h - RULER_H);
      }
    }

    // Lanes.
    const lanes = audio.channels.length;
    const laneH = (h - RULER_H) / lanes;
    for (let c2 = 0; c2 < lanes; c2++) {
      const top = RULER_H + c2 * laneH;
      const mid = top + laneH / 2;
      const amp = laneH / 2 - 3;
      ctx.fillStyle = p.line;
      ctx.fillRect(0, Math.round(mid), w, 1);
      if (c2 > 0) { ctx.fillStyle = p.lineStrong; ctx.fillRect(0, Math.round(top), w, 1); }

      if (view.spp >= 1) {
        for (let px = 0; px < w; px++) {
          const from = view.start + px * view.spp;
          if (from >= n) break;
          const [mn, mx] = span(audio, summary, c2, from, from + view.spp);
          const y1 = mid - Math.min(1, mx) * amp;
          const y2 = mid - Math.max(-1, mn) * amp;
          ctx.fillStyle = from >= s && from < e ? p.fg : p.muted;
          ctx.fillRect(px, y1, 1, Math.max(1, y2 - y1));
          if (mx >= 0.999 || mn <= -0.999) {
            ctx.fillStyle = p.accent;
            ctx.fillRect(px, top + 1, 1, 3);
            ctx.fillRect(px, top + laneH - 4, 1, 3);
          }
        }
      } else {
        // Zoomed past one sample per pixel: draw the samples themselves.
        const ch = audio.channels[c2]!;
        ctx.strokeStyle = p.fg;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const f0 = Math.max(0, Math.floor(view.start));
        const f1 = Math.min(n - 1, Math.ceil(endFrame));
        for (let f = f0; f <= f1; f++) {
          const px = x(f), py = mid - Math.max(-1, Math.min(1, ch[f]!)) * amp;
          if (f === f0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        if (1 / view.spp >= 6) {
          ctx.fillStyle = p.fg;
          for (let f = f0; f <= f1; f++) ctx.fillRect(x(f) - 1.5, mid - Math.max(-1, Math.min(1, ch[f]!)) * amp - 1.5, 3, 3);
        }
      }
    }

    // End of the audio.
    if (x(n) < w) {
      ctx.fillStyle = p.raised;
      ctx.fillRect(Math.max(0, x(n)), RULER_H, w - Math.max(0, x(n)), h - RULER_H);
    }

    // Found loops: a band and a number under the ruler, the active one in the accent.
    if (regions?.length) {
      ctx.font = '600 11px "Barlow Semi Condensed", "Arial Narrow", sans-serif';
      ctx.textBaseline = 'top';
      regions.forEach((r, i) => {
        const rx = x(r.start), rw = x(r.end) - rx;
        if (rx + rw < 0 || rx > w) return;
        ctx.fillStyle = r.active ? p.accent : p.lineStrong;
        ctx.fillRect(Math.max(0, rx) + 1, RULER_H + 1, Math.max(2, Math.min(w, rx + rw) - Math.max(0, rx) - 2), 5);
        // The number sits on a chip of the ground colour so it reads over a loud waveform.
        const label = String(i + 1).padStart(2, '0');
        const lx = Math.max(0, rx) + 2;
        ctx.fillStyle = r.active ? p.accent : p.bg;
        ctx.fillRect(lx, RULER_H + 7, ctx.measureText(label).width + 8, 15);
        ctx.fillStyle = r.active ? p.bg : p.muted;
        ctx.fillText(label, lx + 4, RULER_H + 9);
      });
    }

    // Selection edges (or the cursor), in the accent.
    ctx.fillStyle = p.accent;
    for (const f of e > s ? [s, e] : [s]) {
      const ex = x(f);
      if (ex >= -2 && ex <= w + 2) ctx.fillRect(Math.round(ex) - 1, RULER_H, 2, h - RULER_H);
    }

    // Ruler: bars when there is a tempo, time otherwise.
    ctx.fillStyle = p.raised;
    ctx.fillRect(0, 0, w, RULER_H);
    ctx.fillStyle = p.lineStrong;
    ctx.fillRect(0, RULER_H - 1, w, 1);
    ctx.font = '500 11px "Barlow Semi Condensed", "Arial Narrow", sans-serif';
    ctx.textBaseline = 'middle';
    // Bars while a bar is a readable size; zoomed in past half a screen per bar, time is more useful.
    if (beat && (beat * 4) / view.spp >= 8 && (beat * 4) / view.spp <= w / 2) {
      const barPx = (beat * 4) / view.spp;
      const every = [1, 2, 4, 8, 16, 32, 64].find((k) => k * barPx >= 48) ?? 64;
      for (let b = Math.ceil(view.start / beat); b * beat < endFrame; b++) {
        const bx = Math.round(x(b * beat)) + 0.5;
        const isBar = b % 4 === 0;
        ctx.fillStyle = p.lineStrong;
        ctx.fillRect(bx, isBar ? 4 : RULER_H - 6, 1, isBar ? RULER_H - 4 : 6);
        if (isBar && (b / 4) % every === 0) { ctx.fillStyle = p.faint; ctx.fillText(String(b / 4 + 1), bx + 4, RULER_H / 2); }
      }
    } else {
      const sr = audio.sampleRate;
      const step = rulerStep(view.spp / sr);
      for (let t = Math.ceil(view.start / sr / step) * step; t * sr < endFrame; t += step) {
        const tx = Math.round(x(t * sr)) + 0.5;
        ctx.fillStyle = p.lineStrong;
        ctx.fillRect(tx, 6, 1, RULER_H - 6);
        ctx.fillStyle = p.faint;
        ctx.fillText(fmtRuler(t, step), tx + 4, RULER_H / 2);
      }
    }
    if (e > s) {
      ctx.fillStyle = p.accent;
      ctx.fillRect(Math.max(0, x(s)), RULER_H - 3, Math.min(w, x(e)) - Math.max(0, x(s)), 3);
    }
  }, [audio, summary, view, sel, beat, n, regions]);

  useLayoutEffect(draw, [draw]);

  // Redraw on resize and on a theme switch.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    onWidth(Math.round(el.getBoundingClientRect().width));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { onWidth(Math.round(el.getBoundingClientRect().width)); draw(); }) : null;
    ro?.observe(el);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => { ro?.disconnect(); mo.disconnect(); };
  }, [draw, onWidth]);

  // Wheel: scroll sideways; with Ctrl / Cmd (or a trackpad pinch) zoom around the pointer.
  const live = useRef({ view, n, onView });
  live.current = { view, n, onView };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const { view: v, onView: set } = live.current;
      const rect = el.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) {
        const px = ev.clientX - rect.left;
        const at = v.start + px * v.spp;
        const spp = Math.max(MIN_SPP, Math.min(live.current.n / Math.max(1, rect.width), v.spp * Math.exp(ev.deltaY * 0.01)));
        const next = { spp, start: at - px * spp };
        live.current.view = next; // several wheel events can land before React renders again
        set(next);
      } else {
        const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
        const next = { spp: v.spp, start: Math.max(0, v.start + d * v.spp) };
        live.current.view = next;
        set(next);
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // Drag to select; grab an edge to move it; click to place the cursor.
  const drag = useRef<{ anchor: number; downX: number; moved: boolean } | null>(null);
  const frameAt = (clientX: number) => {
    const rect = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n, view.start + (clientX - rect.left) * view.spp));
  };
  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const rect = box.current!.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const [s, e] = sel;
    const xs = (s - view.start) / view.spp, xe = (e - view.start) / view.spp;
    let anchor: number;
    if (e > s && Math.abs(px - xe) <= 6) anchor = s;
    else if (e > s && Math.abs(px - xs) <= 6) anchor = e;
    else anchor = snap(frameAt(ev.clientX), ev.altKey);
    drag.current = { anchor, downX: ev.clientX, moved: false };
    if (!(e > s && (Math.abs(px - xe) <= 6 || Math.abs(px - xs) <= 6))) onSel([anchor, anchor]);
  };
  const onMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    const rect = box.current!.getBoundingClientRect();
    if (!d) {
      const [s, e] = sel;
      const px = ev.clientX - rect.left;
      const edge = e > s && (Math.abs(px - (s - view.start) / view.spp) <= 6 || Math.abs(px - (e - view.start) / view.spp) <= 6);
      box.current!.style.cursor = edge ? 'ew-resize' : 'text';
      return;
    }
    if (Math.abs(ev.clientX - d.downX) > 2) d.moved = true;
    if (!d.moved) return;
    const f = snap(frameAt(ev.clientX), ev.altKey);
    onSel([Math.min(d.anchor, f), Math.max(d.anchor, f)]);
  };
  const onUp = () => { drag.current = null; };

  return (
    <div
      ref={box}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => onSel([0, n])}
      className="relative min-h-0 flex-1 cursor-text touch-none select-none overflow-hidden"
    >
      <canvas ref={canvas} role="img" aria-label={label} className="absolute inset-0 h-full w-full" />
      <div ref={playhead} aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 hidden w-[2px] bg-fg" style={{ top: RULER_H }} />
    </div>
  );
}
