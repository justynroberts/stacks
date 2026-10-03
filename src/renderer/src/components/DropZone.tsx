/** Shown over the list while files are dragged onto the window. The drop itself is handled at window level. */
export function DropZone({ dragging }: { dragging: boolean }) {
  if (!dragging) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-bg">
      <div className="text-center">
        <div className="text-readout font-bold">Drop to import</div>
        <div className="mt-2 text-label font-medium text-muted">FILES · FOLDERS · ZIP PACKS — WAV AIF FLAC MP3 OGG</div>
      </div>
    </div>
  );
}
