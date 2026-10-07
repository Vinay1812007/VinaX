# Design system

This document describes how VinaX looks and how that look is built: the token contract every stylesheet reads, the six app styles and the rules they obey, themes, accents, festival skins, the separate styling layer of the VinaX AI chat, and the shared components and rules (materials, control scale, hit areas, overlays, focus, motion). It ends with a checklist for adding an app style.

## How the layers stack

A page is painted by five layers, each allowed to change less than the one before it can undo:

| Layer | Switch on `<html>` | Lives in | May change |
| --- | --- | --- | --- |
| Base tokens and frame | — | `frontend/src/styles/index.css`, `shell.css`, `features.css`, `pages/*.css` | Everything, as defaults |
| App style | `data-template='<id>'` | `frontend/src/styles/templates/` | Token values, the `--tpl-*` dials, shell and card layout rules of its own |
| Theme | `.dark`, `.light`, `.amoled` (with `.dark`), `.hc` | `index.css`, `templates/base.css` | Which ramp a style uses; true black; high contrast |
| Accent | `data-accent='<id>'` or inline custom ramp | `index.css`, `frontend/src/utils/accentRamp.ts` | The ember ramp only |
| Festival skin | `.fest-<id>` | `frontend/src/styles/festivals.css` (generated) | Accent ramp, canvas tint, ribbon, backdrop — never layout |

`main.tsx` imports the global sheets in this order: `index.css`, `shell.css`, `features.css`, `templates/index.css`, `festivals.css`. Page stylesheets ship with their lazy page and therefore load later than all of them.

## The token contract

Components read tokens; they do not state colours. Colour tokens hold space-separated RGB channels so alpha can be applied at the point of use.

| Token | Use | Written as |
| --- | --- | --- |
| `--ink-950`, `900`, `850`, `800`, `700` | Surfaces, darkest to raised. `--ink-900` is the page canvas | `rgb(var(--ink-900))` |
| `--ink-100` … `--ink-500` | Text, strongest to faintest | `rgb(var(--ink-200))` |
| `--ember-300` … `--ember-600` | The accent ramp | `rgb(var(--ember-500))` |
| `--tide-400`, `--tide-500` | The secondary accent | `rgb(var(--tide-400))` |
| `--vx-on-accent` | The label colour on an accent fill | `var(--vx-on-accent)` |
| `--art` | The playing artwork's colour, for washes and backdrops | `rgb(var(--art))` |
| `--vx-radius-control`, `--vx-radius-card`, `--vx-radius-panel`; `--radius-sm` … `--radius-pill` | Radii | `var(…)` |
| `--vx-control-h` and the control scale | Control sizes (see below) | `var(…)` |
| `--ease-calm`, `--vx-ease-out` | Easing | `var(…)` |

The tokens are declared in `index.css` (`--vx-ease-out` in `shell.css`). The ink names keep their meaning in the light theme: `--ink-900` is still the canvas and `--ink-100` still the strongest text, so one rule serves every theme. Tailwind's colour names map to the same variables (`frontend/tailwind.config.ts`).

## App styles

An app style ("template" in the code) is a complete look chosen in Settings → Appearance → App style. Six ship, listed in `frontend/src/constants/templates.ts`: `aura` (the default), `pulse`, `sangam`, `nocturne`, `marquee` and `vibe`. The setting is `template` in `frontend/src/store/settingsStore.ts`; the picker is `frontend/src/features/settings/TemplatePicker.tsx`.

**A style may change** the ink, ember and tide values for dark and light, the body typeface, radii, title weight and tracking, press and entrance motion, how the navigation, mini player, cards and Now Playing backdrop are shaped, and whether the chrome is glass or solid. **A style may not change** what a control does, which settings exist, hit areas, focus visibility, or anything while the listener has asked for true black or high contrast.

### The dials

`frontend/src/styles/templates/base.css` declares the shared dials on `html[data-template]` and wires them to the shell and the shared primitives, so most of a style is a block of values.

