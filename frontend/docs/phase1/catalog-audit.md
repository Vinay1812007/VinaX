# Content & Catalog Audit — v16.82

## 1. Source

Single upstream: saavn.dev (JioSaavn mirror API) — search (songs/albums/artists/playlists),
suggestions (related tracks), launch/browse modules (trending, charts, new releases).
No keys required. Audio: multi-quality variants per track with failover between sources.
Artwork: multi-resolution variants; responsive `srcset` via `artSrcSet`.

## 2. Data model (as-built, `src/types/music.ts`)

- **Song** — id, title, subtitle, artists `ArtistRef[]`, album `AlbumRef|null`,
  images `ImageVariant[]`, audio `AudioVariant[]`, duration, language, year, explicit flags.
- **Album / Artist / Playlist** — id + name + images + song collections; albums carry
  film metadata implicitly via name (`… (From "Movie")`).
- **Chart / Mix / Mood / Language** — client-side constructs over search + curated queries
  (12 hub languages; mood taxonomy in constants).

## 3. Gaps

1. **No first-class `Movie` entity** — film pages are album pages; "movie" chip in the player
   parses the album name. Good enough for SEO today (album titles carry film names), but a
   `Movie` model (title, year, language, soundtrack album ids) would unlock movie hub pages.
   → Phase 2 data-layer item.
2. **Genre/tempo metadata absent** upstream — mood/tempo inference is heuristic (query- and
   AI-based). Phase 4's content-based similarity must continue to lean on language + artist +
   AI ranking rather than audio features.
3. **Duplicates** — the same recording appears under multiple ids (album vs single). Client
   dedupes by normalized title at queue time; catalog-level dedupe impossible without
   upstream ids. Accepted limitation.

## 4. Licensing posture

Streams and artwork come from a third-party public API; VinaX hosts no media. Terms page
states third-party sourcing and no-DRM-circumvention; DMCA page + contact route exist for
rights holders. Risk: upstream API instability/legal status — accepted by owner; multi-source
audio failover reduces breakage. No change ordered in this rebuild.

## 5. Verdict

Model is sound for Phases 2–4. Ordered work: formal Movie type (P2), documented mood
taxonomy (P4), keep title-dedupe (accepted).
