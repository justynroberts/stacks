import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import type { Analysis, EditTarget } from '@shared/types';
import type { Services } from './services';
import { checkForUpdatesNow } from './updater';

// 32x32 neutral square; macOS refuses to start a drag without an icon.
const dragIcon = () => nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 0x88), { width: 32, height: 32 });

export function registerIpc(svc: Services): void {
  ipcMain.handle('app:checkUpdates', () => checkForUpdatesNow());
  ipcMain.handle('drives:list', async () => { await svc.ready; return svc.driveList(); });
  ipcMain.handle('samples:list', async () => { await svc.ready; return svc.library.all(); });
  ipcMain.handle('scan:drive', (_e, driveId: unknown) => {
    if (typeof driveId === 'string') svc.scanDrive(driveId);
  });
  ipcMain.handle('drive:exclude', (_e, driveId: unknown, excluded: unknown) => {
    if (typeof driveId === 'string' && typeof excluded === 'boolean') svc.setDriveExcluded(driveId, excluded);
  });
  ipcMain.handle('import:paths', (_e, paths: unknown) => {
    if (Array.isArray(paths)) svc.addPaths(paths.filter((p): p is string => typeof p === 'string' && p.length > 0));
  });
  ipcMain.handle('import:url', (_e, url: unknown) => (typeof url === 'string' ? svc.importUrl(url) : { ok: false, error: 'Bad link' }));
  ipcMain.handle('file:read', (_e, id: unknown) => svc.readFile(String(id)));
  ipcMain.handle('file:readHead', (_e, id: unknown, max: unknown) => svc.readHead(String(id), Number(max)));
  ipcMain.handle('analysis:save', (_e, id: unknown, a: unknown) => svc.saveAnalysis(String(id), a as Analysis));
  ipcMain.handle('file:rename', (_e, id: unknown) => svc.renameWithMeta(String(id)));
  ipcMain.handle('file:copy', (_e, id: unknown, driveId: unknown) => svc.copyToDrive(String(id), String(driveId)));
  ipcMain.handle('file:writeEdit', (_e, id: unknown, wav: unknown, target: unknown) => {
    const t = target as Partial<EditTarget> | null;
    if (t?.kind === 'replace') return svc.writeEdit(String(id), wav, { kind: 'replace' });
    if (t?.kind === 'new' && (t.driveId === null || typeof t.driveId === 'string') && typeof t.label === 'string' && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(t.label) && t.label.length <= 24) {
      return svc.writeEdit(String(id), wav, { kind: 'new', driveId: t.driveId, label: t.label });
    }
    return { ok: false, error: 'Bad save target' };
  });
  ipcMain.on('file:reveal', (_e, id: unknown) => svc.reveal(String(id)));
  ipcMain.on('file:drag', (e, id: unknown) => {
    const file = svc.pathForDrag(String(id));
    if (file) e.sender.startDrag({ file, icon: dragIcon() });
  });
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}
