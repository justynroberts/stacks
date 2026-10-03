# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Stacks is an Electron sample manager: it watches external drives / SD cards, imports files, folders, zip packs and
URLs, detects key and BPM, and lets rows be dragged out into a DAW. Electron + electron-vite, React 19, TypeScript,
Tailwind 3, Radix, Framer Motion, vitest.

## Commands

```bash
npm run dev          # Electron with hot reload (renderer on 5917, strictPort)
npm run dev:web      # renderer only, in a browser, against the mock API with demo data (5917)
npm run typecheck    # tsc --noEmit over src, tests and root *.ts
npm test             # vitest run (all of tests/)
npm run build        # electron-vite build -> out/main, out/preload, out/renderer
npm run build:web    # browser build -> out/web
npm run dist         # build + electron-builder installers -> release/ (configured, untested)
docker compose up --build   # typecheck + tests + build:web, served by nginx on 5918
```

Single file / single test: `npx vitest run tests/dsp.test.ts` or `npx vitest run -t "finds audio"`.
Append `?stress=30000` to the `dev:web` URL to load the mock with that many samples.

## Architecture

Three processes, one shared module, path aliases `@shared` → `src/shared` and `@` → `src/renderer/src` (defined in
`electron.vite.config.ts`, `vite.web.config.ts`, `vitest.config.ts` and `tsconfig.json` — keep all four in sync).

**Main (`src/main`)** — `Services` (`services.ts`) owns everything: `DriveWatcher` (mount detection, volume IDs,
drive kind via lsblk/diskutil/WMI), `Library` (in-memory map persisted as `library.json` in userData, debounced
1.5s save), `JobQueue` (scans, unzips, downloads, each reporting stage/progress), `scan()` and the hardened zip
extractor `unzip.ts`. Changes are pushed to the page through the `Emit` callbacks → `broadcast()` in `ipc.ts`.

**Preload (`src/preload/index.ts`)** — the only bridge. Exposes `window.stacks` implementing `StacksApi`
(`src/shared/types.ts`). Adding a capability means touching `types.ts` (interface), `preload`, `ipc.ts` (handler,
validate every arg as `unknown`), `services.ts`, **and** `mock/mockApi.ts`.

**Renderer (`src/renderer/src`)** — `main.tsx` uses `window.stacks` if present, otherwise `createMockApi()` and
`demo` mode; the UI must keep working against both. `store.tsx` is a single React context holding drives, samples,
filters, sort, preview playback and the `AnalysisRunner`.

**Analysis runs in the renderer, not main.** `AnalysisRunner` asks main for the file bytes by ID (`readFile`),
decodes with Web Audio (`decode.ts`), posts mono samples to an inline worker (`analysis.worker.ts`) that calls
`analyse()` from `src/shared/dsp`, then sends the result back with `saveAnalysis`. Main caches it on the sample.

**Editor (`src/renderer/src/editor`)** — opened by `store.openEditor`; replaces the list and clip view in `App`.
WAV is decoded by `shared/audio/wav.ts` (exact, native rate and depth); other formats by Web Audio at the rate
`sniffSampleRate` reads from the header. Edits are pure functions in `shared/audio/edit.ts` that return new audio,
so undo is a stack of snapshots (capped by bytes). Auto loop is `shared/audio/loop.ts` (`findLoops`, ranked; onset
envelope frame i is a 4-hop window, so a hit at frame f peaks near index f/hop − 2 — keep that offset).
`shared/audio/loopset.ts` (`findLoopSet`) is the whole-track version: 3:2 tempo hypotheses compared by hits per
minute after each is refined, then a least-squares fit of attack time vs beat number for the exact beat length and
phase; per-bar fingerprints (12 log bands + 12-bin chroma) for steadiness, repeat-at-the-seam and section changes.
`editor/LoopSetPanel.tsx` is its UI.
`editor/player.ts` plays a loop as a chain of one-pass sources scheduled sample-accurately ~250 ms ahead (not a
single looping source), so moved loop points apply from the next pass; `tests/player.test.ts` drives it with a fake
clock (`new Player(fakeCtx, false)` + `tick()`). Drawing is canvas (`WaveView`, `Overview`) over a min/max
summary (`peaks.ts`); colours come from the CSS tokens at draw time. Saving encodes with `writeWav` in the source's
format and calls `api.writeEdit` with an `EditTarget`: `{ kind: 'new', driveId, label }` → `editName(…, label)` beside
the original (driveId null) or in `<drive>/Stacks`; `{ kind: 'replace' }` → hidden temp file, original to the Trash
via `shell.trashItem`, then swap in (same library id when the original was already .wav). `ipc.ts` validates the
target and restricts `label` to `[a-z0-9_]`, since it becomes part of a file name.