| Dials | Control |
| --- | --- |
| `--tpl-r-art`, `--tpl-r-art-sm`, `--tpl-r-np-art` | Artwork corners: cards, rows and the mini player, Now Playing |
| `--tpl-r-control`, `--tpl-r-input`, `--tpl-r-row`, `--tpl-r-tile` | Chips and pills, inputs, track rows, Home tiles and cards |
| `--tpl-r-play`, `--tpl-r-play-sm` | The large play button; play on cards, the deck and the mini player |
| `--tpl-r-deck`, `--tpl-r-mini` | The desktop player deck; the mini player |
| `--tpl-font-body` | The body typeface |
| `--tpl-title-weight`, `--tpl-title-tracking`, `--tpl-section-weight`, `--tpl-section-tracking`, `--tpl-card-title-weight` | Page titles, section headings, card titles |
| `--tpl-press`, `--tpl-enter`, `--tpl-enter-dur` | Press feedback and the page entrance |

`base.css` also re-derives the tokens that follow from the ink scale (glass fills, solid surfaces), so a style states its inks and gets those for free.

### The selector contract

`frontend/src/constants/templates.test.ts` asserts each of these against the stylesheets.

- **A style's file styles only its own selector.** Every rule in `<id>.css` starts from `html[data-template='<id>']`, and the file is imported by `templates/index.css`.
- **Colour blocks carry `:not([class*='fest-'])`.** Token values and canvas paint stand down while a festival skin is on, so festival CSS only has to beat the base theme. Layout, shape, type and motion rules do not carry it and stay.
- **Accent blocks apply only to the default accent** — no `data-accent`, or `crimson`. A listener who picked a named or custom accent keeps it in every style.
- **Win by specificity, never by order.** Page stylesheets load after the style sheets, so a style rule must out-specify the page rule it replaces; `html[data-template='<id>']` in front of the page's own selector does that.
- **True black and high contrast outrank every style.** `base.css` writes them as `html.amoled[data-template]:not(#_)` and `html.hc[data-template]:not(#_)`; the `:not(#_)` adds id-level specificity without matching anything. In the Black theme `--ink-950` is `0 0 0` and the shell is `#000` in all six styles.
- **Every style has a dark and a light look that clear WCAG AA** for text and accent tiers on its canvas and raised surface, and every named accent is contrast-checked in every style and both themes.
- **The pre-paint canvas equals the style's `--ink-900`**, per theme (see the next section).

### From setting to paint

1. The inline script in `frontend/index.html` reads `vinax.settings.v1` before first paint, sets `data-template` (falling back to `aura`), and stamps the canvas colour from its own copy of the canvas table, so there is no flash of another style.
2. `AppLayout.tsx` calls `applyThemeClasses(resolved, root, template)` (`frontend/src/utils/theme.ts`) whenever theme or style changes. It toggles `.light`, `.dark`, `.amoled`, normalises the id with `normalizeTemplate` (unknown ids become `DEFAULT_TEMPLATE`), sets `data-template`, and writes the canvas to `<html>`'s background and the `theme-color` meta from `TEMPLATE_CANVAS` — `#000000` for the Black theme.
3. CSS does the rest. The picker cross-fades with a view transition where the browser supports one and switches at once under reduced motion.

## Themes

The `theme` setting is one of `dark`, `light`, `amoled` (shown as Black), `system` or `auto`. `resolveTheme` turns the last two into a concrete theme: `system` follows the device, `auto` is light from 07:00 to 18:59 and dark otherwise. Black also carries `.dark`, so dark rules apply and only the surfaces change. High contrast is a separate setting that adds `.hc`.

## Accents

- **Style colour** is the first swatch. Its stored id is `crimson`, and it means "whatever the app style's accent is".
- **Named accents** set `data-accent` and replace the ember ramp in every style: `marigold`, `ember`, `sunset`, `gold`, `emerald`, `ocean`, `azure`, `violet`, `rose`, `aurora`, `mono`. The blocks are in `index.css`.
- **Custom accent.** `accent: 'custom'` with a colour in `accentCustom`; `applyCustomAccent` in `utils/accentRamp.ts` builds a ramp for the current theme and writes it inline.
- **Dynamic accent.** With `dynamicTheme` on, the accent follows the playing artwork. `--art` carries the artwork colour whether or not this is on.

## Festival skins

