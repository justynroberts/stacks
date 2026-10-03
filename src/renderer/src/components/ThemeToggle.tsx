import { useEffect, useState } from 'react';

// v2: the old key always held 'dark', written by default rather than chosen.
const KEY = 'stacks-theme-v2';

/** Light by default; dark is the one alternative. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch { /* storage can be blocked */ }
    setDark(stored === 'dark');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);

  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label="Dark theme"
      title={dark ? 'Switch to light' : 'Switch to dark'}
      onClick={() => setDark((d) => !d)}
      className="no-drag flex h-8 w-8 items-center justify-center text-muted hover:bg-sel hover:text-fg"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {dark ? <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" /> : <><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></>}
      </svg>
    </button>
  );
}
