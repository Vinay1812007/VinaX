# VinaX 6.2 — AI DJ, talking DJ voice, AI-designed Home shelves

Built on top of 6.1 (branch `upgrade/6.1-reliability-home-library`). The 6.0 release had removed the AI DJ endpoint, the DJ client and the AI-designed Home shelves, leaving only a quiet AI re-rank inside the queue engine and the "arrange my shelves" button in Home Studio. 6.2 rebuilds the three visible features on today's lane router and recommendation engine instead of reverting the old code.

## What was built

### AI DJ — next-song sequencing
- `backend/worker/functions/api/dj.ts` (new): `POST /api/dj { context, pool, count }` on the `dj` lane (ladder chat → fast → scholar → home, 16 s budget). The model **selects and orders from the pool only**; every pick is verified against the pool by canonical key and anything else is dropped. Returns a one-line set intro plus, per song, a reason (≤ 120 chars) and a spoken segue (≤ 160 chars). 503 when no engine key is configured, 500 with an honest envelope when the answer is unusable. Logged to `vinax_ai_events` as feature `dj`.
- `frontend/src/services/ai/dj.ts` (new): builds a privacy-bounded context (titles/artists, taste, session vibe, skips, likes, avoid lists — never ids or identifiers), sends the top 25 admitted candidates, resolves picks strictly from that pool, publishes reasons to the "Why this song?" store and segues to the DJ store, and remembers the last 300 surfaced songs so the next round avoids them. A 503 disables the DJ for the session; other errors back off 60 s; a 14 s client leash guarantees the queue never waits.
- `services/recommendation/engine.ts`: `recommendNextSongs` hands its admitted, ranked pool to the DJ for ordering when the listener setting **AI DJ** and the owner flag `aiDj` allow; the deterministic order ships on any failure. Candidate gathering, language lock, blocklists and de-dup are unchanged and stay in code.

### DJ voice — the DJ talks
- `features/player/djVoice.ts`: speaks the AI DJ's segue for the song that just started (falling back to "Now playing … by …"), through `features/ai/readAloud` so it uses the listener's chosen studio voice with the device voice as the offline fallback, and ducks the music to 35 % while speaking. A boot-time fallback voice getter makes the Settings → Voice choice apply app-wide, not only while the AI page is open.

### Designed for you — AI Home shelves
- `POST /api/curate` task `shelves` (new contract): 4–6 shelf titles with catalogue queries and one-line reasons, steered away from the last 30 shown, brand- and markup-free.
- `features/home/useAiHomeShelves.ts` (new): validates the sections, resolves each query against the catalogue (ranked, freshness/mute/block filtered, ≥ 4 songs to show), refreshes per half-day / taste / language / Refresh discovery, and keeps anti-repeat memory.
- Home block `aihome` ("Designed for you"): a visibility-mounted block after "Made for you" that renders nothing when the AI is off, unconfigured, slow or the owner flag `aiHome` is off. Added to Home Studio, the owner console's Home Layout Studio, and the config validator.

### Switches
- Listener: Settings → Recommendations → **AI DJ**, **AI-designed shelves on Home** (both on by default); Settings → Playback → **DJ voice** (off by default, unchanged).
- Owner: feature flags `aiDj`, `aiHome` (console → Feature flags); Home layout key `aihome` can be turned off for everyone.

## Verification (2026-09-16)
- Frontend: lint ✓, typecheck ✓, unit tests ✓ (92 files, 576 tests — 11 new: DJ client, DJ voice, AI shelf parsing), build ✓. Bundle-size gate: still red for the pre-existing reason (see UPGRADE_6_1.md).
- Backend: lint ✓, typecheck ✓, unit tests ✓ (29 files, 206 tests — 5 new for `/api/dj`), router coverage ✓.
- Browser (mocked APIs, real Chromium, `npm run e2e`): **37 tests in 9 files pass** — `e2e/v62-ai.spec.ts` (AI shelves render from the catalogue when allowed, the owner flag stops the request entirely, an AI failure leaves Home unchanged, Settings shows the switches) plus the 6.1 and earlier suites. Screenshot: `frontend/test-results/v62-ai-home-1280.png`.
- Not verified: live model output quality (needs the deployment's engine keys), studio-voice TTS on a device, native Android playback with the DJ voice ducking.

## Limitations
- The DJ orders what the local recommender admits; it cannot pull a song that is not already a candidate. That is deliberate (no hallucinated titles) but means the pool's breadth bounds the DJ's creativity.
- Segue lines are only spoken for songs the DJ sequenced; songs the listener queued by hand get the plain intro.
- AI shelves depend on the catalogue answering the model's queries; a query with fewer than four usable songs is dropped silently.

## Configuration
- No new secrets: `/api/dj` and the `shelves` task ride the existing `dj`, `chat`, `fast`, `scholar` and `home` lane keys.
- Republish the Home layout once in the owner console if you want `aihome` placed explicitly; existing published layouts get it appended.
- Not deployed as part of this work.