On a festival's days `<html>` gains `fest-<id>` (the window table is inlined in `index.html` so the class is there before first paint). A skin supplies an accent ramp for dark and an AA-safe light one, a tinted canvas, a top ribbon and an ambient backdrop; because style colour blocks stand down, the skin looks the same over all six styles while each style's layout stays. The definitions are in `frontend/src/constants/festivals.ts`, `festivalThemes.ts`, `festivalVisuals.ts` and `festivalEmblems.ts`. Do not edit `festivals.css` by hand: change the definitions and run `npm run gen:festivals` (`frontend/scripts/gen-festivals.mjs`, core in `festivals-gen-core.mjs`), which rewrites `src/styles/festivals.css`, `public/admin/festivals.js` and the table in `index.html`. The backdrop's particles are not rendered under either reduced-motion switch or with Data saver on. Settings → Appearance → Preview a festival applies any skin for the session (`frontend/src/features/festival/festivalPreview.ts`).

## VinaX AI chat styles

The chat has its own, scoped styling layer; the app shell around it keeps the listener's app style. `frontend/src/features/ai/chat/chatStyle.ts` defines nine styles (`CHAT_STYLE_IDS`): `vinax`, `mono`, `spectrum`, `paper`, `loop`, `void`, `forge`, `circuit` and `deep`. Each is an original design mapped to one or more maker families of models; `makerFamily` classifies the selected model and `styleForFamily` picks the style, falling back to `deep`.

- **Scope.** `ChatStyleScope.tsx` puts `data-chat-style='<id>'` on the chat surface (`.ai-root`) and on portalled sheets (`.ai-scope`). `frontend/src/styles/ai-styles.css` matches only those.
- **Colour.** A chat style re-points the ink and accent ramps that `ai.css` already reads, with dark as the base and `html.light` and `html.amoled` blocks for every style. `vinax` has no ramp of its own and reads the app's tokens.
- **Layout.** Each style also has layout facts (`ChatLayout`): composer shape, dock, greeting alignment, starter layout, user and assistant message treatment, avatar, model-chip position, density, engine. `layoutAttrs` emits them as `data-cs-*` attributes and the CSS keys on those, so two styles that share a composer shape share its rules. Shape variables are named `--cs-*`.
- **Preference.** VinaX AI settings → General → Chat style stores `match` (the default), or one fixed style id, under `vinax.ai.chatStyle`. `resolveChatStyle` combines the preference with the selected model.

`chatStyle.test.ts` guards the mapping and the list.

## Adding an app style

1. `frontend/src/utils/theme.ts` — add the id to `TemplateId` and its `[dark, light]` canvas to `TEMPLATE_CANVAS`.
2. `frontend/index.html` — add the same pair to the table in the pre-paint script.
3. `frontend/src/constants/templates.ts` — add the `TemplateOption` entry: `id`, `label`, `tagline` (one line under the name), `traits` (what changes) and `swatch` (`canvas`, `raised`, `accent`, `second`; dark look). `templates.test.ts` asserts the number of styles ("has six styles with unique ids and names") and that no entry names another product, so change the count there too.
4. `frontend/src/styles/templates/<id>.css` — the colour blocks (dark and light, each with `:not([class*='fest-'])`), the accent block limited to the default accent, the dial values, then only the layout rules that are the style's own.
5. `frontend/src/styles/templates/index.css` — import the file.
6. `frontend/src/styles/pages/settings.css` — draw its miniature for the picker (the `.vx-tpl-*` rules).
7. Run `npx vitest run src/constants/templates.test.ts src/utils/theme.test.ts src/features/settings/TemplatePicker.test.tsx src/__tests__/contrast.test.ts`. The failures name what was missed: an unimported file, a colour block without the festival guard, an accent that overrides a chosen one, a canvas that differs from `--ink-900`, a contrast shortfall.
8. Build, then run `node scripts/csp-hashes.mjs`: the inline script changed, so its hash in `public/_headers` must change, and `src/__tests__/cspHashes.test.ts` fails until it does.
9. Look at it: every destination, phone and desktop width, dark, light and Black, a festival preview on, reduced motion on.

## Materials

