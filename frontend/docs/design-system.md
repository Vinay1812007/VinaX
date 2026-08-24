# VinaX Design System — "Living Glass" (v4.1)

The single source of truth for how VinaX looks, moves and behaves.
Implementation lives in `src/styles/index.css` (token layers),
`tailwind.config.ts` (scale) and `src/components/*` (composition). Rule of
thumb: **new UI composes existing tokens/classes; new tokens require updating
this document.** (The v1.4 edition of this file described the retired
cyan-era palette; this edition matches the shipped indigo system.)

## 1. Theming architecture

Four modes, persisted in the settings store (`vinax.settings.v1`), resolved
by `src/utils/theme.ts`:

| Mode | Class on `<html>` | Notes |
| --- | --- | --- |
| Dark (default) | `dark` | The `:root` token set |
| Light | `light` | Full token override block |
| AMOLED | `dark amoled` | Rides dark; only the deepest surfaces go true-black |
| System | resolves live | `prefers-color-scheme` + change listener |

An inline pre-paint script in `index.html` reads the persisted preference and
classes `<html>` **before first paint** — no dark flash for light users, no
grey flash for AMOLED. It mirrors `applyThemeClasses()`; keep the two in
sync.

Future custom themes: add a token override block (the AMOLED block is the
template — override only what changes) plus a `ThemePref` union member. No
component changes are ever needed; that is the contract.

**Dynamic accent** (Settings) tints the ember ramp from the playing artwork
at runtime. The 400 (text) tier derives brighter on dark and darker on light
so extracted colors stay readable on both canvases.

## 2. Color tokens

- **Surfaces — `ink`** (950 → 100): 950/900/850/800/700 are canvases and
  cards; 600/500 are faint UI (dividers, disabled, decorative icons);
  400/300 are muted text; 200/100 are primary text. The ramp is monotonic by
  contrast and gated in BOTH themes by `src/__tests__/contrast.test.ts`.
- **Accent — `ember`** (indigo, 600 → 300): CTAs, focus rings, active
  states. **400 is the accent *text* tier.** In light mode the whole ramp
  re-pitches ~2 shades darker (the dark ramp measures 2.66:1 on a light
  canvas — illegible).
- **Support — `tide`** (cyan): chips, secondary links, recommendation
  reasons. Same light-mode re-pitch.
- **Glass material** — `--glass-bg*`, `--glass-border`,
  `--glass-border-strong`, `--glass-shadow*`, `--tile*`. Hairlines MUST use
  `border-glass` / `border-glass-strong`, never `border-white/N` (white
  alpha vanishes on light surfaces).
- **`--art`** + tint alphas: the living accent extracted from playing
  artwork; light mode washes frosted surfaces with it.

Text hierarchy in practice: `text-ink-100` headings → `text-ink-200` body →
`text-ink-300` secondary → `text-ink-400` meta (**the floor for meaningful
copy**) → `ink-500`/`ink-600` decorative only.

## 3. Type, spacing, radius, elevation

- **Type** — Manrope variable (self-hosted, `font-weight: 200–800`):
  `text-display` (2rem/800/-0.02em), `text-title` (1.375rem/700),
  `text-meta` (13px); 11px uppercase labels at +0.08em; `tabular-nums` for
  times and stats.
- **Spacing** — 8-point system via Tailwind (`gap-2/3/4/6`, `p-4/5/6`).
- **Radius** — controls = pill/circle; cards `2xl` (1.25rem = 20px) or
  `card` (1.375rem); heroes/sheets `3xl` (1.75rem = 28px) or `sheet`. No
  arbitrary `rounded-[Npx]` — if a value feels missing, promote a token.
- **Elevation** — `shadow-card` (contact) → `shadow-float` → `shadow-lift`;
  `shadow-glow` for the accent halo; glass surfaces carry `--glass-shadow`.

## 4. Motion

One easing (`--ease-calm`), durations 140/200/320ms (+ slow ambient drifts).
Page enter fade-up; hover lift −3px on cards; press squash 97%; blobs 18–30s
drift, dimmed when paused. **Every animation needs a reduced-motion fallback**
— both the OS preference and the in-app toggle must be respected.

## 5. Interactive states (mandatory for every control)

default (glass recipe) · hover (lift/brighten, pointer only) · active
(squash) · focused (`:focus-visible` 2px `ember-500` ring, offset 2) ·
disabled (45% opacity, no motion) · loading (`.skeleton` shimmer) ·
error/success (`.input-error`/`.input-success`).

## 6. Components (compose, don't reinvent)

Primitives: `Button` (wraps `.btn-primary|secondary|premium`; default
`type="button"`, `busy` state — prefer it in new code; the 84 existing raw
`btn-*` sites are valid usage, not migration debt) · `IconButton` (required
label; `--touch-pad` hit-box expansion to ≥44px — **the** pattern for any
visually-small control) · `Chip` · `MediaCard` · `SongRow` · `PageHeader` ·
`Marquee` · `Seekbar` · `Toasts` · `Skeletons` (Shelf/List/Header/Page/
CardGrid) · `States` (EmptyState / ErrorState with retry) · `ErrorBoundary`
(+ Player/Route variants) · `TrackMenu` · `ContextMenu` · `CommandPalette` ·
glass classes (`glass-card` `glass-panel` `glass-navbar` `glass-modal`
`glass-input` …).

**Cards**: `glass-card` for elevated content surfaces; a flat `bg-ink-800` +
`border-glass` row is acceptable for dense lists. Do not invent a third
idiom.

**Overlays**: `OnboardingSheet` holds the reference focus-trap
implementation (capture opener → initial focus → trap Tab → Escape →
restore). New overlays must reuse the pattern (shared `useFocusTrap`
extraction is scheduled — delta audit P1-9).

## 7. Hard rules

1. No raw hexes in components. Standing exceptions, by decision: canvas
   share cards (deliberately dark-branded for social feeds) and chart series
   palettes.
2. No `border-white/N`, no `text-white/N` — use tokens.
3. Every theme-affecting change keeps `contrast.test.ts` green.
4. `tailwind.config.ts` is linted (`no-dupe-keys`) — root configs sit
   outside tsc's include, so lint is their only gate. Never declare a theme
   key twice.
5. Icon-only controls: `IconButton`, or `aria-label` + `--touch-pad`.
6. Touch targets ≥44px effective; WCAG AA contrast on glass — raise surface
   alpha, never shrink text.

## 8. Voice & honesty

Warm, plain sentences. AI slowness is labeled, recommendations explain
themselves ("why this song"), nothing dark-patterned: no ads, no login
walls, no premium. The free promise renders as pride: "₹0 · free forever".
