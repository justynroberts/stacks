import { useStore } from '../store';

export function StatusBar() {
  const { mounted, demo } = useStore();
  return (
    <footer className="flex h-7 flex-none items-center justify-between border-t border-line px-4 text-label text-faint">
      <span>
        {demo ? 'DEMO MODE · sample data, nothing touches your disk' : mounted.length ? `${mounted.map((d) => d.name).join(', ')} mounted` : 'No external drives connected'}
      </span>
      <span>Space preview · double click plays · drag a row into your DAW</span>
    </footer>
  );
}