Translucent chrome and overlays use a fixed scale of four frosted materials, so a translucent surface always means the same thing and stays readable. A style may replace them with solid fills (Pulse and Marquee do); Settings → Glass effect scales them through `--glass-alpha` and `--glass-blur-boost` (`applyGlassLevel` in `utils/theme.ts`).

### The material scale

Tokens in `:root` of `index.css`; the utilities `.vx-mat-thin`, `.vx-mat-regular`, `.vx-mat-chrome` and `.vx-mat-thick` put each recipe together: a translucent fill, a backdrop blur, a saturation lift, a 1px specular line on the top edge and a hairline.

| Material | Fill (dark) | Blur (desktop; phones lighter) | Used for |
| --- | --- | --- | --- |
| `thin` | `ink-950` at 62% of the glass level | 12px + up to 30px | Large quiet panes over a calm canvas: the sidebar, over a canvas tinted by the playing artwork |
| `regular` | `ink-850`, 50–92% | 16px + up to 34px | Floating controls over moving content. Defined, but no component takes the class yet: Now Playing's buttons borrow only its specular line and hairline (below) |
| `chrome` | `ink-950`, 80–97% | 18px + up to 36px | Fixed and sticky bars content scrolls under: the top bar (once something is under it), the phone tab bar, the compact player and the player deck. Each carries the playing artwork's colour faintly (`--mat-tint`, 10% of `--art`, 8% in light) |
| `thick` | `ink-850`, 86–98% | 24px + up to 40px | Anything that carries a block of text: sheets and dialogs (`<Sheet>`), the song menu, the right-click popover, snackbars |

- **Both Settings dials drive them.** Glass effect sets `--glass-alpha`, which the fills follow; Background blur sets `--glass-blur-boost`, which the blur follows. The fills are **floored** (`clamp`) on the tiers that carry text, so muted text on the chrome and body text on menus and snackbars keep WCAG AA even over a white cover in dark and a black cover in light (`src/__tests__/glass.test.ts`).
- **Light theme.** The fills are white glass (`255 253 250`) with a tinted hairline and a strong specular line.
- **Fallbacks.** The Black theme keeps every material solid with no backdrop filter. Where `backdrop-filter` is unsupported, and under `prefers-reduced-transparency`, each material falls back to `--surface-solid`. Phones (`max-width: 767px`) get a lower blur cap so bars stay cheap to composite while a list scrolls under them.
- **The rule.** Never put a material on a row inside a scrolling list: fixed or sticky chrome and overlays only.
- **The top bar** turns to chrome glass only once content is under it. `TopBar` watches a sentinel with an `IntersectionObserver` rooted on the workspace (no scroll listener) and adds `is-scrolled vx-mat-chrome`.
- **Now Playing.** Two heavily blurred copies of the artwork drift slowly behind the stage (26 s and 31 s, alternating, transform only; lighter blur on phones) under a warm wash and a scrim. The round top buttons and the tool row are frosted panes — a translucent fill, the specular line and a hairline — with no backdrop filter of their own, since they already sit on a blurred stage. The drift stops under either reduced-motion switch.

### Snackbars

`components/Toasts.tsx` with `store/toastStore.ts`. `toast(text)` is unchanged; `toast(text, { image, action, duration, key })` adds the rest.

- **Shape.** A compact pill of `thick` glass (one step lighter than the chrome in dark, white glass in light, solid in Black), radius 20, at least 48px tall, at most 480px wide, rising above the tab bar and the compact player on phones and above the deck on computers. An optional 36px artwork thumbnail leads, one line of text follows, and at most **one action** (View, Undo…) sits at the end.
- **Timing.** About 4 s on screen (5 s with an action, or the caller's `duration`). At most **two** at once; a third pushes the oldest out. The same words twice show once.
- **Keyed replacement.** A toast with a `key` replaces the older one with the same key and inherits its artwork and action when it has none. Liking the playing song used to show "Added to Liked songs" and the DJ's "Liked — more like this is coming up next" side by side; both now use the key `like`, so the second updates the first and keeps its cover and View.
- **Interaction.** Hovering or focusing the stack pauses every timer; leaving resumes each with what it had left (at least 1 s). Swipe a snackbar down (36px) or press Esc to dismiss the newest — Esc is left to an open sheet or menu unless focus is in the snackbar. The live region is always in the DOM (`role="status"`, polite) so the first message is announced. Entry and exit motion (220 / 180 ms) stops under either reduced-motion switch.
- **Where they carry artwork and an action.** Liked songs (View, or Undo on removal), Added to queue and Playing next (View → the Queue page). The right-click menu's duplicate queue toasts were removed.

### The notifications inbox

The bell in Home's top bar opens `NotificationSheet`: a `thick` glass sheet whose rows lead with artwork (an announcement's own image, else a music or megaphone glyph), grouped under day headings — Today, Yesterday, then the date — and then a "From VinaX" group with the three newest release notes. On Android it also offers "Mute alerts for 7 days".


