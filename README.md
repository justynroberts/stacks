# Stacks

A sample manager for external drives and SD cards. Plug a drive in and it shows up. Drop files, folders, zip
packs or a download link on it and the key and BPM are read for you. Drag any row straight out into your DAW.

Electron, React, TypeScript, Tailwind, Radix, Framer Motion. Design: a light DAW (Ableton and Pro Tools on warm
paper), one typeface (Barlow Semi Condensed), one accent, dark theme as the alternative. See `DESIGN.md`.

## Run it

```
npm install
npm run dev          # Electron with hot reload (renderer on port 5917)
npm run dev:web      # the UI alone in a browser, with demo data (port 5917)
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm run dist` (installers via electron-builder).

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
- **Copy to drive**: into a `Stacks` folder on the target, never overwriting.
- **Drag out**: drag a row into Ableton, Finder, anything that accepts a file drag.
- **Keyboard**: arrows, Home/End, Page up/down move; Space previews; click a column header to sort.
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
- **Rename only changes the file name.** It does not write BPM or key tags inside the file yet.
- **Links must be direct** (a file or a zip). Pages that sit behind a login or a download button will not work.
- Only the first 90 seconds of long files are analysed, and files over 400 MB are skipped.
- Drive type (SD, SSD, HDD) comes from the OS (`lsblk` on Linux, `diskutil` on macOS, WMI on Windows) and falls
  back to "External". The macOS and Windows paths are written but have not been run on those systems.
- Installers (`npm run dist`) are configured but untested here.

## Security notes

The page runs with `contextIsolation` and `sandbox` on and no Node access; it can only ask for files that are in
the library by ID, never by path. Zip packs are unpacked by a small hardened extractor that writes audio files only,
never symlinks, never outside the target folder, and stops at size and entry limits.

`npm audit` still lists build-time tooling only (Tailwind's file watcher via `braces`, and electron-builder via
`http-cache-semantics`); neither ships in the app and neither has a published fix yet.
