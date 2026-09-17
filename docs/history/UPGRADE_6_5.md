# VinaX 6.5 — the DJ takes the wheel (3.9 behaviours on the 6.x engine)

Builds on 6.4. The brief: make the AI DJ, the next-song algorithm, the Home screen builder and the playlist builder behave like VinaX 3.9.2 (the generative, DJ-on-every-play design), without giving up what 6.1–6.4 added (pool admission in code, arc sequencing, adaptive re-planning, taste decay, privacy bounds). Every 3.9 behaviour below is implemented on the current architecture rather than by reverting files.

## What 3.9.2 did, and what 6.5 does now

| 3.9.2 behaviour | 6.4 state | 6.5 |
|---|---|---|
| **DJ drives the queue on every play** — `playQueue` started only the tapped song and the AI built the continuation | Playback followed the tapped album/playlist; the DJ only extended when two songs were left | `playQueue` treats a list as a seed when the listener setting **DJ builds every queue** is on (default on, like 3.9's `autoqueueSimilar`): the tapped song starts alone, `startTrack` asks for the continuation at once. `keepList` (Queue Builder plans) and autoplay-off / follow mode / repeat keep the list. |
| **Generative DJ** — the model proposed `{title, artist, reason}` and the client live-searched each one (first hit, any language) | Pool-only: the DJ could only order what the local recommender admitted | The DJ may propose up to 4 songs outside the pool per round (`discover: true`, flagged `fromPool: false`). The client searches each one and keeps it **only** when a result matches title and artist (`matchesProposal`: canonical identity, or all title words plus a credited artist; junk titles rejected), speaks the queue's language and passes the same gates as every other song (queued, muted, blocked, explicit). An unmatched or invented title never plays. |
| Wide pool, random subsample (35 of 80) so rounds differ | Top 25 ranked, deterministic | `samplePool`: top 10 ranks always, 20 more sampled from the next 30 ranks; plus a rotating `discoveryFocus` in the context (12 directions) |
| Candidate gather on the fast lane when the pool ran thin | — | `/api/dj` gathers ~20 real candidates on the fast lane (5 s cap) when `discover` is on and the pool has fewer than 24 songs; they are offered as supplementary discoveries |
| **Tune this queue** — 12 intents (`tune.ts`), `tuneQueue(intent)` kept what played and rebuilt the rest; chips on Queue and Now Playing; "Surprise me" in the command palette | — | `services/recommendation/tune.ts` (intents, labels, DJ hint, deterministic score nudge, arc shape), `playerStore.tuneQueue`, `TuneChips` on the Queue page and in the player's extras, palette action. The engine applies the nudge to the ranking, moves the language lock for **Switch language**, relaxes the arc tolerance, and sends `tuneInstruction` to the DJ. |
| Shuffle exhausted → refill before reshuffling | Already handled by the end-of-queue path | unchanged |
| **AI Home rebuilt on every Home open** (per-mount nonce, `staleTime: 0`), page rotation per shelf, unseen-first | Per app load, half-day cache, page 1 only | `useAiHome` keys the build on a per-mount nonce with `staleTime: 0`; each shelf reads `rotatePage(query, nonce, i, 3)` (page 1 as the floor) and `biasUnseenFirst` sinks songs shown in the last 200 |
| `/api/home`: gather ideas → curate 4–6 → deterministic fallback shelves | Single-stage curate task | `_lib/homeShelves.ts` behind the `shelves` task: scholar + fast lanes pitch ~8 ideas (4.5 s), the dj lane curates, then the pitches, then `fallbackShelves` (on-language, rotated by seed) — 503 only when no engine is configured |
| Playlist builder: prompt → `/api/playlist` → resolve via search; example ideas generate immediately | Same service (with parallel resolution, identity exclusions, language filter); examples only filled the box | Example ideas fill the box **and** build at once. Service unchanged (it is a superset of 3.9's). |

## Files
- Frontend: `services/recommendation/tune.ts` (new), `features/queue/TuneChips.tsx` (new), `features/home/homeVariety.ts` (new), `services/ai/dj.ts` (`resolvePicks`, `matchesProposal`, `samplePool`, `pickDiscoveryFocus`, 20 s leash), `services/recommendation/engine.ts` (tune, sampled pool, gated discoveries, `dj-discovery` source in the debug view), `store/playerStore.ts` (`playQueue` takeover + `keepList`, `tuneQueue`, `tuneIntent`), `store/settingsStore.ts` (`djTakeover`), `features/home/useAiHome.ts`, `services/ai/home.ts`, pages Queue / Now Playing / Settings / AI Playlist, `components/CommandPalette.tsx`.
- Backend: `functions/api/dj.ts` (`discover`, `maxDiscover`, gather, `parseCandidates`, `fromPool` in `parsePicks`), `functions/_lib/homeShelves.ts` (new), `functions/api/curate.ts` (shelves task routed through it, logged as feature `home`).

## Contracts
- `POST /api/dj { context, pool, count, discover?, maxDiscover? }` → `{ intro, songs: [{ songId, title, artist, reason, segue, confidence, fromPool }], model }`. Without `discover`, behaviour is exactly 6.4 (pool only).
- `POST /api/curate { task: 'shelves', data: { taste, visitNonce, shelfTypes, avoidShelves } }` → `{ data: { sections: [{ title, query, why, description?, type? }], model } }`; `model` is `"fallback"` when no engine answered usably.

## Verification (2026-09-16)
- Backend: lint ✓, typecheck ✓, tests ✓ (30 files, 215 tests — 6 new: proposals parsing and route, candidate parsing, shelf parsing/avoid filter, fallback shelves, designer flow).
- Frontend: lint ✓, typecheck ✓, unit tests ✓ (101 files, 621 tests — 14 new: tune, Home variety, catalogue-verified discoveries, pool sampling, DJ brief, takeover, tuneQueue), production build ✓ (bundle-size gate still red for the pre-existing reason in UPGRADE_6_1.md).
- Browser (mocked catalogue, real Chromium, `npm run e2e`): **41 tests in 11 files pass** — new `e2e/v65-dj.spec.ts` (tapping a song in search results seeds the DJ instead of playing the list; Tune this queue keeps the current song and rebuilds the tail; Settings shows “DJ builds every queue”) plus every earlier suite, including the updated Playlist Studio check (an example idea builds at once). Screenshots: `frontend/test-results/v65-dj-takeover-1280.png`, `frontend/test-results/v65-tune-390.png`.
- Not verified: live model output with real engine keys (how often the DJ's proposals resolve; the quality of pitched shelves).

## Limitations
- A discovery costs one catalogue search per proposal (at most four per round, in parallel, inside the 20 s leash).
- Rebuilding Home on every open spends one AI call per open (as in 3.9). Turn off **AI-designed shelves on Home** to stop it.
- With **DJ builds every queue** on, playing an album plays the tapped song plus what the DJ builds — the album order is not followed. The switch restores list playback.

## Configuration
- No new secrets or flags. New listener setting `djTakeover` (default on). Not deployed as part of this work.
