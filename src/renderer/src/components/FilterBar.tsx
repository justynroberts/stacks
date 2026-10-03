import * as Slider from '@radix-ui/react-slider';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { type FormEvent, useState } from 'react';
import { BPM_MAX, BPM_MIN } from '../filters';
import { useStore } from '../store';

function LinkFetch() {
  const { importUrl } = useStore();
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
    <form onSubmit={submit} className="flex h-7 w-[280px] flex-none items-stretch border border-line-strong bg-bg focus-within:border-fg">
      <input
        aria-label="Download link"
        placeholder="Paste a download link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 outline-none focus-visible:outline-none"
      />
      <button type="submit" disabled={busy || !url.trim()} className="border-l border-line-strong px-3 text-label font-semibold hover:bg-sel">
        {busy ? 'WAIT' : 'FETCH'}
      </button>
    </form>
  );
}

export function FilterBar() {
  const { filters, setFilters, selected } = useStore();
  const canMatch = !!selected?.analysis?.camelot || !!selected?.analysis?.bpm;
  return (
    <div className="flex h-11 flex-none items-center gap-5 border-b border-line px-4 text-label font-medium text-muted">
      <ToggleGroup.Root
        type="single"
        value={filters.kind}
        onValueChange={(v) => v && setFilters({ kind: v as 'all' | 'loop' | 'shot' })}
        aria-label="Sample type"
        className="flex h-7 border border-line-strong"
      >
        {([['all', 'ALL'], ['loop', 'LOOPS'], ['shot', 'SHOTS']] as const).map(([v, l]) => (
          <ToggleGroup.Item key={v} value={v} className="border-l border-line-strong px-3 first:border-l-0 hover:text-fg data-[state=on]:bg-fg data-[state=on]:text-bg">
            {l}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <div className="flex items-center gap-2">
        <span id="bpm-label">BPM</span>
        <span className="w-7 text-right text-body text-fg">{filters.bpm[0]}</span>
        <Slider.Root
          aria-labelledby="bpm-label"
          className="relative flex h-5 w-[128px] touch-none select-none items-center"
          min={BPM_MIN}
          max={BPM_MAX}
          step={1}
          minStepsBetweenThumbs={1}
          value={filters.bpm}
          onValueChange={(v) => setFilters({ bpm: [v[0] ?? BPM_MIN, v[1] ?? BPM_MAX] })}
        >
          <Slider.Track className="relative h-[3px] grow bg-line-strong">
            <Slider.Range className="absolute h-[3px] bg-accent" />
          </Slider.Track>
          <Slider.Thumb aria-label="Minimum BPM" className="block h-[14px] w-2 border border-bg bg-fg" />
          <Slider.Thumb aria-label="Maximum BPM" className="block h-[14px] w-2 border border-bg bg-fg" />
        </Slider.Root>
        <span className="w-7 text-body text-fg">{filters.bpm[1]}</span>
      </div>

      <button
        type="button"
        aria-pressed={filters.matchSelected}
        disabled={!canMatch}
        onClick={() => setFilters({ matchSelected: !filters.matchSelected })}
        className={`flex h-7 items-center gap-2 border px-3 ${filters.matchSelected ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:text-fg'}`}
      >
        <span className={`h-[6px] w-[6px] ${filters.matchSelected ? 'bg-accent' : 'bg-line-strong'}`} aria-hidden="true" />
        MIXES WITH SELECTED
      </button>

      <div className="flex-1" />
      <LinkFetch />
    </div>
  );
}