## Type

An app style may swap the body face through `--tpl-font-body`; what follows is the base.

Two families: Manrope variable for body and interface text (self-hosted at `/fonts/manrope-var.woff2`, weights 200–800), and Bricolage Grotesque variable for display type (`--vx-font-display`, `font-display`; `/fonts/bricolage-var.woff2`, weights 200–800, SIL OFL). See 10.0 "Marigold" above for where the display face is used.

| Token | Value | Tailwind class | Used for |
| --- | --- | --- | --- |
| `--vx-type-display` | `clamp(2.25rem, 4vw, 3.75rem)` | `text-display` | Entity heroes, the Home hero title |
| `--vx-type-page` | `clamp(1.875rem, 3vw, 2.625rem)` | `text-page-title` | Page `h1` — the same token `PageHeader` renders |
| `--vx-type-section` | `1.375rem` | `text-title` | Section and shelf headings |
| `--vx-type-card` | `.9375rem` | `text-card-title` | Card titles |
| `--vx-type-body` | `.9375rem` | `text-body` | Body copy |
| `--vx-type-meta` | `.8125rem` | `text-meta` | Metadata, secondary rows, the top bar context label |
| `--vx-type-caption` | `.75rem` | `text-caption` | Eyebrows (`.vx-eyebrow`, uppercase spacing `.08em`), captions |

Headings track tight (`-0.035em` for display and page, `-0.025em` for sections) at weight 750. Times and counts use tabular numerals.

## Spacing, radii, elevation

