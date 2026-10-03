# Stacks

A sample manager for external drives and SD cards. Plug a drive in and it shows up. Drop files, folders, zip
packs or a download link on it and the key and BPM are read for you. Drag any row straight out into your DAW.

Electron, React, TypeScript, Tailwind, Radix, Framer Motion. Design: a light DAW (Ableton and Pro Tools on warm
paper), one typeface (Barlow Semi Condensed), one accent, dark theme as the alternative. See `DESIGN.md`.

## Install

Download the latest `.dmg` from **[stacks-releases](https://github.com/justynroberts/stacks-releases/releases/latest)**,
open it and drag Stacks to Applications. It is signed and notarised, runs on Apple silicon and Intel, and updates
itself: new versions download in the background and Stacks asks before restarting (About → Check for updates to
look now). This source repository is private; installers live in that public, binaries-only repository.

## Releasing

```
npm run release -- 0.3.0 --dry-run   # build universal, sign, notarise app and dmg, verify; publish nothing
npm run release -- 0.3.0             # then commit the version, tag, and publish to stacks-releases
```

Notes go in `release-notes/<version>.md`. The script refuses a dirty tree, an existing version, a missing Developer
ID or notary profile, failing tests, a stale update manifest, or anything Gatekeeper does not accept as a notarised
Developer ID build. `npm run dist` builds locally and never publishes.

## Run it

```
npm install
npm run dev          # Electron with hot reload (renderer on port 5917)
npm run dev:web      # the UI alone in a browser, with demo data (port 5917)
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`.

Docker is for the parts around the app (typecheck, tests, browser preview with demo data), not the app itself,
because a container cannot see your USB ports or SD slot:

```
docker compose up --build        # http://localhost:5918
```

## What it does

- **Drives**: SD cards and USB drives are detected on mount (macOS `/Volumes`, Linux `/media` `/run/media` `/mnt`,
  Windows drive letters). A drive is remembered by its volume ID, so it keeps its samples when it comes back on a
  different mount point, and shows as OFFLINE when unplugged.
- **Import**: drop files, folders or `.zip` packs on the window, or paste a direct download link. Packs unpack to
  `~/Music/Stacks Imports`, downloads land in `~/Downloads/Stacks`.
- **Exclude a drive**: hover a drive in Places and press the crossed-eye button. It is never scanned again and
  its samples are hidden (their analysis is kept, so Include brings them straight back). Remembered across restarts.
- **Key and BPM**: read in the app, off the UI thread, on first sight of a file and cached by size and modified time.
  Key comes out as a name and a Camelot code, with a confidence. A tempo in the file name ("140bpm", "_172") is used
  to settle half and double time when it agrees with the audio. Sounds with no pulse (pads, noise) get no BPM rather
  than a made up one; unpitched sounds get no key. Every tempo is then folded into 70–140: above 140 is halved, below
  70 is doubled, so a 172 break reads 86 (even when "172" is in its name).
- **Mixes with**: shows the Camelot neighbours of the selected sample, and can filter the list to what mixes
  (compatible key, tempo within 6%).
- **Rename**: `rhodes_loop_dusty_Am_84bpm.wav` (key and tempo at the end, so sort order never changes), on disk, never overwriting (a clash gets `_2`). Idempotent.
- **Edit**: press E (or Edit sample) for a waveform editor. Drag to select (edges snap to zero crossings, or to
  16ths at the sample's tempo; hold Alt to bypass), then trim, delete, silence, trim silence, fade in/out, de-click,
  ±3 dB, normalise or reverse. Undo/redo, zoom (pinch, Ctrl/Cmd+scroll, +/-, 0 to fit), selection playback with loop,
  and typed start/end times. WAV is edited at its own rate and bit depth; other formats are decoded at their own rate
  and saved as 24-bit WAV. **Save as copy** writes `name_edit.wav`; **Replace original** needs a second click and
  moves the original to the Trash. Keys: Space play, L loop, Cmd+A all, Cmd+T trim, Backspace delete,
  Cmd+Z / Shift+Cmd+Z, Cmd+S save copy, Shift+Cmd+S save loop, Esc back.
- **Loops**: **Auto loop** picks the best 4, 2 or 1 bar loop (beat grid on the hits, starting on a transient, a clean
  wrap at the seam, edges on zero crossings) and turns looping on; press again for the next candidate. With no tempo
  in the analysis it detects one. **1 bar / 2 / 4** select that many bars from the cursor. **Save loop** writes just
  the selection as `name_loop_2bar.wav` (bar count when it is a whole number of bars). **Save to** sends new files
  beside the original or into a `Stacks` folder on any connected drive; the editor stays open for the next loop.
  While a loop plays you can drag its edges, retype them, or auto-loop again: the pass that is playing finishes, and
  the next pass uses the new points (moving the loop elsewhere jumps there, it never plays the gap). Loop can also be
  switched on or off mid-play without restarting.
- **Copy to drive**: into a `Stacks` folder on the target, never overwriting.
- **Drag out**: drag a row into Ableton, Finder, anything that accepts a file drag.
- **Keyboard**: arrows, Home/End, Page up/down move; Space previews; L loops the preview; E opens the editor; click a
  column header to sort.
- **Loop preview**: LOOP in the clip view (or L) loops the whole sample gaplessly through Web Audio, so a click or a
  bad tail at the seam is audible before you open the editor. It stays on as you move between samples and can be
  switched mid-play without restarting.
- 30,000 samples stay smooth (virtual list; about a second to load, 28 rows in the DOM).

## Layout

```
src/main        Electron main process: drives, scanner, library cache, zip, imports, IPC
src/preload     The only bridge the page gets (contextIsolation, sandbox, no Node in the page)
src/shared      Key maths, BPM and key detection (pure TypeScript, tested), types
src/renderer    The UI. With no Electron around it falls back to src/renderer/src/mock (demo data)
tests           vitest: detection, library, scanner, unzip, UI (with axe) and colour contrast
```

The library cache is one JSON file in the app's user data folder (`library.json`). Delete it to force a full rescan.

## Honest limits

- **Key and BPM are estimates.** They are tested on synthetic loops and chords, and on a real run of the built app,
  not on a corpus of real music. Expect good results on clear loops and chord stabs, and mistakes on dense mixes,
  heavy swing, key changes, and tempo octaves with no hint in the name. The confidence figure is a rough guide.
  Treat Camelot codes as a starting point and trust your ears.
- **Edits drop extra WAV chunks** (cue points, loop markers, ACID / BWF metadata): the editor writes plain audio.
  Fades are linear, and there is no dither when going down to 16-bit.
- **Rename only changes the file name.** It does not write BPM or key tags inside the file yet.
- **Links must be direct** (a file or a zip). Pages that sit behind a login or a download button will not work.
- Only the first 90 seconds of long files are analysed, and files over 400 MB are skipped.
- Drive type (SD, SSD, HDD) comes from the OS (`lsblk` on Linux, `diskutil` on macOS, WMI on Windows) and falls
  back to "External". The macOS and Windows paths are written but have not been run on those systems.

## Security notes

The page runs with `contextIsolation` and `sandbox` on and no Node access; it can only ask for files that are in
the library by ID, never by path. Zip packs are unpacked by a small hardened extractor that writes audio files only,
never symlinks, never outside the target folder, and stops at size and entry limits.

`npm audit` still lists build-time tooling only (Tailwind's file watcher via `braces`, and electron-builder via
`http-cache-semantics`); neither ships in the app and neither has a published fix yet.
