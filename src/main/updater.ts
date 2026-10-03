import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import electronUpdater from 'electron-updater';

/**
 * Checks this repository's GitHub releases for a newer build, downloads it in the background and asks before restarting.
 * Same shape as DemoDog's updater: quiet on failure (logged, never a dialog for being offline), never installs
 * behind the user's back, and says so when an install did not take.
 */

const { autoUpdater } = electronUpdater;

const RELEASES = 'https://github.com/justynroberts/stacks/releases';
const FIRST_CHECK_DELAY = 8_000;
const RECHECK_INTERVAL = 2 * 60 * 60 * 1000;
const MIN_GAP = 20 * 60 * 1000;

const logPath = () => join(app.getPath('logs'), 'updater.log');

function note(message: string): void {
  try {
    mkdirSync(app.getPath('logs'), { recursive: true });
    appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* logging must never be what breaks an update */
  }
}

autoUpdater.logger = {
  info: (m: unknown) => note(`info  ${String(m)}`),
  warn: (m: unknown) => note(`warn  ${String(m)}`),
  error: (m: unknown) => note(`error ${String(m)}`),
  debug: (m: unknown) => note(`debug ${String(m)}`)
};

/** The window, looked up each time: one captured at launch may have been closed and remade since. */
function liveWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

async function ask(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = liveWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return dialog.showMessageBox(win, options);
  }
  app.focus({ steal: true });
  return dialog.showMessageBox(options);
}

let busy = false;
let downloaded: string | null = null;

function onDownloaded(info: { version: string }): void {
  downloaded = info.version;
  if (busy) return;
  busy = true;
  ask({
    type: 'info',
    message: `Stacks ${info.version} is ready to install`,
    detail: 'Stacks will close, swap itself for the new version and reopen, in about ten seconds. Your library is kept.',
    buttons: ['Restart now', 'Later', "What's new"],
    defaultId: 0,
    cancelId: 1
  }).then(
    (r) => {
      busy = false;
      if (r.response === 0) {
        note('user chose to restart; calling quitAndInstall');
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (e) {
          note(`quitAndInstall threw: ${String(e)}`);
        }
        // Still here long after a real install would have finished: say so, with a way out.
        setTimeout(() => {
          note('still running after quitAndInstall');
          void ask({
            type: 'warning',
            message: 'The update could not be installed',
            detail: `Stacks is still running ${app.getVersion()}. Downloading ${info.version} by hand always works.`,
            buttons: ['Download it', 'Show the log', 'Not now'],
            defaultId: 0,
            cancelId: 2
          }).then((c) => {
            if (c.response === 0) void shell.openExternal(`${RELEASES}/latest`);
            else if (c.response === 1) shell.showItemInFolder(logPath());
          }, (e) => note(`could not show the install warning: ${String(e)}`));
        }, 25_000);
      } else if (r.response === 2) {
        void shell.openExternal(`${RELEASES}/tag/v${info.version}`);
      }
    },
    (e) => {
      busy = false;
      note(`could not show the restart prompt: ${String(e)}`);
    }
  );
}

let lastCheck = 0;
function check(): void {
  const now = Date.now();
  if (now - lastCheck < MIN_GAP) return;
  lastCheck = now;
  autoUpdater.checkForUpdates().catch(() => undefined);
}

/** Only for an installed copy: a build from source has no release to compare against. */
export function setupUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', (e) => note(`check failed: ${e.message}`));
  autoUpdater.on('update-available', (i) => note(`update available: ${i.version}`));
  autoUpdater.on('update-not-available', () => note('no update available'));
  autoUpdater.on('download-progress', (p) => note(`downloading ${Math.round(p.percent)}%`));
  setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, RECHECK_INTERVAL);
  app.on('browser-window-focus', check);
}

/** The About panel's button. Returns a line to show there; a downloaded update also raises the restart prompt. */
export async function checkForUpdatesNow(): Promise<string> {
  if (!app.isPackaged) return 'Running from source: updates only apply to an installed copy.';
  if (downloaded) {
    onDownloaded({ version: downloaded });
    return `Stacks ${downloaded} is downloaded and ready.`;
  }
  try {
    lastCheck = Date.now();
    const r = await autoUpdater.checkForUpdates();
    const latest = r?.updateInfo.version;
    if (!latest || latest === app.getVersion()) return `Up to date (${app.getVersion()}).`;
    return `Downloading Stacks ${latest}. You will be asked before it restarts.`;
  } catch (e) {
    return `Could not check: ${e instanceof Error ? e.message : String(e)}`;
  }
}
