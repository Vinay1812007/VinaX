import type { Config } from 'tailwindcss';

/**
 * VinaX design tokens.
 * Dark-first. "Ink" surfaces, indigo "ember" accent, cyan "tide" support.
 * Spacing follows a 4px base grid via Tailwind defaults.
 *
 * NOTE: keep each theme key declared exactly once — a duplicate key in this
 * object silently discards the earlier one (this bit us: borderRadius was
 * declared twice and 2xl/3xl fell back to Tailwind defaults at 93 call
 * sites). This file is linted by `npm run lint` (no-dupe-keys) to prevent a
 * recurrence.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        // v5.8.1 formal pass: the whole radius scale tightened in one place so
        // every rounded-2xl/3xl call site reads crisp (was 1.25 / 1.75 / 1.375 / 2rem).
        '2xl': '0.875rem',
        '3xl': '1rem',
        card: '0.75rem',
        sheet: '1.25rem',
        pill: '9999px',
      },
      borderColor: {
        // Hairline tokens — always use these instead of border-white/N so
        // hairlines re-theme (white-alpha borders vanish on light surfaces).
        glass: 'var(--glass-border)',
        'glass-strong': 'var(--glass-border-strong)',
      },
      colors: {
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
        },
        ember: {
          600: 'rgb(var(--ember-600) / <alpha-value>)',
          500: 'rgb(var(--ember-500) / <alpha-value>)',
          400: 'rgb(var(--ember-400) / <alpha-value>)',
          300: 'rgb(var(--ember-300) / <alpha-value>)',
        },
        tide: {
          500: 'rgb(var(--tide-500) / <alpha-value>)',
          400: 'rgb(var(--tide-400) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Noto Sans', 'sans-serif'],
      },
      fontSize: {
        // VinaX type scale — expressive display sizes, compact metadata.
        display: ['var(--vx-type-display)', { lineHeight: '1.12', letterSpacing: '-0.035em', fontWeight: '750' }],
        title: ['var(--vx-type-section)', { lineHeight: '1.4', letterSpacing: '-0.025em', fontWeight: '700' }],
        meta: ['var(--vx-type-meta)', { lineHeight: '1.5' }],
        // Page-level h1 — exactly what PageHeader renders (`.vx-page-header h1`
        // reads the same token, tracking included), so hand-rolled page titles
        // cannot drift from it.
        'page-title': ['var(--vx-type-page)', { lineHeight: '1.2', letterSpacing: '-0.035em', fontWeight: '750' }],
        'card-title': ['var(--vx-type-card)', { lineHeight: '1.4', fontWeight: '650' }],
        body: ['var(--vx-type-body)', { lineHeight: '1.6' }],
        caption: ['var(--vx-type-caption)', { lineHeight: '1.5' }],
      },
      boxShadow: {
        // Soft, premium elevation — layered (contact + ambient) for realism.
        // v5.8.1 formal pass: contact shadows only — no ambient bloom, no glow.
        card: '0 1px 2px rgba(0,0,0,0.18)',
        float: '0 2px 8px -2px rgba(0,0,0,0.35)',
        lift: '0 4px 16px -8px rgba(0,0,0,0.45)',
        glow: '0 0 0 1px rgb(var(--ember-500) / 0.25)',
        soft: '0 4px 16px -8px rgba(0,0,0,0.35)',
      },
      transitionTimingFunction: {
        vinax: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        'pulse-bar': {
          '0%, 100%': { transform: 'scaleY(0.4)' },
          '50%': { transform: 'scaleY(1)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        marquee: {
          // Hold readable at the start of every loop, then glide one copy.
          '0%, 18%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        confetti: {
          '0%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(110vh) rotate(540deg)', opacity: '0.7' },
        },
        'aurora-a': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(8vw,6vh) scale(1.15)' },
        },
        'aurora-b': {
          '0%,100%': { transform: 'translate(0,0) scale(1.1)' },
          '50%': { transform: 'translate(-6vw,-8vh) scale(0.95)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.4s linear infinite',
        'pulse-bar': 'pulse-bar 0.9s ease-in-out infinite',
        // `backwards`, never `both`: a forwards fill leaves `transform:
        // translateY(0)` on the element for good, which makes it a containing
        // block + stacking context — every `fixed` overlay inside a page was
        // positioned against the page instead of the viewport. The end state
        // equals the natural style, so nothing needs to be held.
        'fade-up': 'fade-up 0.25s ease-out backwards',
        marquee: 'marquee 12s linear infinite',
        confetti: 'confetti 2.4s linear both',
        'aurora-a': 'aurora-a 22s ease-in-out infinite',
        'aurora-b': 'aurora-b 28s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
