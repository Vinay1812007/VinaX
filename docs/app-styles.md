# App styles — the 15.0 set

Six app styles ship in 15.0. Each is modelled on the design language of one kind of music app a listener already knows — its canvas, its type scale, its shapes, how its tab bar, mini player and full-screen player are laid out — so the whole of VinaX can feel like the app the listener is used to. Every name, colour and letterform is VinaX's own; no style carries another product's name, logo or wordmark, and `frontend/src/constants/templates.test.ts` asserts that the picker copy names no other product. This page is the design contract the six stylesheets follow; [design-system.md](design-system.md) has the mechanics (tokens, dials, the festival and accent rules) and [the user guide](user-guide/app-styles.md) the listener's view.

## Ids, names and what each replaces

| Id | Name | Language | Replaces (11.0–14.x id) |
|---|---|---|---|
| `lumen` | Lumen (default) | Clean white-and-black editorial: frosted bars, big section titles with a chevron, 8px artwork, a floating frosted mini player, a crimson-pink accent | `aura` |
| `verdant` | Verdant | Neutral black, flat panels, a green accent, 2-column "jump back in" tiles, 4px artwork, a tinted mini player floating over a fading tab bar | `pulse` |
| `monsoon` | Monsoon | Charcoal and teal with a saffron second colour, language chips, 6px tiles, a solid five-tab bar, an edge-to-edge mini player with a heart | `sangam` |
| `harbour` | Harbour | Deep navy with a cyan accent, tall hero banners, square corners, condensed-bold titles, a solid player bar with progress on its top edge | `nocturne` |
| `verse` | Verse | Lyrics-first: charcoal under full-bleed artwork, a coral accent, a lyric line in the hero, capsule chips, a floating capsule player, springy motion | `vibe` |
| `onyx` | Onyx | True black, white play, a red accent, a row of mood chips at the top of Home, overline + title section heads with a "More" pill, square 4px artwork, uppercase player tabs | `marquee` |

Old ids stored in settings (`vinax.settings.v1`) or in a backup map to the replacement row above in `normalizeTemplate` (`frontend/src/utils/theme.ts`), so a listener who chose Pulse opens 15.0 in Verdant, not in the default.

## The faces

Body copy stays Manrope in every style. Each style has its own display face; all are variable woff2, latin subset, SIL OFL, self-hosted in `frontend/public/fonts/` with the licence beside the file. 15.0 adds Inter, Figtree and Roboto and retires Eczar and Big Shoulders Display.

| Style | Display face | File | Why |
|---|---|---|---|
| Lumen | Inter | `inter-var.woff2` | The neutral, tightly-tracked grotesk editorial apps set their titles in |
| Verdant | Figtree | `figtree-var.woff2` | A geometric sans with round bowls — bold titles that read at a glance |
| Monsoon | Manrope | `manrope-var.woff2` | The house face, plain and friendly, at 700 |
| Harbour | Archivo | `archivo-var.woff2` | A compact grotesk that carries a bold, slightly condensed title |
| Verse | Baloo 2 | `baloo2-var.woff2` | Rounded and heavy, for lyric lines and oversized titles |
| Onyx | Roboto | `roboto-var.woff2` | The plain Android face, set at 700 with natural tracking |

## Per-style specification

Each row is the value a stylesheet sets. "Hooks" are the shell classes the rule targets (see design-system.md § Shared layer for the full list).

### Lumen

- **Canvas.** Dark: `#000000` shell, `#0f0f11` workspace. Light: `#ffffff` with `#f5f5f7` groups. Accent crimson-pink `#f2334d` (light: `#d1203a`), second colour `#ff7a3d`. On-accent white.
- **Shape.** Art 8px / rows 6px; controls 999px; play 50%; tiles 12px; deck 16px; mini 14px; Now Playing art 10px.
- **Type.** Inter; page title `clamp(2rem, 3.6vw, 2.75rem)` 800 at -0.03em; section 22px 700 at -0.02em; card title 500.
- **Chrome.** Frosted (keeps the materials); the sidebar's active row is a tinted wash in the accent.
- **Home.** Hero: a plain title block on the canvas, no pane, the artwork as a 8px square at the right on phones. Jump back in: hairline list rows, 56px art, no fills. Section heads: title then a `›` chevron drawn with `::after`, the "See all" link hidden under it.
- **Tab bar.** Frosted, 5 items, no pill; the active icon and label in the accent.
- **Mini player.** A floating frosted pane 8px above the tab bar, 14px radius, art 40px left, play + skip right, no progress line.
- **Now Playing.** The artwork large with a soft shadow, blurred artwork behind, a white round play, grey scrubber.
- **Motion.** `tplRise` 240ms; press 0.97.

