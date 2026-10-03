import '@fontsource/barlow-semi-condensed/400.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
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
