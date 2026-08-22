import type { Config } from 'tailwindcss';

/**
 * Tarang design tokens.
 * Dark-first. "Ink" surfaces, warm amber "ember" accent, teal "tide" support.
 * Spacing follows a 4px base grid via Tailwind defaults.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      colors: {
        ink: {
          950: 'rgb(var(--ink-950) / <alpha-value>)',
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          850: 'rgb(var(--ink-850) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
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
        'display': ['2rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em', fontWeight: '800' }],
        'title': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em', fontWeight: '700' }],
        'meta': ['0.8125rem', { lineHeight: '1.125rem' }],
      },
      borderRadius: {
        card: '1.375rem',
        sheet: '2rem',
        pill: '9999px',
      },
      boxShadow: {
        // Soft, premium elevation — layered (contact + ambient) for realism.
        card: '0 1px 2px rgba(0,0,0,0.18), 0 6px 20px -6px rgba(0,0,0,0.40)',
        float: '0 2px 6px rgba(0,0,0,0.22), 0 12px 34px -8px rgba(0,0,0,0.50)',
        lift: '0 12px 44px -12px rgba(0,0,0,0.55)',
        glow: '0 0 40px rgb(var(--ember-500) / 0.35)',
        soft: '0 12px 40px -10px rgba(0,0,0,0.45)',
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
        'fade-up': 'fade-up 0.25s ease-out both',
        marquee: 'marquee 12s linear infinite',
        confetti: 'confetti 2.4s linear both',
        'aurora-a': 'aurora-a 22s ease-in-out infinite',
        'aurora-b': 'aurora-b 28s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
