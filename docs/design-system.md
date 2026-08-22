# VinaX Design System — "Living Glass" (v1.4.0)

The single source of truth for how VinaX looks, moves and behaves.
Implementation lives in `src/styles/index.css` (token layers), `tailwind.config.ts`
(scale) and `src/components/*` (composition). Rule of thumb: **new UI composes
existing tokens/classes; new tokens require updating this document.**

## 1. Foundations

### Color tokens
| Token | Dark | Light | Use |
|---|---|---|---|
| canvas | `#060609` | `#eef0f6` | page base under blobs |
| ink-100…500 | light→dim text | dark→dim text | text hierarchy |
| ember (cyan era) | `#22d3ee` | same | brand primary, focus, active |
| tide (violet) | `#a78bfa` | same | brand secondary, gradients |
| `--art` | extracted from artwork | same | living accent |
| success / danger | `#7ce38b` / `#ff8a8a` | same | glass-tinted states |

### Glass recipes
| Surface | bg | blur | border | shadow |
|---|---|---|---|---|
| panel/card (dark) | rgba(9,9,16,.42) | 16px sat160 | white .10 | 0 8 32 black .30 |
| panel/card (light) | rgba(255,255,255,.45) | 16px sat160 | white .65 | 0 8 32 indigo .07 |
| navbar / player bar | same bg | **20px** | same | + top highlight |
| sheet / modal | same bg | **24px** | same | 0 24 64 -16 float |
Cards add: top sheen gradient + cyan corner glow (radial 170px @ top-right, .13).

### Type — Manrope variable (self-hosted, 24KB, `font-weight: 200–800`)
| Style | Size/leading | Weight | Tracking |
|---|---|---|---|
| display | 2rem / 2.25 | 800 | -0.02em |
| title | 1.25rem | 700 | -0.01em |
| body | 0.875–0.9375rem | 400/600 | 0 |
| label | 11px uppercase | 700 | +0.08em |
| numerals | tabular-nums for times/stats |

### Spacing & radius
8-point system via Tailwind (`gap-2/3/4/6`, `p-4/5/6`). Radii: controls = full
pill/circle · cards `1.25rem` (2xl) · heroes/sheets `1.75rem` (3xl).

## 2. Motion
Ease `var(--ease)` (smooth-spring) · 200–500ms.
- Page enter: fade-up, keyed on pathname
- Section stagger: rise 10px, 500ms, 40ms cascade (first 8)
- Hover: cards -3px lift + shadow · buttons -1px + brighten
- Press: 97% squash + radial **bloom** (CSS ripple)
- Dock: active icon springs 1→1.14→1 (450ms)
- Theme: sun/moon rotate past each other (500ms); surfaces cross-fade 400ms
- Blobs: 18–30s drifts; dim 40% when paused
**Every animation has a reduced-motion fallback (opacity-only or none).**

## 3. Interactive states (mandatory for every control)
| State | Treatment |
|---|---|
| default | glass recipe of its surface |
| hover | lift/brighten (pointer devices only) |
| active | squash + bloom |
| focused | `:focus-visible` ring `rgba(138,103,255,.65)`, offset 2px |
| disabled | 45% opacity, no motion/shadow, `not-allowed` |
| loading | `.skeleton` (+ auto shimmer sweep) |
| success / error | `.input-success` / `.input-error` ring + border |

## 4. Components (compose, don't reinvent)
`glass-card` `glass-panel` `glass-navbar` `glass-sheet` `glass-modal`
`glass-search` `glass-input` · `btn-primary` `btn-secondary` `IconButton`
`Chip` `Toggle` · `nav-pill-active` (menus) · dock (`vx-dock-*`) ·
`Shelf`+`MediaCard` · `LiveLyricLine` · `ChatPlayerCard` · `Skeletons` ·
`Toasts` · `AuroraBackground` (the blob layer) · `SiteGate` (maintenance).

## 5. Accessibility
- Touch targets ≥44px (IconButton pads automatically)
- WCAG AA contrast on glass — if a panel fails over bright blobs, raise bg alpha, never shrink text
- Full keyboard: focus-visible everywhere, Esc closes overlays, D-pad on TV
- `prefers-reduced-motion` respected globally; `aria-label` on icon-only controls

## 6. Voice & honesty
Warm, plain sentences. AI slowness is labeled ("Instant picks"), recommendations
explain themselves ("why this song"), nothing dark-patterned: no ads, no login
walls, no premium. The free promise renders as pride: "₹0 · free forever".
