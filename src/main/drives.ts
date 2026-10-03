import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Drive, type DriveKind, LOCAL_DRIVE_ID } from '@shared/types';

const run = promisify(execFile);

async function sh(cmd: string, args: string[], timeout = 4000): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

interface Mount { mount: string; label: string }
interface Hints { id?: string; kind?: DriveKind }

const truthy = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12);

function isMountPoint(p: string): boolean {
  try {
    return statSync(p).dev !== statSync(path.dirname(p)).dev;
  } catch {
    return false;
  }
}

async function dirs(root: string): Promise<string[]> {
  try {
    return (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name));
  } catch {
    return [];
  }
}

async function listMounts(): Promise<Mount[]> {
  const out = new Map<string, Mount>();
  const add = (mount: string, label = path.basename(mount)) => out.set(mount, { mount, label });
  if (process.platform === 'darwin') {
    for (const p of await dirs('/Volumes')) {
      try {
        if ((await fs.realpath(p)) === '/') continue; // the boot volume shows up as a symlink to /
      } catch { continue; }
      add(p);
    }
  } else if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive ?? 'C:').toUpperCase();
    for (let c = 68; c <= 90; c++) {
      const letter = `${String.fromCharCode(c)}:`;
      if (letter === sys) continue;
      try {
        await fs.access(`${letter}\\`);
        add(`${letter}\\`, letter);
      } catch { /* not present */ }
    }
  } else {
    const user = os.userInfo().username;
    for (const root of [`/media/${user}`, `/run/media/${user}`, '/media', '/mnt']) {
      for (const p of await dirs(root)) if (isMountPoint(p)) add(p);
    }
  }
  return [...out.values()];
}

// ---- per platform hints (stable id, SD vs SSD vs HDD) ----

async function linuxHints(): Promise<Map<string, Hints & { label?: string }>> {
  const map = new Map<string, Hints & { label?: string }>();
  const raw = await sh('lsblk', ['-J', '-o', 'NAME,MOUNTPOINT,RM,TRAN,ROTA,UUID,LABEL']);
  if (!raw) return map;
  type Node = { name?: string; mountpoint?: string | null; rm?: unknown; tran?: string | null; rota?: unknown; uuid?: string | null; label?: string | null; children?: Node[] };
  const walk = (n: Node, parent?: Node) => {
    const tran = n.tran ?? parent?.tran ?? null;
    const rota = n.rota ?? parent?.rota;
    const name = n.name ?? parent?.name ?? '';
    if (n.mountpoint) {
      let kind: DriveKind = 'external';
      if (/^mmcblk/.test(name) || tran === 'mmc') kind = 'sd';
      else if (tran === 'usb') kind = truthy(rota) ? 'usb-hdd' : 'usb-ssd';
      map.set(n.mountpoint, { id: n.uuid ? `u${n.uuid}` : undefined, kind, label: n.label ?? undefined });
    }
    for (const c of n.children ?? []) walk(c, { ...n, tran, rota, name });
  };
  try {
    for (const d of (JSON.parse(raw) as { blockdevices: Node[] }).blockdevices) walk(d);
  } catch { /* ignore */ }
  return map;
}

async function macHints(mount: string): Promise<Hints> {
  const raw = await sh('diskutil', ['info', '-plist', mount]);
  if (!raw) return {};
  const str = (k: string) => new RegExp(`<key>${k}</key>\\s*<string>([^<]*)</string>`).exec(raw)?.[1];
  const bool = (k: string) => new RegExp(`<key>${k}</key>\\s*<(true|false)/>`).exec(raw)?.[1] === 'true';
  const bus = str('BusProtocol') ?? '';
  let kind: DriveKind = 'external';
  if (/secure digital|sd/i.test(bus)) kind = 'sd';
  else if (bool('Internal')) kind = 'internal';
  else if (/usb|thunderbolt/i.test(bus)) kind = bool('SolidState') ? 'usb-ssd' : 'usb-hdd';
  const uuid = str('VolumeUUID');
  return { id: uuid ? `u${uuid}` : undefined, kind };
}

