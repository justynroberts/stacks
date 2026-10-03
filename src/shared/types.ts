export type DriveKind = 'sd' | 'usb-ssd' | 'usb-hdd' | 'external' | 'internal';

export interface Drive {
  id: string;
  name: string;
  /** Mount point or drive letter root. Empty for the "this computer" pseudo drive. */
  mount: string;
  kind: DriveKind;
  totalBytes: number;
  usedBytes: number;
  mounted: boolean;
  /** Excluded drives are never scanned and their samples are hidden. */
  excluded: boolean;
}

export const LOCAL_DRIVE_ID = 'local';
/** Bump when detector output changes: cached analyses with another version are thrown away and redone. */
export const ANALYSIS_VERSION = 2;

export interface Analysis {
  version: number;
  bpm: number | null;
  /** 0..1 */
  bpmConf: number;
  /** e.g. "A min" */
  key: string | null;
  /** e.g. "Am" */
  keyShort: string | null;
  /** e.g. "8A" */
  camelot: string | null;
  /** 0..1 */
  keyConf: number;
  durationSec: number;
  kind: 'loop' | 'shot';
  /** 0..99 amplitude per bin, PEAK_BINS long */
  peaks: number[];
  analysedAt: number;
}

export const PEAK_BINS = 96;

export interface Sample {
  id: string;
  driveId: string;
  /** Path relative to the drive mount (absolute for the local pseudo drive). */
  relPath: string;
  /** Absolute path right now, or null when the drive is not mounted. */
  path: string | null;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  analysis?: Analysis;
}

export type QueueStage = 'queued' | 'downloading' | 'unpacking' | 'scanning' | 'done' | 'error';

export interface QueueItem {
  id: string;
  label: string;
  stage: QueueStage;
  /** 0..1, or -1 when unknown */
  progress: number;
  error?: string;
}

/**
 * Where edited audio goes. 'replace' swaps it in for the original (which goes to the Trash). 'new' writes a new file
 * named with `label` ("edit", "loop_2bar"): beside the original when driveId is null, otherwise into a Stacks folder
 * on that drive.
 */
export type EditTarget = { kind: 'replace' } | { kind: 'new'; driveId: string | null; label: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface StacksApi {
  platform: string;
  listDrives(): Promise<Drive[]>;
  onDrives(cb: (drives: Drive[]) => void): () => void;
  listSamples(): Promise<Sample[]>;
  onSamples(cb: (upserts: Sample[], removedIds: string[]) => void): () => void;
  scanDrive(driveId: string): Promise<void>;
  setDriveExcluded(driveId: string, excluded: boolean): Promise<void>;
  addPaths(paths: string[]): Promise<void>;
  importUrl(url: string): Promise<Result<true>>;
  onQueue(cb: (items: QueueItem[]) => void): () => void;
  readFile(id: string): Promise<ArrayBuffer>;
  saveAnalysis(id: string, analysis: Analysis): Promise<void>;
  renameWithMeta(id: string): Promise<Result<Sample>>;
  copyToDrive(id: string, driveId: string): Promise<Result<Sample>>;
  /** Save edited audio (a WAV file) for sample `id`. A non-WAV original replaced this way becomes .wav. */
  writeEdit(id: string, wav: ArrayBuffer, target: EditTarget): Promise<Result<Sample>>;
  reveal(id: string): void;
  startDrag(id: string): void;
  pathForFile(file: File): string;
}

export const AUDIO_EXTS = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] as const;
export const isAudioExt = (ext: string): boolean => (AUDIO_EXTS as readonly string[]).includes(ext.toLowerCase());
