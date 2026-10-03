import { type FormEvent, useState } from 'react';
import { useStore } from '../store';

export function DropZone({ dragging }: { dragging: boolean }) {
  const { importUrl, notice } = useStore();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    const ok = await importUrl(url.trim());
    setBusy(false);
    if (ok) setUrl('');
  };

  return (
    <section
      aria-label="Import"
      className={`mx-6 mt-4 flex h-[72px] flex-none items-center gap-6 border px-4 ${dragging ? 'border-solid border-accent bg-sel' : 'border-dashed border-line-strong'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-bold">{dragging ? 'Drop to import' : 'Drop files, folders or zip packs here'}</div>
        <div className="mt-[2px] truncate text-label text-faint" role="status" aria-live="polite">
          {notice ? <span className={notice.error ? 'text-accent' : 'text-muted'}>{notice.text}</span> : 'wav aif flac mp3 ogg · key and BPM on import'}
        </div>
      </div>
      <form onSubmit={submit} className="flex h-8 w-[300px] flex-none items-stretch border border-line-strong focus-within:border-accent">
        <input
          aria-label="Download link"
          placeholder="or paste a download link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-[10px] outline-none focus-visible:outline-none"
        />
        <button type="submit" disabled={busy || !url.trim()} className="border-l border-line-strong px-3 text-label font-medium">
          {busy ? 'WAIT' : 'FETCH'}
        </button>
      </form>
    </section>
  );
}
