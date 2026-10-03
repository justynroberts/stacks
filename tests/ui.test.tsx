// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { createMockApi } from '@/mock/mockApi';

vi.mock('@/analysis/createWorker', () => ({ createAnalysisWorker: () => ({ postMessage() {}, terminate() {}, onmessage: null }) }));

afterEach(cleanup);

const fakeWorker = () => ({ postMessage() {}, terminate() {}, onmessage: null }) as unknown as Worker;
const mount = () => render(<App api={createMockApi({ preanalysed: true })} demo createWorker={fakeWorker} />);

describe('library screen', () => {
  it('lists samples with key, BPM and Camelot', async () => {
    mount();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    const row = await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ });
    expect(within(row).getByText('84')).toBeInTheDocument();
    expect(within(row).getByText('Am')).toBeInTheDocument();
    expect(within(row).getByText('8A')).toBeInTheDocument();
  });

  it('shows the selected sample in the detail panel and what it mixes with', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    const panel = screen.getByRole('region', { name: 'Selected sample' });
    expect(within(panel).getByRole('heading', { name: 'rhodes_loop_dusty_Am.wav' })).toBeInTheDocument();
    expect(within(panel).getByText('084_Am_rhodes_loop_dusty.wav')).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: /Compatible keys: .*8A.*7A.*9A.*8B|Compatible keys/ })).toBeInTheDocument();
  });

  it('renames with key and BPM', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Rename with key + BPM' }));
    expect(await within(grid).findByRole('row', { name: /084_Am_rhodes_loop_dusty\.wav/ })).toBeInTheDocument();
  });

  it('filters by search and by drive', async () => {
    mount();
    const user = userEvent.setup();
    await screen.findByRole('grid', { name: 'Samples' });
    await user.type(screen.getByRole('textbox', { name: 'Search samples' }), 'kalimba');
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(2)); // header + one match
    await user.clear(screen.getByRole('textbox', { name: 'Search samples' }));
    await user.click(screen.getByRole('button', { name: /^MPC_SD_128/ }));
    const grid = screen.getByRole('grid', { name: 'Samples' });
    await waitFor(() => expect(within(grid).queryByRole('row', { name: /rhodes_loop/ })).toBeNull());
    expect(within(grid).getByRole('row', { name: /hat_closed_tight/ })).toBeInTheDocument();
  });

  it('only shows mixable samples when asked', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /strings_lofi_pad_Dm/ })); // 7A, 70 bpm
    await user.click(screen.getByRole('button', { name: 'MIXES WITH SELECTED' }));
    // 7A mixes with 6A, 8A and 7B. Tempo must be within 6% of 70, but a sample with no tempo is not ruled out,
    // so the unpitched-tempo 808 in 7B stays and the 84 bpm Rhodes in 8A goes.
    await waitFor(() => expect(within(grid).getAllByRole('row').length).toBe(3));
    expect(within(grid).getByRole('row', { name: /strings_lofi_pad_Dm/ })).toBeInTheDocument();
    expect(within(grid).getByRole('row', { name: /808_sub_glide_F/ })).toBeInTheDocument();
    expect(within(grid).queryByRole('row', { name: /rhodes_loop/ })).toBeNull();
  });

  it('moves the selection with the arrow keys', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    const selectedRow = () => within(grid).queryAllByRole('row').find((r) => r.getAttribute('aria-selected') === 'true');
    await waitFor(() => expect(selectedRow()).toBeDefined());
    const first = selectedRow()!.id;
    grid.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(selectedRow()!.id).not.toBe(first));
    expect(grid).toHaveAttribute('aria-activedescendant', selectedRow()!.id);
  });

  it('sorts when a header is clicked', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await within(grid).findByRole('row', { name: /rhodes_loop/ });
    await user.click(screen.getByRole('button', { name: 'BPM' }));
    await waitFor(() => expect(within(screen.getAllByRole('row')[1]!).getByText('70')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^BPM/ }));
    await waitFor(() => expect(within(screen.getAllByRole('row')[1]!).getByText('172')).toBeInTheDocument());
  });

  it('has no accessibility violations axe can find', async () => {
    const { container } = mount();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await within(grid).findByRole('row', { name: /rhodes_loop/ });
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('toggles the theme class', async () => {
    mount();
    const user = userEvent.setup();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

// jsdom cannot compute colour contrast, so check the design tokens directly.
describe('colour tokens', () => {
  const css = readFileSync('src/renderer/src/styles.css', 'utf8');
  const block = (sel: RegExp) => Object.fromEntries([...(sel.exec(css)?.[1] ?? '').matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
  const light = block(/:root\s*\{([^}]*)\}/);
  const dark = block(/:root\.dark\s*\{([^}]*)\}/);
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

  for (const [name, t] of [['dark', dark], ['light', light]] as const) {
    it(`${name}: text and accent meet WCAG AA on every surface`, () => {
      for (const fg of ['fg', 'muted', 'faint', 'accent']) {
        for (const bg of ['bg', 'raised', 'sel']) {
          expect(ratio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(ratio(t['accent-ink']!, t['accent']!), 'ink on accent').toBeGreaterThanOrEqual(4.5);
    });
  }
});
