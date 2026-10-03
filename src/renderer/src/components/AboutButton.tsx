import { useRef, useState } from 'react';
import { useStore } from '../store';
import { version } from '../../../../package.json';
import { Logo } from './Logo';

export function AboutButton() {
  const dlg = useRef<HTMLDialogElement>(null);
  const { api } = useStore();
  const [update, setUpdate] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const checkNow = async () => {
    setChecking(true);
    setUpdate(await api.checkForUpdates().catch((e: unknown) => `Could not check: ${String(e)}`));
    setChecking(false);
  };
  const open = () => {
    const d = dlg.current;
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  };
  const close = () => {
    const d = dlg.current;
    if (!d) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  };
  return (
    <>
      <button
        type="button"
        aria-label="About this app"
        aria-haspopup="dialog"
        title="About"
        onClick={open}
        className="no-drag flex h-8 w-8 items-center justify-center text-muted hover:bg-sel hover:text-fg"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 11V7.25M8 5v.01" />
        </svg>
      </button>
      <dialog
        ref={dlg}
        aria-labelledby="about-title"
        onClick={(e) => { if (e.target === dlg.current) close(); }}
        className="about m-auto w-[300px] border border-line-strong bg-bg p-0 text-body text-fg"
      >
        <div className="flex items-center justify-between border-b border-line bg-raised px-4 py-3">
          <h2 id="about-title"><Logo size={18} /></h2>
          <span className="text-label text-faint">v{version}</span>
        </div>
        <div className="px-4 py-4">
          <p className="text-muted">Sample manager for drives and SD cards. Key and BPM read on import.</p>
          <p className="mt-3">
            Made by{' '}
            <a href="https://fintonlabs.com" target="_blank" rel="noopener" className="font-semibold underline decoration-accent decoration-2 underline-offset-4">
              FintonLabs
            </a>
          </p>
        </div>
        <div className="border-t border-line px-4 py-3">
          {update && <p role="status" className="mb-3 text-label tracking-normal text-muted">{update}</p>}
          <div className="flex justify-between">
            <button type="button" onClick={() => void checkNow()} disabled={checking} className="h-8 border border-line-strong px-3 hover:bg-sel">
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            <button type="button" onClick={close} className="h-8 border border-line-strong px-4 hover:bg-sel">Close</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
