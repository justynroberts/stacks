/** Three slabs, stacked like clips: the top one is lit. Same drawing as build/icon.svg. */
export function Logo({ size = 20, wordmark = true }: { size?: number; wordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="15.5" width="18" height="5" fill="currentColor" />
        <rect x="3" y="9.5" width="13" height="5" fill="currentColor" />
        <rect x="3" y="3.5" width="8" height="5" fill="var(--color-accent)" />
      </svg>
      {wordmark && <span className="font-bold tracking-[0.2em]">STACKS</span>}
    </span>
  );
}