- Spacing: `--vx-space-1` to `--vx-space-16` on a 4px grid (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Tailwind's default spacing scale matches it.
- Radii: `--vx-radius-control` 10px (inputs, tiles), `--vx-radius-card` 14px (cards), `--vx-radius-panel` 20px (heroes, panels, the workspace sheet); actions and filters are pills, play buttons and artwork squircles. Tailwind adds `rounded-card` (0.75rem), `rounded-sheet` (1.25rem), `rounded-2xl` (0.875rem), `rounded-3xl` (1rem) and `rounded-pill`. Artist artwork is a circle.
- Elevation is mostly flat: `shell.css` removes shadows from glass cards and panels; separation comes from surface tiers and hairlines. The floating player deck and artwork carry a soft shadow (`--vx-deck-shadow`, `--vx-art-shadow`). Overlays use `--vx-shadow-overlay`. Tailwind's `shadow-card`, `shadow-float` and `shadow-lift` are contact shadows only.

## The medium control scale

These four tokens describe what a control looks like. They exist so every surface uses the same sizes.

| Token | Value | Read by |
| --- | --- | --- |
| `--vx-control-h` | 40px | `.btn-primary` / `.btn-premium` min-height, the command-palette key in the top bar, `.vx-panel-switch` buttons. `IconButton` size `md` is the same 40px disc |
| `--vx-control-h-sm` | 36px | The small control size. No stylesheet rule reads the token yet; `IconButton` size `sm` and `Chip` render at the same 36px through utility classes |
| `--vx-tile-h` | 48px | Shortcut tiles in the destination grid (`.vx-destinations a`) |
| `--vx-topbar-h` | 64px; on phones `calc(max(8px, env(safe-area-inset-top)) + 48px)` | The sticky top bar's min-height, and everything that sticks beneath it: `MobileBackBar` (`top-[var(--vx-topbar-h)]`) and the sticky Search header in `styles/pages/browse.css` |

Anything that pins itself under the top bar must read `--vx-topbar-h` rather than a number, so it follows the safe-area inset on notched phones.

### Hit-area rule

The rule: the visual box may be 36 or 40px, but the touch target is at least 44px.

- `IconButton` adds an invisible `::after` pad: `-inset-1` for `sm` (36 → 44px) and `-inset-0.5` for `md` (40 → 44px). `lg` is 48px and needs none. Use `IconButton` for every icon-only control; it also requires a `label`, defaults to `type="button"`, and forwards `aria-pressed`, `aria-expanded` and `aria-controls`.
- Rows and links that are their own target set `min-height: 44px` directly: sidebar links, section links, the profile link, Home Studio buttons, player tabs, library inputs. Tailwind exposes this as `min-h-touch` / `min-w-touch`.
- Dock items are 56px tall. The card play button is a 44px disc.
- `Chip` is 36px tall with an `::after` pad that extends the hit box 4px above and below (44px). `components/Chip.test.tsx` asserts the pad.
- On coarse pointers (`html.pointer-coarse`, set in `main.tsx`) range inputs get a 44px min-height, and hover-only affordances (`.card-play`, `.hover-reveal`) are always visible.

## Focus and states

- `:focus-visible` draws a 2px `ember-500` outline with a 2px offset and a soft 5px halo (`ember-500` at 32%) in every theme (`index.css`; the `--vx-focus` token exists but the ring does not read it). Text-like inputs use a quieter border shift instead.
- Buttons: hover brightens, active scales to 0.98, disabled is 45% opacity with no transform. `.btn-premium` is an alias of `.btn-primary`.
- Loading uses the `Skeletons` components; empty and error states use `States` (`EmptyState`, `ErrorState` with retry).
- The current track row is tinted with `ember-500` at 8%. Toggles announce state through `aria-pressed`, not colour alone.

## Overlays

`<Sheet>` (`frontend/src/components/Sheet.tsx`) is the one overlay shell: a bottom sheet on phones, a centred dialog from the `sm` breakpoint up. Its panel is the `thick` frosted material (see above).

| It owns | Detail |
| --- | --- |
| Semantics | `role="dialog"`, `aria-modal="true"`, named by `labelledBy` (preferred) or `label` |
| Focus | `useFocusTrap` traps Tab, handles Escape and returns focus to the opener |
| Back | `useDismissOnBack` closes it on the hardware/browser back action |
| Scroll | A reference-counted body scroll lock, so a confirm stacked over a sheet does not unlock the page when it closes |
| Layout | `size` (`sm`, `md`, `lg`, `2xl`), `padding` (`md`, `lg`), `layout` (`scroll` or `column` for a pinned header/footer), `maxHeight` (`tall` 92dvh, `medium` 85dvh). The bottom edge always clears the home indicator. Do not pass padding, width, height or radius through `className` |
| Stacking | `z` 70 by default; 60 for boot overlays, 80 for the update gate |
| Dismissal | Backdrop click closes unless `closeOnBackdrop={false}`; a sheet that must not close passes an `onClose` that declines |

### Why overlays are portalled

A sheet rendered inside a page sits inside whatever containing block the page creates (an animated wrapper, a transformed card), so `fixed inset-0` stops meaning the viewport. `<Sheet>`, the song menu (`TrackMenu`), the device sheet, the Backup Center and the full-screen player's panels are therefore portalled to `<body>`. For the same reason the `fade-up` animation fills `backwards`, not `both`: a forwards fill would leave a transform on the page and turn it into a containing block.

Portals still bubble events through the component tree, so `<Sheet>` stops click propagation on its backdrop and panel. Without that, a backdrop click also activates the row the sheet was opened from.

### Why overlays carry `data-vx-overlay`

On the web, `AppLayout` runs a wheel rescue (`frontend/src/features/nav/wheelRescue.ts`). Injected page scripts can park an invisible fixed element directly under `<body>`, outside `#root`; a wheel landing on it scrolls nothing and the page looks frozen, so the layout forwards such a wheel to `<main>`.

Once VinaX's own menus and sheets moved to `<body>`, "outside `#root`" no longer meant "an injected blocker". Wheeling over the song menu scrolled the page behind it, which on the player scrolled the trigger away and closed the menu. `shouldRescueWheel()` now walks up to the portal root the event came through and leaves it alone when that root matches, or contains, any of:

```
[role="menu"], [role="dialog"], [role="listbox"], [role="status"], [role="presentation"], [data-vx-overlay]
```

It also skips events an overlay already handled (`defaultPrevented`). The rule for new code: anything portalled to `<body>` either has one of those roles on or inside its root, or sets `data-vx-overlay` on its root element. `<Sheet>`, `TrackMenu` and the player's portalled panel already do. The rescue does not run in the Android app.

## Motion

- One easing, `--ease-calm` (`cubic-bezier(0.32, 0.72, 0, 1)`), and three durations: 140ms (`--vx-motion-fast`), 200ms (`--vx-motion-normal`), 320ms (`--transition-slow`).
- The base motion is quiet by design: no bounce, no pulsing glow; cards lift 3px on hover and their play button rises in. Shell and Home transitions run 140–240ms.
- Two switches silence motion: the OS `prefers-reduced-motion` setting and the in-app "Reduce motion" setting, which sets `html.reduce-motion`. `index.css` collapses every animation and transition under that class; `shell.css` does the same for `.vx-shell` and `.ai-root` under either switch. Marquee text falls back to an ellipsis.
- CSS cannot stop a scripted scroll. Every scripted scroll asks `frontend/src/utils/motion.ts` first: `reducedMotion()` is true for either switch, and `scrollBehavior()` returns `'auto'` or `'smooth'` accordingly. Pass `behavior: scrollBehavior()` to `scrollIntoView`, `scrollTo` and `scrollBy`; never hard-code `'smooth'`. The shelf arrows, synced lyrics, the tutorial runner and the VinaX AI thread already do.
- `prefers-reduced-transparency` replaces glass surfaces with solid ones.
- Moving parts follow the same switches: Now Playing's drifting backdrop and the snackbars' entry and exit stop under either one.

## Top bar and the actions slot

`frontend/src/components/TopBar.tsx` renders the sticky bar at the top of the workspace. It has two groups and no search box: Search is a primary destination with its own field, and the command palette is one key away.

| Left — where you are | Right — what you can do |
| --- | --- |
| Back and forward buttons (from `md` up); the app icon linking Home (phones) | The page's own actions (the slot) |
| The context label: the matching `PRIMARY_NAV` or `NAV_GROUPS` item label, or "VinaX" on other routes | The command-palette key (from `lg` up) |
| | The avatar, a link to Settings labelled "Local profile and settings" |

A page adds actions to the bar with `<TopBarActions>` instead of rendering a button row of its own:

```tsx
import { TopBarActions } from '@/components/TopBar';

<TopBarActions>
  <IconButton label="Toggle theme" onClick={toggle}>…</IconButton>
</TopBarActions>
```

`TopBarActions` portals its children into the bar's `#vx-topbar-actions` element (a `display: contents` wrapper inside `.vx-topbar-actions`). It resolves the slot in a layout effect and renders nothing until the slot exists, so it is safe on first mount. Actions unmount with the page. Home uses it for the theme toggle and notifications. Keep slot content to `IconButton`s so the bar stays one row on phones.

## Hard rules

1. No raw hex values in components. The standing exceptions are canvas share cards, chart palettes and the canvas table that the pre-paint script needs.
2. No white-alpha borders or text; use the ink ramp and the glass hairlines.
3. No arbitrary radii; use the radius tokens, the `--tpl-r-*` dials or the Tailwind names above.
4. Icon-only controls use `IconButton`. Touch targets are at least 44px.
5. New overlays use `<Sheet>`. A custom portal marks its root with `data-vx-overlay`.
6. Scripted scrolling uses `scrollBehavior()`.
7. Anything sticky under the top bar reads `--vx-topbar-h`.
8. Every animation has an answer for both reduced-motion switches: `html.reduce-motion` (the setting) and `@media (prefers-reduced-motion: reduce)`.
9. A change that affects the look keeps `theme.test.ts`, `contrast.test.ts` and `templates.test.ts` green. See [testing.md](testing.md).
