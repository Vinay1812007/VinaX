# VinaX Delta Audit — August 2026 (Phases 1–2)

Scope: per-screen UX/UI, design system, themes, navigation state, accessibility,
and search experience of VinaX v4.0.0. This complements the July functional
audit (recommendations, chatbot, personalization, admin, infra), which is
complete and not re-litigated here.

## A. Project understanding (current state)

VinaX is a free, login-less, privacy-first Indian-music PWA + Android app.
React 19 + TS strict + Vite 8, Tailwind with a token-driven "Living Glass"
design system, Zustand + TanStack Query, Cloudflare Pages Functions backend,
Supabase (service-role only, RLS deny-all), 7 failover AI lanes, Capacitor 8
Android shell. All personalization is on-device (taste profile v1 with QR
handoff between devices). 39 pages, 31 prerendered routes, 160 KB gz
first-load budget, CI gates: lint → typecheck → 283 unit tests → build →
prerender → bundle budget → E2E smoke → Lighthouse → signed APK on tags.

**Premise corrections vs the master prompt:** there is no login/register,
subscription, or server-side user profile — by design, and that invariant
stands. There IS already a 4-way theme system (`dark`/`light`/`amoled`/
`system` via `prefers-color-scheme`, persisted, plus 10 accent themes) —
so the theme work is repair, not construction.

## B. Verdicts by lens

| Lens | Verdict |
| --- | --- |
| Design tokens | Excellent discipline (0 ad-hoc Tailwind palette uses; 20 raw hexes, all legitimate) — but one compiled-CSS bug and radius sprawl |
| Themes | 4 modes ship; light mode is systemically broken (contrast + hairlines + FOUC) |
| Navigation state | **Not preserved.** No scroll restoration anywhere; `key={pathname}` remounts every page; Home feed changes content on back-nav |
| Back button (Android) | Pops the route through open sheets — never closes the overlay |
| ARIA/labels | Strong (91% of icon-only buttons labeled; MediaSession + full keyboard map) |
| Focus management | Weak — 9 of 11 overlays have no trap/restore; worst is the destructive erase-confirm |
| Empty/loading/error | Mixed — Search/Playlist/Album exemplary; Home/Discover shelves fail silently |
| Search | Cached + personalized by language, but zero typo tolerance, no real autocomplete, and two filters that eat legitimate results |
| Touch targets | 130 of 251 buttons under 40 px; worst on destructive queue-row controls |

## C. Prioritized issues

### P0 — Critical (broken behavior users hit daily)

1. **Home feed is destroyed by back-navigation.** `useUnlimitedFeed.ts:41,44`
   puts a per-mount `Math.random()` seed in the TanStack query key. Every
   return to Home = new key = full refetch, all loaded pages discarded, a
   *different* feed, scroll at 0. Intended for reloads; fires on every nav.
2. **Android hardware back ignores open overlays.** `AppLayout.tsx:136-148`
   calls `history.back()` unconditionally. With a TrackMenu/sheet/palette
   open, back pops the route — user loses the page *and* the sheet. No
   overlay participates in history; Escape-only closing (phones have no
   Escape).
3. **No scroll restoration, anywhere.** The scroller is an overflow `<main>`
   div (`AppLayout.tsx:312`) inside `overflow-hidden`, so the browser can't
   restore; `<ScrollRestoration/>` is absent; `key={pathname}`
   (`AppLayout.tsx:318`) remounts every page and collapses height to 0.
   Back-nav always lands at the top. (Prompt §18's exact scenario fails.)
4. **Light theme fails WCAG AA wholesale.** `html.light` remaps `ink` but
   never `--ember-*`/`--tide-*` (`index.css:158-170`). Measured: `ink-400`
   3.83:1 (216 uses), `ember-400` 2.66:1 (87 uses), `tide-400` 1.29:1 —
   effectively invisible — on meaningful content (`MediaCard.tsx:112`
   recommendation reasons, `TasteProfilePage.tsx:174`).
5. **Tailwind config bug silently degrades 93 call sites.** `borderRadius`
   declared twice in one `extend` (`tailwind.config.ts:13` and `:50`); the
   second wins, so `rounded-2xl/3xl` compile to Tailwind defaults, not the
   design system's values. Verified in built CSS. Escapes typecheck (config
   not in `tsconfig.json` include).
6. **Search silently drops legitimate results.** (a) `musicalOnly` junk
   filter is applied to explicit search tabs (`useSearch.ts:16`) despite its
   own contract saying it must not be (`quality.ts:6`) — searching a real
   "(Lyrical)" title returns nothing. (b) `diversify`'s 2-per-album cap runs
   per page, then `getNextPageParam` requires ≥15 survivors
   (`useInfiniteSongs.ts:18-20`) — album/artist searches kill infinite
   scroll after page 1 on the highest-intent queries.

### P1 — High

7. **Dark flash on cold load for light/system users** — `index.html:35`
   hardcodes the dark background; theme class applies only post-hydration.
   Needs an inline pre-paint script.
8. **34 `border-white/5|10` hairlines vanish in light mode** (white-on-white)
   — worst in `VinaXAIPage` (15), `RichContent` (13), `NowPlayingPage`,
   `PlayerBar`. `--glass-border` flips correctly; these bypass it.
9. **Destructive "Erase everything" dialog has no Escape and no focus trap**
   (`SettingsPage.tsx:504`) — Tab walks into the live app behind it.
   Systemically: 9 of 11 overlays lack trap/restore; `OnboardingSheet`
   contains the correct reference implementation to extract into a hook.
