import { MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { StacksApi } from '@shared/types';
import { DetailPanel } from './components/DetailPanel';
import { DropZone } from './components/DropZone';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { ImportQueue } from './components/ImportQueue';
import { SampleTable } from './components/SampleTable';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Editor } from './editor/Editor';
import { StoreProvider, useStore } from './store';

/** Window level drag and drop. Without this Electron would navigate to a dropped file. */
function useFileDrop(api: StacksApi): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragging(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => api.pathForFile(f)).filter(Boolean);
      if (paths.length) void api.addPaths(paths);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [api]);
  return dragging;
}

function Shell({ api }: { api: StacksApi }) {
  const dragging = useFileDrop(api);
  const { editing } = useStore();
  return (
    <div className="flex h-full flex-col bg-bg text-body text-fg">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col">
          {editing ? (
            <Editor key={editing.id} sample={editing} />
          ) : (
            <>
              <FilterBar />
              <div className="relative flex min-h-0 flex-1 flex-col">
                <SampleTable />
              </div>
            </>
          )}
          <ImportQueue />
          {!editing && <DetailPanel />}
          <DropZone dragging={dragging} />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

export function App({ api, demo = false, createWorker }: { api: StacksApi; demo?: boolean; createWorker?: () => Worker }) {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider api={api} demo={demo} createWorker={createWorker}>
        <Shell api={api} />
      </StoreProvider>
    </MotionConfig>
  );
}
