# Stacks — design record

Read this before changing the look, and pick differently again for the next project.

## Direction: Edit window on paper (October 2026)

A light DAW: the restraint of Ableton Live and the edit window of Pro Tools, set on warm studio paper rather
than Live's grey. Neutral chrome carries everything; a single transport orange marks what is selected,
lit or playing.

The user asked for this explicitly ("more stylish, light by default, think Ableton or Pro Tools"), which
overrides the `distinctive-ui` near-black default. Dark remains as the one alternative theme, behind the
toggle in the control bar.

**The recognisable idea:** a hardware counter in the control bar — a dark glass window reading the
selected sample's BPM, key, Camelot code and length in large figures — plus every sample in the list drawn
as a small clip, the selected one lit orange.

Replaced the first pass (October 2026): instrument panel, JetBrains Mono, dark by default, detail panel
on the right.

## References (from the DAWs themselves, not screenshots)

- **Ableton Live 12, Light theme**: flat panels, hairlines only, tiny uppercase labels, clips as filled
  envelopes, the detail (clip) view docked along the bottom.
- **Pro Tools edit window**: the big counter in the transport, bar/beat ruler over the waveform.
- **Bitwig inspector**: dense left browser with places and collections.
- **Teenage Engineering OP-1 field**: one hot colour on neutral ground.
- **SSL scribble strips**: condensed caps for labels.

The sibling `ableton-ai` already took Live's grey chrome, per-role clip colours and IBM Plex. Stacks
differs: warm paper instead of grey, one accent instead of a palette, a condensed grotesk instead of Plex,
and the counter.

## Picks

| Axis | Pick |
|---|---|
| Typeface | **Barlow Semi Condensed** only (400/500/600/700, self-hosted via `@fontsource`). Tabular figures everywhere. |
| Sizes | Three: 11px label (caps, tracked), 14px body, 28px readout. |
| Ground | `#f1efea` paper, `#e4e1da` chrome, `#d9d5cb` selection, hairlines `#d2cec5` / `#aaa59a`. |
| Ink | `#17171a`, muted `#3e3e44`, faint `#56565c` — all ≥4.5:1 on every surface. |
| Accent | Transport orange `#c2410c` (dark: `#ff6b2c`). **Never text**: marks, fills, the played part of a waveform, the selected clip. It clears the 3:1 graphics bar, not 4.5:1, so `tests/ui.test.tsx` enforces exactly that. |
| Counter | Inset `#2a2926` with `#f1efea` digits, in both themes a darker window than the chrome. |
| Layout | Control bar · browser left (collections, places, excluded) · list · clip view along the bottom · status bar. Asymmetric, left-weighted. |
| Surfaces | Flat. No cards, no shadows, radius 2px or less. Separation by hairlines and three paper tones. |
| Motion | State change only (queue rows fade, progress bars move), 150ms ease-out; `prefers-reduced-motion` honoured. |
| Logo | Three stacked slabs, the top one lit (`build/icon.svg`, `src/renderer/public/icon.svg`, `components/Logo.tsx`). The app icon cuts a waveform into the base slab. The macOS icon plate is the one place with a large radius, because the OS requires it. |

## House identity

- About button (ⓘ) at the right of the control bar → dialog with "Made by FintonLabs".
- MIT header on `styles.css` and `index.html`.
