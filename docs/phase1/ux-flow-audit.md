# UX & Flow Audit — v16.82 (mobile + desktop walk)

Method: every route walked on phone-width and desktop during the July sessions; issues below
are the surviving items after the July fix waves (each fixed item shipped in v16.5x–16.8x).

## 1. Recently fixed (for the record)

Search input hijack on scroll · stale route overwriting typing · device output reverting on
track change · Android downloads · localhost share links · light-mode invisible glass ·
duplicate Home greeting · hover-only controls unreachable on tablets · black glyphs on bloom
gradients · pill label wrapping · logo bar scrolling away · frozen splash + "wrong note"
cache poisoning · Listen Together sync/host-control/ghost-room bugs · tune-queue repetition.

## 2. Open friction (ordered by user impact)

1. **Marquee mid-scroll gap** — long titles show the loop seam mid-animation in the player.
   Cosmetic; fix in Phase 3 player polish.
2. **Voice mode lacks the "orb" treatment** — VinaX AI voice chat works but has no
   ChatGPT-style visual presence. Deferred by owner; Phase 3 candidate.
3. **Cast-to-TV end-to-end unverified** — code path exists; needs a device test matrix pass
   (Phase 5 QA).
4. **AI latency masking** — when the DJ lane is slow (25–47 s), the queue silently falls back
   to local picks; a subtle "AI is thinking / using instant picks" hint would set expectations
   (Phase 4 transparency item).
5. **Onboarding tour** exists (7 slides) but isn't re-discoverable after first launch except
   via Help. Low priority.
6. **Admin dashboard** is desktop-oriented; fine (owner tool), out of rebuild scope.

## 3. Flow inventory (all pass basic walk)

Listen: home → shelf → play → full player → queue/lyrics/immersive → mini-player.
Discover: discover/explore/moods/movies/charts/language hubs → entity pages → play.
Personal: library/favorites/history/taste-profile/weekly/made-for-you/stats.
AI: VinaX AI chat (5 engines, web, voice, images) · AI playlist · assistant lane in Settings (removed v16.77 by request).
Social: Listen Together host/guest/add-songs/invite links.
Utility: settings/languages/cache-info/downloads/offline/drive/karaoke/quiz/download(APK).
Trust: about/privacy/terms/dmca/contact/help.

## 4. Phase 3 order (flagship first)

Player polish (marquee seam, voice orb) → Home/Discover shelf density on desktop →
hub page sorting/quick-play consistency → trust pages copy pass.