### Verdant

- **Canvas.** Dark: `#000000` shell, `#121212` workspace, `#181818` raised, `#282828` hover. Light: `#ffffff` / `#f6f6f6`. Accent green `#22d36a` (light `#117a3e`), second `#509bf5`. On-accent `#07140b`.
- **Shape.** Art 4px / rows 4px; controls 999px; play 50%; tiles 4px; deck 0; mini 6px; NP art 8px.
- **Type.** Figtree; page title `clamp(1.75rem, 3.4vw, 3rem)` 800 at -0.03em; section 20px 700; card title 700, subtitle muted 13px.
- **Chrome.** Flat, opaque materials, no blur. Sidebar as a rounded 8px panel with the library below it in its own panel.
- **Home.** A row of filter chips (All · Music · Moods) at the top drawn from `.vxh-chips` with a solid white "on" chip. Jump back in: a 2-column grid of 56px tiles, `rgb(255 255 255 / 0.1)` fill, 4px radius, art flush left with no gap. Hero: a compact band washed in the artwork colour.
- **Tab bar.** Transparent over a gradient to black; plain icons; the active icon white, the label 10px.
- **Mini player.** Floating 8px above the tab bar, 6px radius, filled with the artwork's colour mixed into the raised surface, a 2px progress line along its bottom, play is a plain white glyph.
- **Now Playing.** A vertical gradient from the artwork's colour to the canvas; art 8px with a shadow; the play a white circle 64px; scrubber white with a round thumb.
- **Motion.** `tplFade` 160ms; press 0.95.

### Monsoon

- **Canvas.** Dark: `#111315` shell, `#1b1e21` workspace, `#262a2e` raised. Light: `#ffffff` / `#f4f6f6`. Accent teal `#2cc6a8` (light `#0f7d68`), second saffron `#ff9f1c`. On-accent `#06211b`.
- **Shape.** Art 6px / rows 8px; controls 999px; play 50%; tiles 8px; deck 12px; mini 0 (edge to edge); NP art 12px.
- **Type.** Manrope 700; page title `clamp(1.75rem, 3.2vw, 2.5rem)` at -0.02em; section 18px 700; card title 600.
- **Chrome.** Mostly solid; thin blur only on the top bar. The workspace opens on a teal-to-canvas gradient band 240px tall.
- **Home.** A language chip row under the greeting (`.vxh-chips`): outlined, the chosen one filled teal. Hero: a wide banner, 8px radius, title bottom-left over a scrim. Jump back in: 2 columns of 8px tiles with a faint teal wash.
- **Tab bar.** Solid, 5 items, filled icon in teal, 11px label.
- **Mini player.** Edge to edge above the tab bar, 64px tall, art 48px left, title + artist, a heart (`.np-mini-fav`, when present) and play right, a 2px saffron progress at the bottom.
- **Now Playing.** Artwork wash gradient; 12px art; teal play 64px; chips for Lyrics / Queue.
- **Motion.** `tplRise` 220ms; press 0.96.

### Harbour

- **Canvas.** Dark: `#060b10` shell, `#0e1720` workspace, `#17222d` raised. Light: `#ffffff` / `#f2f5f8`. Accent cyan `#25c7d5` (light `#07707a`), second `#4f8df5`. On-accent `#021418`.
- **Shape.** Art 4px / rows 4px; controls 4px; play 50%; tiles 4px; deck 0; mini 0; NP art 4px.
- **Type.** Archivo; page title `clamp(2rem, 4vw, 3.5rem)` 800 at -0.02em, section 20px 800 at -0.01em; card title 600.
- **Chrome.** Flat, opaque, no blur; the sidebar and workspace have no margins.
- **Home.** Hero: a tall 16:9 banner on phones with the title in large caps over a bottom scrim; on desktop the banner spans the content width. Jump back in: 1 column of 72px rows with 4px art, hairlines, a "›" at the right. Section heads with a 2px cyan bar on the left.
- **Tab bar.** Solid with a hairline top; the active icon cyan with a 2px bar beneath.
- **Mini player.** A solid bar across the bottom, progress drawn along its top edge in cyan, white play glyph.
- **Now Playing.** Blurred artwork behind a dark scrim; square art 4px; white play; cyan progress.
- **Motion.** `tplFade` 140ms; press 0.97.

