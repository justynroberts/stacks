import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { StacksApi } from '@shared/types';
import { App } from './App';
import { createMockApi } from './mock/mockApi';

declare global {
  interface Window {
    stacks?: StacksApi;
  }
}

const stress = Number(new URLSearchParams(location.search).get('stress')) || 0;
const api = window.stacks ?? createMockApi({ stress });
const demo = !window.stacks;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={api} demo={demo} />
  </StrictMode>
);
