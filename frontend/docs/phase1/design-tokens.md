# Design System Foundation — "Noir Bloom" (canonical)

Live implementation: final `:root` layer of `src/styles/index.css` (owns the cascade).
This document is the approval record + spec. All values are CSS custom properties;
components must consume tokens, never raw values.

## 1. Color

**Canvas (ink scale, dark):** 950 `#060609` · 900 `#0c0c11` · 850 `#101016` · 800 `#191922`
· 700 `#272734` · 600 `#48485c` · 400 `#808094` · 300 `#b6b6c6` · 200 `#d8d8e4` · 100 `#f7f7fc`.
Light theme inverts the scale; AMOLED forces 950 → `#000`.

**Accents:** primary "bloom" violet `--ember-500: #8a67ff` (600 `#6d4aff`, 400 `#a88dff`,
300 `#c7b5ff`); secondary pink `--tide-500: #ec4899`. Gradients:
primary `120° #8a67ff→#ec4899`, premium `115° #8a67ff→#d357fe→#ff5c8a`.

**Living accent `--art`:** per-song vibrant color extracted from artwork
(vibrancy-weighted sampling, luma-lifted to ≥92; fallback = ember). Drives: backdrop auras,
dock active pill, mini-player halo, glows. This is the signature token — treat as accent-1.

## 2. Material (smoked glass)

`--glass-bg rgba(24,22,34,.50)` · strong `.62` · muted `.38` · hover `.60` · active `.66`;
border `rgba(255,255,255,.08)`; blur 20px (cards) / 36px (chrome); saturate 150%;
phones ≤640px render blur 0 (performance). Surfaces: navbar/sidebar ~`rgba(10,10,15,.55)`,
modal `rgba(22,21,32,.94)`, player `rgba(12,12,18,.60)`.

## 3. Type

Editorial voice: `.text-display` = clamp(2.1rem → 3.3rem), weight 800, tracking −0.035em,
line-height 1.02. Body stack: system (SF/Roboto). Mono for model names/codes.
TV: root font-size 112.5%; ≥1880px fine-pointer desktops: 106.25%.

## 4. Geometry & elevation

Radius: sm 8 · md 18 · lg 26 · xl 34 · pill 999. Shadows: soft `0 12px 40px rgba(0,0,0,.18)`;
glow `0 0 44px rgb(--art/.35)`; accent glow `0 0 28px −6px rgb(--art/.4)`.

## 5. Motion

`--ease-calm: cubic-bezier(0.32, 0.72, 0, 1)`; fast 180ms. Micro-interactions: cards press to
scale .976; dock items to .94 with bloom-in 260ms; hover-reveal rise 3px/180ms (fine
pointers only). All motion behind `prefers-reduced-motion` + in-app Reduce Motion.

## 6. Adaptation classes (capability, not width)

`html.pointer-coarse|pointer-fine`, `html.device-phone|tablet|desktop|tv` — set at boot and
on change. Rules: hover-reveal visible on coarse; range inputs ≥28px tall on coarse;
TV focus ring 3px ember. Width breakpoints (`md:` etc.) remain for layout only.

## 7. Core components (token consumers)

`glass-card/panel/navbar/sidebar/input` · `btn-primary` (gradient, white glyphs) ·
`btn-secondary` (nowrap pills) · floating dock (`vx-dock-*`) · mini-player (`np-mini`, art
halo) · IconButton (44px touch) · MediaCard (hover-reveal) · Seekbar · SyncedLyrics
(karaoke `--kfill`) · PageHeader (`text-display`).

**Approval:** adopted as-is (already shipped in v16.76–16.78). Phase 3 may only consolidate
the shadowed legacy layers beneath it — values above are frozen unless the owner re-opens.
