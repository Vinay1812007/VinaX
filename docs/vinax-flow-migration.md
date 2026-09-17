# VinaX Flow migration

## Audit and boundaries

The working tree already contains business-logic repairs. Preserve all existing diffs. AppLayout owns engine initialization, native back, configuration, theme application, canonical URLs and scroll memory. Router owns lazy routes and native offline/startup redirects. These behaviors stay intact.

Playback uses playerStore/audioEngine; SongRow/MediaCard dispatch existing actions. Home composes owner-controlled and listener-controlled deferred recommendation blocks. Search owns persistent filters, pagination, lyric/voice search and ranking. Library uses persisted collections, favorites, saved entities and smart rules. Now Playing owns canvas, lyrics, output, sleep, DJ and queue sheets. These state owners remain in place.

Styles: index.css contains foundations plus several appended redesigns; studio.css and astra.css both override shell, Home and cards; discovery.css owns search layouts; festivals.css is calendar-scoped. Flow replaces Studio/Astra, removes superseded index overrides and keeps feature-owned structural CSS.

## Migration sequence

1. Canonical Flow semantic tokens with legacy RGB aliases for existing Tailwind consumers; retain Manrope, theme classes, accent keys and storage schemas.
2. Four primary destinations plus AI; secondary routes live in Discover/Library and remain in the command palette. Sticky top bar, responsive player and contextual rail.
3. Shared headers, cards, responsive shelves, track rows, controls and states.
4. Recompose Home opening, Search discovery, Library management, entity heroes and player presentation without replacing data hooks.
5. Apply shared language across secondary routes, verify theme contrast, lint/typecheck/tests/build/bundle and responsive rendering.

## Source inventory and implementation

### New presentation modules

- `frontend/src/styles/flow.css`: canonical shell, typography, navigation, media layouts and feature presentation using the semantic tokens in `index.css`.
- `frontend/src/components/TopBar.tsx`: history navigation, Search, command palette and local settings.
- `frontend/src/components/DestinationGrid.tsx`: grouped entry points to existing Discover and Library routes.
- `frontend/src/components/LanguageGrid.tsx`: supported language links with native-script labels.
- `frontend/src/components/SectionHeader.tsx`: consistent section title, explanation and actions.
- `frontend/src/components/HeroMedia.tsx`: shared entity header composition.
- `frontend/src/features/home/HomeOpening.tsx`: personalized mix and quick-resume opening.
- `frontend/scripts/flow-visual-check.mjs`: reproducible mocked-catalogue browser screenshots and overflow checks.

### Significant migrations

- Foundations: `styles/index.css`, `styles/discovery.css`, `tailwind.config.ts`, `main.tsx`. Semantic surface/text/accent/focus, spacing, shape, typography and motion tokens retain legacy RGB aliases for existing consumers. Manrope stays. Theme persistence keys stay.
- Shell: `layouts/AppLayout.tsx`, `constants/nav.ts`, `components/Sidebar.tsx`, `BottomNav.tsx`, `PlayerBar.tsx`, `NowPlayingRail.tsx`. Five primary destinations; secondary destinations remain reachable through hubs and the command palette. Contextual desktop queue/lyrics rail, full player at desktop widths and compact player on phones/tablets.
- Primitives: `MediaCard.tsx`, `SongRow.tsx`, `Shelf.tsx`, `Chip.tsx`, `IconButton.tsx`, `PageHeader.tsx`, `States.tsx`. Distinct media/artist/track presentations, optional shelf grids, sibling interactive controls, consistent headers and states.
- Core pages: Home, Search, Library, Artist, Album, Playlist and Now Playing. Home preserves all deferred shelves and Home Studio; Search preserves existing logic and fixes filter/suggestion focus overlap; Library adds local filtering/sorting; entity pages share heroes and track presentation.
- Discovery: Discover and Languages use grouped routes and language-native labels. Secondary pages inherit shared shell, typography, tokens, media components and state presentation. This is not a claim that every secondary page received a bespoke interaction rewrite.
- Lyrics and AI: unify surfaces and text hierarchy; active lyrics remain prominent without glow. Existing conversation, synchronized lyric, queue tuning and device workflows remain owned by their original features.

### Removed or consolidated styling

Deleted `styles/astra.css` and `styles/studio.css`, replacing their necessary structural rules in Flow. Removed appended design-era overrides in `index.css`, obsolete green defaults, decorative search hero rules and cross-shell overrides from `discovery.css`. Festival styles remain feature-scoped. No new UI framework or dependency was added.

### Behavioral boundaries

`router/index.tsx` remains the route/SEO/lazy-loading authority. Player/audio, recommendation, API, persisted-store, consent, service-worker and Capacitor contracts were not redesigned. The Home AI flag now waits for owner-configuration readiness before initiating its request. Existing feature flags, custom Home layouts and offline fallback remain active.

The workspace had unrelated changes and continued receiving external commits during this work. Backend, recommendation-engine and generic sheet migrations from that work must be reviewed independently; this report does not attribute them to Flow.

### Responsive and accessibility checks

Five viewports/themes: 390px dark, 390px AMOLED, 820px light, 1440px dark and 1920px high contrast. Seven routes per profile: Home, Search, Library, Discover, Settings, Queue and Now Playing. The harness checks runtime errors, horizontal overflow and five mobile navigation destinations. Screenshots use local placeholder artwork, not a live catalogue.

Visible focus, semantic button/link separation, labelled rail toggle state, 44px chips/icon controls, safe-area-aware mobile navigation and reduced-motion behavior are retained or improved. Light mini-player now uses semantic text against a lightly artwork-tinted surface rather than white text over a pale background. These checks do not constitute a full WCAG audit.

### Performance

Queue-dependent desktop rail/Next Up and onboarding are deferred. Route lazy-loading, responsive image generation, Home request budgets, query caching and the existing bundle guard remain. Measured initial JavaScript: 187.4 KB gzip against the unchanged 188 KB limit. No budget was raised.

### Release follow-up

Verify real catalogue artwork/audio, Android hardware back/downloads, physical-device safe areas, casting and TV spatial navigation before deployment. Review all secondary workflows with production-size collections and translations. Run an assistive-technology audit with screen readers and keyboard-only use. No production deployment was performed.

## Validation (17 September 2026)

- `npm run lint`: pass, zero warnings.
- `npm run typecheck`: pass.
- `npm test`: 925 tests pass across 141 files.
- `npm run build`: pass; 31 prerendered routes.
- `node scripts/check-bundle-size.mjs`: pass, 187.4 KB / 188 KB gzip.
- `npm run e2e`: smoke checks plus all 43 browser tests in 12 files pass.
- Flow visual harness: all 35 route/profile combinations pass, no horizontal overflow or uncaught runtime errors.
- `git diff --check`: pass.

The browser fixtures now separate normalized persisted songs from raw catalogue records, provide unique valid audio for queue-order assertions, and use an exact selector for Backup Center's Open button. Assertions were preserved. Existing build warnings about large lazy chunks, telemetry import splitting and deprecated chunk configuration remain; they do not fail the build.
