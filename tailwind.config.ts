import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    // Three sizes only. Hierarchy comes from weight and spacing.
    fontSize: {
      label: ['11px', { lineHeight: '1.35', letterSpacing: '0.1em' }],
      body: ['14px', { lineHeight: '1.35' }],
      readout: ['28px', { lineHeight: '1' }]
    },
    borderRadius: { none: '0', sm: 'var(--radius-sm)', DEFAULT: 'var(--radius-sm)' },
    extend: {
      fontFamily: { sans: ['"Barlow Semi Condensed"', '"Arial Narrow"', 'system-ui', 'sans-serif'] },
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
        'accent-ink': 'var(--color-accent-ink)',
        inset: 'var(--color-inset)',
        'inset-line': 'var(--color-inset-line)',
        lcd: 'var(--color-lcd)'
      }
    }
  },
  plugins: []
} satisfies Config;
