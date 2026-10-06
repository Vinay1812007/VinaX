# Design system — "Marigold" (10.0) and frosted glass (10.1)

This document covers how the listener app looks and behaves at the component level: where the tokens live, the colour, type and radius scales, the medium control scale and the 44px hit-area rule, how overlays are built and why they carry `data-vx-overlay`, the motion rules, and the top bar's actions slot. 10.0 "Marigold" is a new identity on the frame 9.0 "Encore" built: new token values, a display face, a recoloured mark, and a first visit that says plainly what VinaX costs (nothing). 10.1 adds a frosted material scale for the chrome and overlays, a drifting artwork backdrop on Now Playing, snackbars and the notifications inbox. The owner console has its own standalone stylesheet and is covered in [admin-console.md](admin-console.md).

## 10.0 "Marigold"

Marigold is warm where Encore was cool: the colour of marigold garlands and of a lamp at dusk, over a plum-black night. It exists to make one thing obvious at a glance — VinaX is free, with no sign-up — and to feel like music from home.

- **Colour.** The ink ramp is plum-black with cream text: `ink-950` `13 9 15` is the chrome (sidebar, player deck, tab bar), `ink-900` `19 14 22` the workspace, `ink-850` / `ink-800` the raised tiers, `ink-100` `251 245 236` the text. The light theme is warm cream paper (`ink-950` `255 252 247`, `ink-900` `250 245 237`) with plum text. **Marigold** (`--ember-*`, default `255 164 46`) is for play, the active destination, progress, focus and primary calls to action; labels on it use `--vx-on-accent` (`#1a0e06`, a deep brown, in dark; white on the darker light-theme ramp). **Rose** (`--tide-*`, default `255 99 132`) marks live and AI moments. The one brand gradient is Marigold → Rose (`--vx-glow`): the avatar, Liked songs, the AI shortcut glyph, the word "Free." in the welcome, the deck's top hairline. Token values live in `index.css` and are asserted by `theme.test.ts` and `contrast.test.ts`.
- **Type.** Two families. **Bricolage Grotesque** (`--vx-font-display`, Tailwind `font-display`; SIL OFL, self-hosted at `/fonts/bricolage-var.woff2`, fetched only when a display-styled element renders) for page titles (`.vx-page-header h1`, `.vx-page-title`), display type (`.vx-display`, `.text-display`), section titles (`.vx-section-header h2`, Home's `.vxh-head h2`), the sidebar wordmark, the top bar's page name, the Home greeting and welcome headline, and the onboarding sheet's titles. The same face also sets Home's feature tiles, listening guide and "Free, and how it stays free" title, the Queue and Drive mode titles, the lyrics hero, the Listen Together title and song name, the browse lanes' headings, and VinaX AI's empty-state greeting. **Manrope** for everything else: body copy, labels, buttons, metadata. Display sizes run at 750–800 with tight tracking (−0.03em to −0.045em).
- **Shape.** Unchanged from Encore: pills for actions, filters and now the active destination; squircles for play buttons (`.vx-play-fab` 56px / radius 18, the deck's play button 44px / radius 15) and artwork; circles for people. The Home welcome panel is radius 28 (24 on phones), feature tiles 18, the free card 24.
- **The frame.** The sidebar's wordmark is set in the display face beside a small "Free" tag (hidden on the rail). The active destination is a solid Marigold pill with a deep-brown label and a soft Marigold shadow; hovers in the chrome are a breath of Marigold (`--vx-hover-warm`, 10% / 8% in light) rather than grey. The phone tab bar's active icon sits in a solid Marigold pill under a cream label. The floating deck is plum chrome with a Marigold → Rose hairline on its top edge and a Marigold play squircle; the compact phone player's play button is Marigold too. The workspace carries a gradient mesh at its top: Marigold from the top left, Rose from the top right, the playing artwork's glow between them, painted with the content (`background-attachment: local`), so it scrolls away and costs nothing on scroll. 10.0 kept blur light (12–16px) and only on surfaces that were already nearly opaque; 10.1 replaced that with the frosted material scale ([below](#101-frosted-glass-materials-and-snackbars)), still only on fixed or sticky chrome and overlays.
- **First visit.** Before anything has been played on a device, Home opens with the welcome (`features/home/HomeWelcome.tsx`): a "Free forever" tag, the headline "All the music you love. Free." in the display face (preceded, inside the same heading, by "Welcome, <first name>." when the listener gave a name), one line on languages and what is not asked for (no subscription, no email, no password), "Start listening" (plays the opening mix the page already holds; no extra request) and "Pick your languages". The Aura Mix sits beside it, and "Everything included, all free" follows: six tiles to VinaX AI, AI Radio, Listen Together, synced lyrics (Karaoke), offline downloads on Android and the language pages. Returning listeners get the short greeting and their shelves. Home ends with "Free, and how it stays free": four plain facts, each true today (no subscription or in-app purchase; no sign-up; one labelled ad on the website's content pages only; listening data stays on the device).
- **Onboarding.** The welcome sheet leads with "Free. No sign-up." over a plum header lit by the Marigold → Rose mesh, the language names set in staggered rows behind the mark in their own scripts (static, decorative), and a "Free forever" tag. Its tour slides use the display face, and the step dots are Marigold.
- **Motion.** 140–240ms on `--ease-calm`. Feature tiles and the welcome's call to action rise 1–2px on hover; the sidebar mark tilts a few degrees. No bounce and no animated gradients. A few deliberate slow loops exist, each opacity and transform only: VinaX AI's thinking motion (10.0: the reply mark breathes over 2.4 s, the "Thinking" label shimmers, a caret blinks where text arrives — see [ai.md](ai.md#the-chat-page)), and Now Playing's drifting artwork backdrop (10.1, below). Nothing moves under either reduced-motion switch.
- **Accents.** The picker's default is **Marigold** (stored id `crimson`, which has no CSS block and rides the `:root` ramp). The older orange ramp (`ember`) is labelled **Copper** and re-coloured (`214 120 78`) so it no longer reads as a second Marigold; a saved choice is kept because ids never change (`constants/accents.ts`).
- **Contrast.** Every pairing above clears WCAG AA: deep brown on Marigold is 9.6:1, cream on the plum workspace is AAA, and the letter-avatar hues (marigold, rose, gold, coral, orchid) each clear 5.7:1 on their plum tile.

## 10.1 frosted glass: materials and snackbars

10.1 makes the chrome and the overlays frosted glass, in a fixed scale of four materials, so that a translucent surface always means the same thing and always stays readable.

### The material scale

Tokens in `:root` of `index.css`; the utilities `.vx-mat-thin`, `.vx-mat-regular`, `.vx-mat-chrome` and `.vx-mat-thick` put each recipe together: a translucent fill, a backdrop blur, a saturation lift, a 1px specular line on the top edge and a hairline.

| Material | Fill (dark) | Blur (desktop; phones lighter) | Used for |
| --- | --- | --- | --- |
| `thin` | `ink-950` at 62% of the glass level | 12px + up to 30px | Large quiet panes over a calm canvas: the sidebar, over a canvas tinted by the playing artwork |
| `regular` | `ink-850`, 50–92% | 16px + up to 34px | Floating controls over moving content. Defined, but no component takes the class yet: Now Playing's buttons borrow only its specular line and hairline (below) |
| `chrome` | `ink-950`, 80–97% | 18px + up to 36px | Fixed and sticky bars content scrolls under: the top bar (once something is under it), the phone tab bar, the compact player and the player deck. Each carries the playing artwork's colour faintly (`--mat-tint`, 10% of `--art`, 8% in light) |
| `thick` | `ink-850`, 86–98% | 24px + up to 40px | Anything that carries a block of text: sheets and dialogs (`<Sheet>`), the song menu, the right-click popover, snackbars |

- **Both Settings dials drive them.** Glass effect sets `--glass-alpha`, which the fills follow; Background blur sets `--glass-blur-boost`, which the blur follows. The fills are **floored** (`clamp`) on the tiers that carry text, so muted text on the chrome and body text on menus and snackbars keep WCAG AA even over a white cover in dark and a black cover in light (`src/__tests__/glass.test.ts`).
- **Light theme.** The fills are white glass (`255 253 250`) with a plum hairline and a strong specular line.
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

## 9.0 "Encore" (the frame Marigold builds on)

Encore was the 9.0 identity: violet and cyan over deep charcoal. Its token values were replaced in 10.0; its structure — the frame, the shapes, the hierarchy rules below — still holds. Where a line below names Iris or Lagoon, read Marigold and Rose.

- **Colour.** Surfaces are charcoal tiers with a cool undertone: `ink-950` chrome (sidebar, player deck, tab bar), `ink-900` workspace, `ink-850` / `ink-800` raised. **Iris** (`--ember-*`, default `140 120 255`) is for play buttons, progress, the active destination, chosen filters and focus. **Lagoon** (`--tide-*`, default `34 211 238`) marks live and AI moments and secondary links. The one gradient is Iris → Lagoon (`--vx-glow`, `--gradient-aurora`), used sparingly: the avatar, Liked songs, AI accents. The playing artwork tints the top of the workspace and the left edge of the player deck through `--art`, at low alpha.
- **Shape.** Pills for actions and filters (`.btn-primary`, outline `.btn-secondary`, `Chip`), squircles for play buttons and artwork (`.vx-play-fab` 56px / radius 18, `.vx-play-fab.is-lg` 64px, the card play button 46px / radius 15, artwork radius 16 on cards and 10–12 in rows), circles for people. Radii: `--vx-radius-control` 10px, `--vx-radius-card` 14px, `--vx-radius-panel` 20px; sheets 24px at the top, dialogs 22px.
- **Type.** Manrope only. Display `clamp(2.25rem, 4vw, 3.75rem)` at 800, page titles `clamp(1.875rem, 3vw, 2.625rem)`, section titles 1.375rem at 780, cards 14px at 650, meta 13px at 500. Sentence case. No letter-spaced uppercase eyebrows.
- **Hierarchy.** Artwork leads and copy follows; size and weight make the hierarchy, not boxes. A section has a title, at most one line of explanation, and at most a "Show all" pill link. Hairlines only between rows and around inputs.
- **Space.** 8px grid. `--vx-gutter` 32 / 16px, `--vx-shelf-gap` 44 / 36px, `--vx-card-gap` 18 / 12px (desktop / phone).
- **Motion.** 140–220ms on `--ease-calm`; cards lift 3px on hover and their play button rises in. Every transition and animation stops under `prefers-reduced-motion` and the in-app "Reduce motion" setting (`html.reduce-motion`); scripted scrolls ask `utils/motion.ts`.
- **States.** Hover `--vx-hover` (6% of the text colour), pressed `--vx-pressed` (10%), selected `--vx-accent-wash` (14% Iris). The playing track row has an Iris bar on its leading edge and an Iris title. Focus is a 2px `--vx-focus` outline, 3px offset.

### The frame

| Width | Frame |
| --- | --- |
| Phone (< 768px) | Top bar (mark, page name once scrolled, page actions, avatar); the page; the compact player floating above the five-tab bar (the active tab's icon sits in an Iris pill). Safe-area insets are applied once, on the fixed bottom wrapper |
| Tablet (768–1099px) | The sidebar is always the 80px rail; the compact player floats at the bottom |
| Desktop (≥ 1100px) | Sidebar (264px, or the 80px rail when the listener collapses it): destinations, then the library in its own rounded panel ("Your collections", "Playlists & saved"). The workspace is a rounded sheet inside the chrome. From 1024px the player is the floating three-zone deck; from 1280px the Now Playing panel sits beside the workspace while something plays |

### Where the styles live

| File | What it owns |
| --- | --- |
| `styles/index.css` | Every token (`:root`), the light / black / accent overrides, the glass and button primitives, the reduced-motion kill switch |
| `styles/shell.css` | The frame and the shared primitives: workspace canvas, sidebar and library list (`.vx-lib-*`), top bar, phone tab bar (`.vx-dock`, `.vx-dock-pill`), the player deck (`.vx-deck`, `.vx-pb-*`) and compact player (`.np-mini`), page and section headers, rails and grids, `.vx-play-fab`, chips, `.vx-tap`, focus and motion switches. Replaces 8.0's `stage.css` and the shell half of `flow.css` |
| `styles/features.css` | Global feature surfaces without a page stylesheet of their own (Home Studio, the listening guide, the destination grid). A feature that gets its own page stylesheet takes its rules with it (the entity heroes went to `pages/library.css`, the AI pieces to `ai.css` and `pages/radio.css`, the player's surfaces and the queue's ownership marker to `pages/player.css`, the language grid to `pages/browse.css`) |
| `styles/pages/tracklist.css` | Track rows, the track-list header and media cards — the only place they are styled. Imported by `SongRow` and `MediaCard` |
| `styles/overlays.css` | Sheets, dialogs, menus and the welcome sheet. Imported by `Sheet`, `TrackMenu` and `OnboardingSheet`, not by `main.tsx` |
| `styles/pages/*.css` | One stylesheet per area (`home`, `browse`, `library`, `player`, `radio`, `settings`, `secondary`, and 10.0's `together`, which the Listen Together page and the Live pill share), each imported by its page or component, so it ships in that lazy chunk and never in the first load |

Page stylesheets scope their rules under the page's root class (`.vx-home`, `.vx-browse`, …) so two lazy chunks loaded in one session cannot restyle each other; `browse.css`'s shared pieces are the `bx-*` family (the browse tiles — chart covers fanned, language scripts, mood emoji — the hub covers and the pinned search field).
| `styles/ai.css` | VinaX AI, which renders outside the main shell |

Shell components: `Sidebar`, `TopBar`, `BottomNav`, `PlayerBar` (compact player on phones and tablets, the deck from 1024px), `NowPlayingRail`, and `EntityHeader` (artwork-coloured header with type label, display title, meta line and the action row, shared by album, playlist, collection and library-list pages). Icons have a 1.8 stroke; `HomeIcon`, `CompassIcon`, `SearchIcon`, `LibraryIcon` and `SparkleIcon` take `filled` for the active destination.

## Where things live

| File | What it owns |
| --- | --- |
| `frontend/src/styles/index.css` | Every token (`:root`), the light / black / accent overrides, the glass and button primitives, the reduced-motion kill switch |
| `frontend/src/styles/shell.css` | The frame and shared primitives (see the table above). It defines no theme tokens, with one exception: it re-computes `--vx-topbar-h` for phones |
| `frontend/src/styles/festivals.css` | The festival themes. (8.0 removed `discovery.css`; Search and Discover styles live in `styles/pages/browse.css`) |
| `frontend/tailwind.config.ts` | Maps the tokens to utility classes (`bg-ink-900`, `text-ember-400`, `text-page-title`, `rounded-card`, `min-h-touch`) |
| `frontend/src/components/*` | The primitives: `Button`, `IconButton`, `Chip`, `Sheet`, `TopBar`, `PageHeader`, `SectionHeader`, `Shelf`, `MediaCard`, `SongRow`, `TrackMenu`, `Skeletons`, `States`, `Toasts` |

Rules of the cascade:

- Tokens are defined once, in `:root` of `index.css`. Themes swap values; components read tokens and never redefine them.
- `tailwind.config.ts` declares each theme key exactly once. A duplicate key silently discards the earlier one, and the file is outside the type-checker's include, so `npm run lint` (`no-dupe-keys`) is its only gate.
- Token values are asserted by `frontend/src/utils/theme.test.ts` and `frontend/src/__tests__/contrast.test.ts`. Change a value and those tests must change with it.

## Themes

`frontend/src/utils/theme.ts` resolves the listener's preference to one of three painted themes and sets classes on `<html>`.

| Preference | Resolves to | Classes on `<html>` |
| --- | --- | --- |
| `dark` | dark | `dark` |
| `light` | light | `light` |
| `amoled` | black | `dark amoled` |
| `system` | follows the OS colour scheme | as above |
| `auto` | light from 07:00 to 18:59, dark otherwise | as above |

An inline pre-paint script in `frontend/index.html` applies the same classes before first paint; it mirrors `applyThemeClasses()` and the two must stay in sync. The black theme overrides only the deepest surface tiers.

Two more attributes are set on `<html>` by `AppLayout`: `data-accent` (one of `ember` — labelled Copper since 10.0 — `ocean`, `violet`, `rose`, `emerald`, `sunset`, `aurora`, `mono`, `gold`, `azure`; the default, `crimson`, labelled Marigold, has no block and uses the `:root` ramp) and `data-density` (`compact` tightens track rows and shelf spacing). Every accent has a dark block and a light twin; the contrast test fails if one is missing.

## Colour

Raw ramps are stored as space-separated RGB triplets so Tailwind can apply alpha (`rgb(var(--ink-900) / 0.8)`).

| Ramp | Steps | Use |
| --- | --- | --- |
| `--ink-*` | 950, 900, 850, 800, 700 | Canvases and cards |
| | 600, 500 | Dividers, disabled, decorative icons |
| | 400, 300 | Muted and secondary text. 400 is the floor for meaningful copy |
| | 200, 100 | Body and primary text |
| `--ember-*` | 600, 500, 400, 300 | The accent, "Marigold": play, progress, focus, the active destination, primary calls to action, chosen filters. 400 is the accent text tier. Default `255 164 46` |
| `--tide-*` | 500, 400 | "Rose", the support colour: live and AI moments, the Marigold → Rose gradient. Default `255 99 132` |

In the light theme the ink ramp inverts and every accent ramp re-pitches darker so accent text stays readable on a light canvas.

Components use the semantic layer on top of the ramps:

| Token | Dark value |
| --- | --- |
| `--vx-bg-base` | `ink-950` — shell, sidebar, player bar |
| `--vx-bg-elevated` | `ink-900` — the workspace and the top bar |
| `--vx-bg-hover` | `ink-800` |
| `--vx-surface` / `--vx-surface-raised` | `ink-900` / `ink-850` |
| `--vx-border` | `--glass-border` (a 6% white hairline in dark, an 8% dark hairline in light) |
| `--vx-text-primary` / `-secondary` / `-muted` | `ink-100` / `ink-300` / `ink-400` |
| `--vx-accent` / `--vx-accent-hover` | `ember-500` / `ember-400` |
| `--vx-on-accent` | `#1a0e06` (deep brown) in dark, `#fff` in light |
| `--vx-focus` | `ember-400` |
| `--vx-danger` / `--vx-success` | `#fda4af` / `#86efac` in dark; `#be123c` / `#166534` in light |
| `--vx-art-accent` | `--art`, the colour extracted from the playing artwork |

Hairlines use `border-glass` or `border-glass-strong`, never a white-alpha border: white alpha disappears on light surfaces.

## Type

Two families since 10.0: Manrope variable for body and interface text (self-hosted at `/fonts/manrope-var.woff2`, weights 200–800), and Bricolage Grotesque variable for display type (`--vx-font-display`, `font-display`; `/fonts/bricolage-var.woff2`, weights 200–800, SIL OFL). See 10.0 "Marigold" above for where the display face is used.

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
- Radii: `--vx-radius-control` 10px (inputs, tiles), `--vx-radius-card` 14px (cards), `--vx-radius-panel` 20px (heroes, panels, the workspace sheet); actions and filters are pills, play buttons and artwork squircles (see 9.0 Encore above). Tailwind adds `rounded-card` (0.75rem), `rounded-sheet` (1.25rem), `rounded-2xl` (0.875rem), `rounded-3xl` (1rem) and `rounded-pill`. Artist artwork is a circle.
- Elevation is mostly flat: `shell.css` removes shadows from glass cards and panels; separation comes from surface tiers and hairlines. The floating player deck and artwork carry a soft shadow (`--vx-deck-shadow`, `--vx-art-shadow`). Overlays use `--vx-shadow-overlay`. Tailwind's `shadow-card`, `shadow-float` and `shadow-lift` are contact shadows only.

## The medium control scale

These four tokens describe what a control looks like. They were introduced in 7.0.1 so every surface uses the same sizes.

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
- `Chip` is 36px tall with an `::after` pad that extends the hit box 4px above and below (44px). 7.0.1 shipped the smaller chip without the pad; 7.1 adds it, and `components/Chip.test.tsx` asserts it.
- On coarse pointers (`html.pointer-coarse`, set in `main.tsx`) range inputs get a 44px min-height, and hover-only affordances (`.card-play`, `.hover-reveal`) are always visible.

## Focus and states

- `:focus-visible` draws a 2px `--vx-focus` outline with a 4px offset, in both themes.
- Buttons: hover brightens, active scales to 0.98, disabled is 45% opacity with no transform. `.btn-premium` is an alias of `.btn-primary`.
- Loading uses the `Skeletons` components; empty and error states use `States` (`EmptyState`, `ErrorState` with retry).
- The current track row is tinted with `ember-500` at 8%. Toggles announce state through `aria-pressed`, not colour alone.

## Overlays

`<Sheet>` (`frontend/src/components/Sheet.tsx`) is the one overlay shell: a bottom sheet on phones, a centred dialog from the `sm` breakpoint up. Since 10.1 its panel is the `thick` frosted material (see above).

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
- Marigold, like Encore before it, is quiet by design: no bounce, no pulsing glow; cards lift 3px on hover and their play button rises in. Shell and Home transitions run 140–240ms.
- Two switches silence motion: the OS `prefers-reduced-motion` setting and the in-app "Reduce motion" setting, which sets `html.reduce-motion`. `index.css` collapses every animation and transition under that class; `shell.css` does the same for `.vx-shell` and `.ai-root` under either switch. Marquee text falls back to an ellipsis.
- CSS cannot stop a scripted scroll. Every scripted scroll asks `frontend/src/utils/motion.ts` first: `reducedMotion()` is true for either switch, and `scrollBehavior()` returns `'auto'` or `'smooth'` accordingly. Pass `behavior: scrollBehavior()` to `scrollIntoView`, `scrollTo` and `scrollBy`; never hard-code `'smooth'`. The shelf arrows, synced lyrics, the tutorial runner and the VinaX AI thread already do.
- `prefers-reduced-transparency` replaces glass surfaces, the 10.1 materials included, with solid ones.
- 10.1's moving parts follow the same switches: Now Playing's drifting backdrop and the snackbars' entry and exit stop under either one.

## Top bar and the actions slot

`frontend/src/components/TopBar.tsx` renders the sticky bar at the top of the workspace. It has two groups and no search box: Search is a primary destination with its own field, and the command palette is one key away.

| Left — where you are | Right — what you can do |
| --- | --- |
| Back and forward buttons (from `md` up); the app icon linking Home (phones) | The page's own actions (the slot) |
| The context label: the matching `PRIMARY_NAV` label, or "Your music" on other routes | The command-palette key (from `lg` up) |
| | The settings link ("Your space" label from `2xl` up) |

A page adds actions to the bar with `<TopBarActions>` instead of rendering a button row of its own:

```tsx
import { TopBarActions } from '@/components/TopBar';

<TopBarActions>
  <IconButton label="Toggle theme" onClick={toggle}>…</IconButton>
</TopBarActions>
```

`TopBarActions` portals its children into the bar's `#vx-topbar-actions` element (a `display: contents` wrapper inside `.vx-topbar-actions`). It resolves the slot in a layout effect and renders nothing until the slot exists, so it is safe on first mount. Actions unmount with the page. Home uses it for the theme toggle and notifications. Keep slot content to `IconButton`s so the bar stays one row on phones.

## Hard rules

1. No raw hex values in components. The standing exceptions are canvas share cards and chart palettes.
2. No white-alpha borders or text; use the ink ramp and the glass hairlines.
3. No arbitrary radii; use the three radius tokens or the Tailwind names above.
4. Icon-only controls use `IconButton`. Touch targets are at least 44px.
5. New overlays use `<Sheet>`. A custom portal marks its root with `data-vx-overlay`.
6. Scripted scrolling uses `scrollBehavior()`.
7. Anything sticky under the top bar reads `--vx-topbar-h`.
8. A theme-affecting change keeps `theme.test.ts` and `contrast.test.ts` green. See [testing.md](testing.md).
