import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { broadcast, registerIpc } from './ipc';
import { Services } from './services';
import { setupUpdates } from './updater';

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL'];

let services: Services | null = null;

function createWindow(): void {
  const mac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#F1EFEA',
    title: 'Stacks',
    titleBarStyle: mac ? 'hiddenInset' : 'default',
    trafficLightPosition: mac ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Analysis runs in this page; a window that is hidden or covered must not slow it to a crawl.
      backgroundThrottling: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL'];
    if (!(isDev && dev && url.startsWith(dev))) e.preventDefault();
  });

  if (isDev) void win.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:"
          ]
        }
      });
    });
  }
  services = new Services({
    drives: (d) => broadcast('drives:changed', d),
    samples: (u, r) => broadcast('samples:changed', u, r),
    queue: (q) => broadcast('queue:changed', q)
  });
  registerIpc(services);
  createWindow();
  setupUpdates();
  await services.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !services) return;
  e.preventDefault();
  quitting = true;
  void services.stop().finally(() => app.quit());
});