async function winHints(): Promise<Map<string, Hints>> {
  const map = new Map<string, Hints>();
  const raw = await sh('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeSerialNumber | ConvertTo-Json -Compress'], 8000);
  if (!raw.trim()) return map;
  try {
    const parsed = JSON.parse(raw) as { DeviceID: string; DriveType: number; VolumeSerialNumber?: string } | Array<{ DeviceID: string; DriveType: number; VolumeSerialNumber?: string }>;
    for (const d of Array.isArray(parsed) ? parsed : [parsed]) {
      map.set(`${d.DeviceID}\\`, { id: d.VolumeSerialNumber ? `u${d.VolumeSerialNumber}` : undefined, kind: d.DriveType === 2 ? 'sd' : 'external' });
    }
  } catch { /* ignore */ }
  return map;
}

async function describe(m: Mount, linux: Map<string, Hints & { label?: string }>, win: Map<string, Hints>): Promise<Drive | null> {
  let total = 0;
  let free = 0;
  try {
    const st = await fs.statfs(m.mount);
    total = Number(st.bsize) * Number(st.blocks);
    free = Number(st.bsize) * Number(st.bavail);
  } catch {
    return null;
  }
  if (total <= 0) return null;
  let hints: Hints & { label?: string } = {};
  if (process.platform === 'darwin') hints = await macHints(m.mount);
  else if (process.platform === 'win32') hints = win.get(m.mount) ?? {};
  else hints = linux.get(m.mount) ?? {};
  const name = hints.label || m.label;
  return {
    id: hints.id ?? `v${hash(`${name}:${total}`)}`,
    name,
    mount: m.mount,
    kind: hints.kind ?? 'external',
    totalBytes: total,
    usedBytes: Math.max(0, total - free),
    mounted: true,
    excluded: false
  };
}

export const localDrive = (): Drive => ({
  id: LOCAL_DRIVE_ID,
  name: 'This computer',
  mount: '',
  kind: 'internal',
  totalBytes: 0,
  usedBytes: 0,
  mounted: true,
  excluded: false
});

export async function detectDrives(): Promise<Drive[]> {
  const mounts = await listMounts();
  const [linux, win] = await Promise.all([
    process.platform === 'linux' ? linuxHints() : Promise.resolve(new Map<string, Hints & { label?: string }>()),
    process.platform === 'win32' ? winHints() : Promise.resolve(new Map<string, Hints>())
  ]);
  const drives = (await Promise.all(mounts.map((m) => describe(m, linux, win)))).filter((d): d is Drive => d !== null);
  return drives;
}

/** Watches for volumes appearing and disappearing. Polls, because there is no portable mount event. */
export class DriveWatcher {
  private timer: NodeJS.Timeout | null = null;
  private current: Drive[] = [];
  private sig = '';
  private ticks = 0;
  constructor(private onChange: (drives: Drive[]) => void) {}

  get drives(): Drive[] {
    return this.current;
  }

  async start(): Promise<Drive[]> {
    await this.poll(true);
    this.timer = setInterval(() => void this.poll(false), 2500);
    return this.current;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(first: boolean): Promise<void> {
    this.ticks++;
    const drives = await detectDrives();
    const sig = drives.map((d) => `${d.id}@${d.mount}`).sort().join('|');
    const usageRefresh = this.ticks % 12 === 0;
    if (sig !== this.sig || usageRefresh) {
      const changed = sig !== this.sig;
      this.sig = sig;
      this.current = drives;
      if (changed || usageRefresh) if (!first) this.onChange(drives);
    }
  }

  /** The mounted drive that contains an absolute path, longest mount wins. */
  driveForPath(abs: string): Drive | null {
    let best: Drive | null = null;
    for (const d of this.current) {
      const root = d.mount.replace(/[\\/]+$/, '');
      if (abs === root || abs.startsWith(root + path.sep) || abs.startsWith(root + '/')) {
        if (!best || d.mount.length > best.mount.length) best = d;
      }
    }
    return best;
  }
}
