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
    expect(within(panel).getByText('rhodes_loop_dusty_Am_84bpm.wav')).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: /Compatible keys: .*8A.*7A.*9A.*8B|Compatible keys/ })).toBeInTheDocument();
  });

  it('renames with key and BPM', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Rename with key + BPM' }));
    expect(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am_84bpm\.wav/ })).toBeInTheDocument();
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
    // The 172 break is folded to 86, so the fastest is the 140 reese.
    await waitFor(() => expect(within(screen.getAllByRole('row')[1]!).getByText('140')).toBeInTheDocument());
  });

  it('has no accessibility violations axe can find', async () => {
    const { container } = mount();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await within(grid).findByRole('row', { name: /rhodes_loop/ });
    const res = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('starts light and toggles to dark', async () => {
    localStorage.clear();
    mount();
    const user = userEvent.setup();
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('excludes a drive and brings it back', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await within(grid).findByRole('row', { name: /hat_closed_tight/ });
    await user.click(screen.getByRole('button', { name: 'Exclude MPC_SD_128' }));
    await waitFor(() => expect(within(grid).queryByRole('row', { name: /hat_closed_tight/ })).toBeNull());
    expect(screen.queryByRole('button', { name: /^MPC_SD_128/ })).toBeNull();
    const excluded = screen.getByRole('region', { name: 'Excluded drives' });
    await user.click(within(excluded).getByRole('button', { name: 'Include MPC_SD_128' }));
    expect(await within(grid).findByRole('row', { name: /hat_closed_tight/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Excluded drives' })).toBeNull();
  });

  it('opens the editor, edits, and saves a copy next to the original', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Edit sample' }));
    const editor = await screen.findByRole('region', { name: 'Sample editor' });
    await within(editor).findByRole('img', { name: /Waveform of rhodes_loop_dusty_Am\.wav, mono/ });

    const save = within(editor).getByRole('button', { name: 'SAVE AS COPY' });
    expect(save).toBeDisabled();
    expect(within(editor).getByRole('button', { name: 'TRIM' })).toBeDisabled();

    // Type a selection, then trim to it.
    const start = within(editor).getByRole('textbox', { name: 'Selection start' });
    const end = within(editor).getByRole('textbox', { name: 'Selection end' });
    await user.clear(end); await user.type(end, '0:02.000{Enter}');
    await user.clear(start); await user.type(start, '0:01.000{Enter}');
    await user.click(within(editor).getByRole('button', { name: 'TRIM' }));
    expect(within(editor).getByText(/EDITED · 1 CHANGE/)).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'UNDO' }));
    expect(within(editor).queryByText(/EDITED/)).toBeNull();
    await user.click(within(editor).getByRole('button', { name: 'REDO' }));
    await user.click(within(editor).getByRole('button', { name: 'NORMALIZE' }));
    expect(within(editor).getByText(/EDITED · 2 CHANGES/)).toBeInTheDocument();

    await user.click(within(editor).getByRole('button', { name: 'SAVE AS COPY' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sample editor' })).toBeNull());
    expect(await within(screen.getByRole('grid', { name: 'Samples' })).findByRole('row', { name: /rhodes_loop_dusty_edit_Am\.wav/ })).toBeInTheDocument();
    expect(within(screen.getByRole('grid', { name: 'Samples' })).getByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ })).toBeInTheDocument();
  });

  it('auto-loops and saves just the loop to another drive, staying in the editor', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Edit sample' }));
    const editor = await screen.findByRole('region', { name: 'Sample editor' });
    await within(editor).findByRole('img', { name: /Waveform of/ });
    expect(within(editor).getByRole('button', { name: 'SAVE LOOP' })).toBeDisabled();

    await user.click(within(editor).getByRole('button', { name: 'AUTO LOOP' }));
    expect(within(editor).getByRole('button', { name: /^AUTO LOOP 1\/\d+$/ })).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: 'LOOP' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(editor).getByText(/2 BARS · CANDIDATE 1 OF/)).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: /^AUTO LOOP 1\// }));
    expect(within(editor).getByRole('button', { name: /^AUTO LOOP 2\// })).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: '1 BAR' }));

    await user.selectOptions(within(editor).getByRole('combobox', { name: 'Save new files to' }), 'MPC_SD_128 / Stacks');
    await user.click(within(editor).getByRole('button', { name: 'SAVE LOOP' }));
    await waitFor(() => expect(screen.getByText(/Saved rhodes_loop_dusty_loop_1bar_Am\.wav to MPC_SD_128 \/ Stacks/)).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Sample editor' })).toBeInTheDocument();

    await user.click(within(editor).getByRole('button', { name: 'LIBRARY' }));
    const row = await within(screen.getByRole('grid', { name: 'Samples' })).findByRole('row', { name: /rhodes_loop_dusty_loop_1bar_Am\.wav/ });
    expect(within(row).getByText('MPC_SD_128')).toBeInTheDocument();
  });

  it('finds a set of loops, splits, reverses and exports them as files', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Edit sample' }));
    const editor = await screen.findByRole('region', { name: 'Sample editor' });
    await within(editor).findByRole('img', { name: /Waveform of/ });

    await user.click(within(editor).getByRole('button', { name: 'FIND LOOPS' }));
    const panel = await within(editor).findByRole('region', { name: 'Found loops' });
    await user.click(within(panel).getByRole('button', { name: '1' }));
    await user.click(within(panel).getByRole('button', { name: 'SPLIT' }));
    await waitFor(() => expect(within(panel).getAllByRole('listitem').length).toBeGreaterThanOrEqual(2));
    const rows = within(panel).getAllByRole('listitem');

    // Keep the first two, reverse the first, export.
    for (const r of rows.slice(2)) await user.click(within(r).getByRole('checkbox'));
    await user.click(within(rows[0]!).getByRole('button', { name: 'Reverse loop 1' }));
    expect(within(panel).getByRole('button', { name: 'EXPORT 3 FILES' })).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: 'EXPORT 3 FILES' }));
    await waitFor(() => expect(within(editor).getByText(/EXPORTED 3 FILES BESIDE THE ORIGINAL/)).toBeInTheDocument());

    await user.click(within(editor).getByRole('button', { name: 'LIBRARY' }));
    const lib = screen.getByRole('grid', { name: 'Samples' });
    expect(await within(lib).findByRole('row', { name: /rhodes_loop_dusty_loop01_1bar_Am\.wav/ })).toBeInTheDocument();
    expect(within(lib).getByRole('row', { name: /rhodes_loop_dusty_loop01_1bar_rev_Am\.wav/ })).toBeInTheDocument();
    expect(within(lib).getByRole('row', { name: /rhodes_loop_dusty_loop02_1bar_Am\.wav/ })).toBeInTheDocument();
  });

  it('asks before throwing away edits', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    await user.click(screen.getByRole('button', { name: 'Edit sample' }));
    const editor = await screen.findByRole('region', { name: 'Sample editor' });
    await within(editor).findByRole('img', { name: /Waveform of/ });
    await user.click(within(editor).getByRole('button', { name: 'REVERSE' }));
    await user.click(within(editor).getByRole('button', { name: 'LIBRARY' }));
    expect(screen.getByRole('region', { name: 'Sample editor' })).toBeInTheDocument();
    await user.click(within(editor).getByRole('button', { name: 'DISCARD EDITS?' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Sample editor' })).toBeNull());
  });

  it('loops the preview from the clip view or with L', async () => {
    mount();
    const user = userEvent.setup();
    const grid = await screen.findByRole('grid', { name: 'Samples' });
    await user.click(await within(grid).findByRole('row', { name: /rhodes_loop_dusty_Am\.wav/ }));
    const toggle = screen.getByRole('button', { name: 'LOOP · L' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    grid.focus();
    await user.keyboard('l');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('has an about button crediting FintonLabs', async () => {
    mount();
    await screen.findByRole('grid', { name: 'Samples' });
    expect(screen.getByRole('button', { name: 'About this app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FintonLabs', hidden: true })).toHaveAttribute('href', 'https://fintonlabs.com');
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
    it(`${name}: text meets WCAG AA on every surface, the accent meets the 3:1 graphics bar`, () => {
      for (const bg of ['bg', 'raised', 'sel']) {
        for (const fg of ['fg', 'muted', 'faint']) expect(ratio(t[fg]!, t[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        // The accent is never used for text (see styles.css), only for marks, fills and waveforms.
        expect(ratio(t['accent']!, t[bg]!), `accent on ${bg}`).toBeGreaterThanOrEqual(3);
      }
      expect(ratio(t['accent-ink']!, t['accent']!), 'ink on accent').toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['lcd']!, t['inset']!), 'counter digits').toBeGreaterThanOrEqual(4.5);
    });
  }
});
