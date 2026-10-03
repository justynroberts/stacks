import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Analysis, Drive, QueueItem, Sample, StacksApi } from '@shared/types';

const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void) => {
  const handler = (_e: unknown, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const api: StacksApi = {
  platform: process.platform,
  listDrives: () => ipcRenderer.invoke('drives:list'),
  onDrives: (cb) => on<[Drive[]]>('drives:changed', cb),
  listSamples: () => ipcRenderer.invoke('samples:list'),
  onSamples: (cb) => on<[Sample[], string[]]>('samples:changed', cb),
  scanDrive: (id) => ipcRenderer.invoke('scan:drive', id),
  setDriveExcluded: (id, excluded) => ipcRenderer.invoke('drive:exclude', id, excluded),
  addPaths: (paths) => ipcRenderer.invoke('import:paths', paths),
  importUrl: (url) => ipcRenderer.invoke('import:url', url),
  onQueue: (cb) => on<[QueueItem[]]>('queue:changed', cb),
  readFile: (id) => ipcRenderer.invoke('file:read', id),
  saveAnalysis: (id, a: Analysis) => ipcRenderer.invoke('analysis:save', id, a),
  renameWithMeta: (id) => ipcRenderer.invoke('file:rename', id),
  copyToDrive: (id, driveId) => ipcRenderer.invoke('file:copy', id, driveId),
  writeEdit: (id, wav, target) => ipcRenderer.invoke('file:writeEdit', id, wav, target),
  reveal: (id) => ipcRenderer.send('file:reveal', id),
  startDrag: (id) => ipcRenderer.send('file:drag', id),
  pathForFile: (file) => webUtils.getPathForFile(file)
};

contextBridge.exposeInMainWorld('stacks', api);
