import * as Slider from '@radix-ui/react-slider';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { BPM_MAX, BPM_MIN } from '../filters';
import { useStore } from '../store';

export function FilterBar() {
  const { filters, setFilters, visible, samples, selected } = useStore();
  const canMatch = !!selected?.analysis?.camelot || !!selected?.analysis?.bpm;
  return (
    <div className="mx-6 mt-3 flex h-8 flex-none items-center gap-6 text-label text-faint">
      <ToggleGroup.Root
        type="single"
        value={filters.kind}
        onValueChange={(v) => v && setFilters({ kind: v as 'all' | 'loop' | 'shot' })}
        aria-label="Sample type"
        className="flex border border-line-strong"
      >
        {([['all', 'ALL'], ['loop', 'LOOPS'], ['shot', 'SHOTS']] as const).map(([v, l]) => (
          <ToggleGroup.Item key={v} value={v} className="px-[10px] py-[6px] data-[state=on]:bg-line data-[state=on]:text-fg hover:text-fg">
            {l}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>

      <div className="flex items-center gap-[10px]">
        <span id="bpm-label">BPM</span>
        <span className="w-7 text-right text-fg">{filters.bpm[0]}</span>
        <Slider.Root
          aria-labelledby="bpm-label"
          className="relative flex h-5 w-[140px] touch-none select-none items-center"
          min={BPM_MIN}
          max={BPM_MAX}
          step={1}
          minStepsBetweenThumbs={1}
          value={filters.bpm}
          onValueChange={(v) => setFilters({ bpm: [v[0] ?? BPM_MIN, v[1] ?? BPM_MAX] })}
        >
          <Slider.Track className="relative h-px grow bg-line-strong">
            <Slider.Range className="absolute h-[3px] -translate-y-px bg-accent" />
          </Slider.Track>
          <Slider.Thumb aria-label="Minimum BPM" className="block h-3 w-[6px] bg-fg" />
          <Slider.Thumb aria-label="Maximum BPM" className="block h-3 w-[6px] bg-fg" />
        </Slider.Root>
        <span className="w-7 text-fg">{filters.bpm[1]}</span>
      </div>

      <button
        type="button"
        aria-pressed={filters.matchSelected}
        disabled={!canMatch}
        onClick={() => setFilters({ matchSelected: !filters.matchSelected })}
        className={`border px-[10px] py-[6px] ${filters.matchSelected ? 'border-accent text-fg' : 'border-line-strong hover:text-fg'}`}
      >
        MIXES WITH SELECTED
      </button>

      <div className="flex-1" />
      <span aria-live="polite">{visible.length.toLocaleString()} shown of {samples.length.toLocaleString()}</span>
    </div>
  );
}
