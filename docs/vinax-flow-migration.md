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

## Source inventory

