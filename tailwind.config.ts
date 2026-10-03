import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    // Three sizes only. Hierarchy comes from weight and spacing.
    fontSize: {
      label: ['11px', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      body: ['13px', { lineHeight: '1.4' }],
      readout: ['32px', { lineHeight: '1.15' }]
    },
    borderRadius: { none: '0', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius-sm)' },
    extend: {
      fontFamily: { mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'] },
      colors: {
        bg: 'var(--color-bg)',
        raised: 'var(--color-raised)',
        sel: 'var(--color-sel)',
        line: 'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        fg: 'var(--color-fg)',
        muted: 'var(--color-muted)',
        faint: 'var(--color-faint)',
        accent: 'var(--color-accent)',
        'accent-ink': 'var(--color-accent-ink)'
      }
    }
  },
  plugins: []
} satisfies Config;