**Shared (`src/shared`)** — pure TypeScript, no Node or DOM: DSP (`dsp/bpm.ts`, `dsp/key.ts`, `dsp/fft.ts`,
`dsp/peaks.ts`, `dsp/synth.ts` for test signals), Camelot maths, filename parsing/renaming, and the types.

Key invariants:
- Samples are addressed by `sampleId(driveId, relPath)` (sha1, 16 hex). Paths are stored relative to the drive's
  mount so a drive survives remounting elsewhere; `LOCAL_DRIVE_ID` samples store absolute paths. The page never
  sees or sends paths — only IDs.
- A sample is re-analysed when size/mtime change or `analysis.version !== ANALYSIS_VERSION`. Bump
  `ANALYSIS_VERSION` in `types.ts` whenever detector output changes.
- Rename and copy never overwrite (`uniquePath` appends `_2`, `_3`…). Rename is idempotent.
- BPM is folded into 70–140 by `foldBpm` (`dsp/bpm.ts`) inside `analyse()`, after detection and after the filename
  hint. `detectBpm` itself still returns the raw tempo, and its tests rely on that. The BPM filter range is the same
  70–140.
- Excluded drives (`Library.excluded`, persisted in `library.json`) are never scanned, `ingest` drops their files,
  and `Library.all()` hides their samples while keeping their analyses. Excluding emits the drive's ids as removed;
  including re-emits them and rescans.
- Limits live in `services.ts` / `analyse.ts`: 400 MB read cap, 2 GB download cap, first 90 s analysed,
  `saveAnalysis` rejects >256 peaks.
- Security: `contextIsolation` + `sandbox`, no Node in the page, CSP set in `index.ts` for packaged builds,
  navigation and `window.open` blocked. Keep it that way.

## Tests

- `tests/dsp.test.ts` — detectors against synthetic loops/chords from `dsp/synth.ts`.
- `tests/main.test.ts`, `tests/unzip.test.ts` — scanner, library, drive detection, extractor, against temp dirs.
- `tests/ui.test.tsx` — jsdom (per-file `@vitest-environment jsdom`), renders `App` with the mock API and a fake
  worker, runs axe (contrast disabled). Colour contrast is instead checked by parsing tokens in `styles.css`, so
  renaming CSS variables can break that test.
- `tests/audio.test.ts` — WAV read/write round trips, header sniffing, every edit operation, `editName`.
- `tests/setup.ts` stubs `ResizeObserver`, `matchMedia`, canvas `getContext` (returns null) and fakes element sizes; without it the virtual list renders
  zero rows.

## Notes

- After editing anything under `src/`, run `npm run typecheck` and `npm run build`.
- The README's "Honest limits" section is maintained by hand — update it when a limit changes.
- UI work follows the global `distinctive-ui` + `house-style` skills, but read `DESIGN.md` first: the user
  explicitly asked for light-by-default with dark as an option, which overrides the skills' near-black-only rule.
  The accent is never used for text (it only clears 3:1 in light); the contrast test in `tests/ui.test.tsx` parses
  the tokens in `styles.css` and enforces that split.
- `npm ci` has been seen to skip Electron's binary download ("Electron uninstall" on launch). Fix with
  `node node_modules/electron/install.js`.
- Quick local app (no notarising): `npm run build && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac
  --dir --arm64 -c.mac.target=dir`, then `codesign --force --deep -s - release/mac-arm64/Stacks.app`. The icon is
  `build/icon.png` (rendered from `build/icon.svg` with `rsvg-convert -w 1024 -h 1024`).
- **Releases** (`scripts/release.mjs`, `npm run release -- <ver> [--dry-run]`) are cut locally, never in CI, and only
  when the user asks in that message. Universal dmg + zip, hardened runtime (`build/entitlements.mac.plist`), app
  notarised in `scripts/notarize.cjs` (afterSign), dmg signed → notarised → stapled in `scripts/staple-dmg.cjs`, then
  `scripts/fix-update-metadata.mjs` re-hashes `latest-mac.yml` (stapling rewrites the dmg). Releases publish to this
  repository (public, so installed copies can read the feed), which `electron-builder.yml` → `publish` and
  `src/main/updater.ts` (electron-updater, DemoDog's pattern: background download, ask before restart, log to
  `updater.log`) both point at. One repo, by the user's choice: no separate releases repo. Ship the zip: macOS installs updates from it, never the dmg.