10. **Home/Discover shelves have no error state.** 16 `isLoading` guards vs
    2 `isError` on Home; a failed shelf renders `null` — indistinguishable
    from empty, no retry. Fix belongs in the shared `Shelf` component.
11. **Zero typo tolerance / no script normalization in search** — no
    lowercase-canonical cache key (double fetch for case variants), no
    diacritic folding, no transliteration help for an Indian-language
    catalog, no edit-distance fallback (`normalizeQuery`, `useSearch.ts:32`).
12. **Search language filter never resets on query change**
    (`SearchPage.tsx:76-78`) — filter Telugu on query A, type query B, get a
    blank Songs tab with no explanation.
13. **Abandoned search requests never cancelled** — TanStack's `signal` is
    not threaded into the API client (`client.ts:40-63`); each dropped
    keystroke query can burn 2 passes × 2 API bases on mobile data.
14. **`text-ink-500` is an undefined token** (`QueuePage.tsx:191`,
    `ChartsPage.tsx:97`) — falls through to Tailwind's default gray, escaping
    the theme system in both modes.
15. **Sub-40 px touch targets on destructive controls** — queue-row
    "remove" and "clear from here" are ~28 px and adjacent
    (`QueuePage.tsx:188,197`); shared `Chip` is ~32 px; 130 buttons total
    under 40 px. `IconButton`'s `--touch-pad` hit-box trick is the remedy.
16. **ErrorBoundary never resets on navigation** — once tripped, the error
    UI persists across route changes until manual reload
    (`ErrorBoundary.tsx:25-76`).
17. **Search commit remounts the page** — `/search` → `/search/:q` +
    `key={pathname}` throws the user to the top and clears filters on Enter;
    `autoFocus` (`SearchPage.tsx:307`) re-pops the keyboard on every
    back-nav and will fight any scroll restoration.

### P2 — Medium

18. No `keepPreviousData` on search → skeleton flash + suggestion dropdown
    collapse on every query settle.
19. `rankSongs` runs unmemoized at render time, twice per render
    (`SearchPage.tsx:209,231`).
20. Inconsistent search entry points: voice/top-search/recents/mood chips
    only `setInput`; suggestions/artist chips commit + record. Voice queries
    never reach the URL or recents.
21. All filter/tab state except the Search tab is ephemeral `useState`
    (History ranges, Charts period, Favorites sort, Discover lang/mood,
    Movies filters, NowPlaying tab) — nothing deep-linkable.
22. Inactive bottom-nav tabs have no accessible name (label rendered only
    when active, icons decorative — `BottomNav.tsx:47`).
23. Reduced-motion (OS-level) is an allow-list: `.animate-aurora-*` and the
    lyric `[data-line]` transitions keep animating; marquee under reduced
    motion truncates long titles with no static fallback.
24. Two competing card idioms (`glass-card` ×30 vs hand-rolled
    `bg-ink-800 + border-white/5`) and 6 arbitrary `rounded-[Npx]` one-offs;
    `rounded-sheet`/`rounded-pill` tokens unused.
25. No shared `Button`/`Sheet`/`Modal` primitives — 84 raw `btn-*` class
    uses, 7 bespoke overlay shells.
26. Canvas share cards are theme-blind AND still use the retired orange
    brand (`songCard.ts:94`) while the live accent is indigo.
27. PWA manifest `theme_color`/`background_color` static dark — install
    splash ignores the chosen theme.
28. Search ranking has no text-relevance or popularity signal — "Top Result"
    can be an unrelated same-language track; artist affinity
    (`artistWeight`) exists but is unused by search.
29. Albums/Artists/Playlists search tabs capped at 20 with no pagination
    (paged fetchers partially exist).
30. No suggest-as-you-type: dropdown items are harvested from the completed
    full search (debounce + network lag; nothing at 1 char; no ↑↓ keyboard
    navigation; no match highlighting).

### P3 — Low

31. Dead code: `useSearchSongs` (no callers). Stale docstring: ember still
    described as "warm amber."
32. Chart/stat palettes untested for contrast on the light canvas.
33. No `prefers-contrast: more` / `forced-colors` support.
34. Lighthouse a11y asserted on only 4 routes; no axe pass in E2E.
35. Zero-result telemetry exists server-side but no client "did you mean"
    loop uses it.

## D. What is explicitly NOT broken (verified)

Token discipline (colors via CSS vars end-to-end), keyboard shortcuts +
MediaSession (complete, with typing/modifier guards), ARIA labeling (91%),
skip link + live-region announcers, TanStack cache posture (5–10 min
staleTime, no refetch-on-focus), error boundaries with lazy-chunk
self-recovery, kid-mode/explicit filtering, search entity coverage (4 types +
voice + trending + recents + AI escape hatch), reduced-motion in-app toggle,
TV D-pad focus rings.

## E. Fix plan mapping (Phases 3–12)

- **Phase 3–4 (design/theme):** P0-4, P0-5, P1-7, P1-8, P1-14, P2-24/25/26/27.
- **Phase 5 (core nav/state):** P0-1, P0-2, P0-3, P1-16, P1-17, P2-21.
- **Phase 6–8 (search/personalization):** P0-6, P1-11, P1-12, P1-13,
  P2-18/19/20/28/29/30.
- **Phase 9–12 (perf/a11y/QA):** P1-9, P1-10, P1-15, P2-22/23, P3-all,
  full gate suite + regression tests per fix.