### Verse

- **Canvas.** Dark: `#09090b` shell, `#141418` workspace, `#1f1f26` raised. Light: `#ffffff` / `#f7f6f9`. Accent coral `#ff4d6d` (light `#c41e42`), second `#ffb84d`. On-accent `#1f0509`.
- **Shape.** Art 12px / rows 12px; controls 999px; play 50%; tiles 14px; deck 20px; mini 999px (capsule); NP art 16px.
- **Type.** Baloo 2; page title `clamp(2rem, 4vw, 3.25rem)` 800 at -0.01em; section 20px 800; card title 700.
- **Chrome.** Frosted; the tab bar is a transparent fade over the content.
- **Home.** Hero: full-bleed artwork behind a 20px pane on phones, the description set as a lyric line in the display face (`.vxh-hero-desc`), a coral play. Jump back in: 2 columns of 14px tiles with a soft coral wash. Chips are capsules with a coral "on".
- **Tab bar.** Fades up from the canvas; the active tab is a coral bubble.
- **Mini player.** A floating capsule with 12px margins, art round, coral progress along the bottom inside the capsule.
- **Now Playing.** The artwork full-bleed and blurred behind, the lyric block (`.vx-np-lyrics`) larger, the title in Baloo; a coral play 68px.
- **Motion.** `tplPop` 320ms; press 0.94.

### Onyx

- **Canvas.** Dark: `#000000` shell, `#030303` workspace, `#111111` raised. Light: `#ffffff` / `#f9f9f9`. Accent red `#ff2b3f` (light `#c4111f`); second colour white in dark (`#ffffff` → the play button). On-accent white.
- **Shape.** Art 4px / rows 4px; controls 8px (chips 999px); play 50%; tiles 4px; deck 0; mini 0; NP art 4px.
- **Type.** Roboto; page title `clamp(1.75rem, 3.2vw, 2.5rem)` 700 at -0.01em; section 22px 700 at -0.005em; card title 500; overline 12px 500 uppercase at 0.1em.
- **Chrome.** Opaque black, no blur. The top bar carries a row of mood chips on Home (`.vxh-chips`), outlined `rgb(255 255 255 / 0.1)` fill, the chosen one white.
- **Home.** Section heads: an overline above the title and a "More" outlined pill at the right (the section link). Jump back in: 1 column of 56px rows ("quick picks"), square 4px art, a kebab at the right. Hero hidden on phones in favour of the chip row.
- **Tab bar.** Solid black, 5 items, filled icon white when active, 10px label.
- **Mini player.** A full-width bar, art 40px, title/artist, play and next glyphs, a 2px progress on its top edge in white.
- **Now Playing.** Black; square art large; white round play 64px; the tabs (`.vx-np-tabs`) uppercase with a white underline for the selected one; the artwork's colour only in a faint light at the top.
- **Motion.** `tplFade` 120ms; press 0.97.

## Rules every style keeps

1. Colour blocks carry `:not([class*='fest-'])`; the accent block carries `:is(:not([data-accent]), [data-accent='crimson'])`.
2. Text and accent tiers clear WCAG AA on the canvas and raised surface in both themes (`templates.test.ts`).
3. `--ink-900` equals the canvas in `TEMPLATE_CANVAS` and the pre-paint table in `index.html`.
4. A flat style (Verdant, Harbour, Onyx) sets opaque materials in both themes with the specificity fix from 13.2 (`html.light[data-template='x'], html.light[data-template='x']:not([class*='fest-'])`).
5. True black and high contrast outrank every style (base.css).
6. A style's file styles only its own selector and is imported by `templates/index.css`.
