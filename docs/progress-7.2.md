# 7.2 — what is done, what is not

A companion to [audit-7.2.md](audit-7.2.md), written so the next session can pick this up without re-reading the diff. Every line says what exists on the branch, not what was intended. The branch is `upgrade/7.2`, cut from `7c4e2f5` (7.1.0 / API 5.14.0); it publishes 7.2.0 / API 5.15.0.

## Done

**Playback and learning**
- One playback-session contract (`services/playback/session.ts`): heard seconds per playback instance, declared seeks, pauses, buffering, playback rate, a wall-clock allowance for throttled background ticks, repeat-one runs, unknown durations, failed playback. PLAY, SKIP, COMPLETE, transition memory, the listen clock and opt-in analytics all read it. One learning event of each kind per run.
- A `counted` event marks the moment a play counts; usage analytics sends its `play` from it.
- Stale async work after a playback failure is tied to its playback instance and cancelled on a track change.

**The queue**
- `planNextSongs`: the on-device order inside one end-to-end deadline (8 s, 3.5 s when the listener is waiting), a validated reserve that plays at once when the queue runs dry, side effects deferred to `commit(accepted)`, cancellation on a queue change, and the AI DJ as a bounded refinement of automatic entries that have not started.
- One admission gate for every automatic queue change, read after every await.
- A rebuild replaces the recommender's picks only; ownership survives a reload.
- Adjacency is judged against the song a stretch will follow; soft rules yield in the order a listener minds least.

**Identity**
- `identityCore.ts`, byte-identical in the app and the Worker, with shared vectors run by both test suites. `recordingKey` distinguishes a remix or live cut from its work family. Hidden-artist keys are Unicode-safe.

**Retrieval, ranking, Home**
- Bounded gathering (concurrency, de-duplication, a response cache, soft and hard deadlines, cancellation), multi-source provenance, cold start from explicit preferences.
- Confidence-aware features (unknown scores 0; inferred weighs less than supplied), a candidate-specific weekday term, an agreement bonus, every contribution recorded with its own honest line.
- Home shelves and the popular-picks shelf apply the listener's current restrictions at render time, to cached and placeholder data, without spending another model call.

**Trends**
- Provider adapters, scheduled ingestion with quota accounting and idempotent jobs, catalogue matching with confidence and an admin review queue, editorial imports with evidence and expiry, a public read that labels source, region, update time and stale state, and a truthful catalogue fallback. Verified charts are one bounded, capped ranking signal.

**AI boundaries**
- One listener switch turns off every background AI call in recommendations; the owner has per-feature switches, an emergency stop and daily spend caps enforced in the Worker; every route answers 503 and falls back on device. Which switch stops which call is documented in `ai.md`.
- Prompts treat catalogue and listener text as data. The DJ's self-rating is recorded only when the model gives one.

**Owner console and operations**
- Failed database reads answer 502 with the failure kind, and the console says "Unavailable" instead of showing zeros. Every database request has a deadline.
- Recommendation quality, AI operations and versioned recommendation tuning panels; audit rows record actor, action, time, request id and redacted before/after; rate limits and the sign-in lockout count per edge location.

**Listener controls**
- Who queued what, Keep this song, deliberate regeneration, Undo on remove, keyboard reorder with focus restoration, More/Less like this with an expiry and Undo, a personalization preview, a soft-mute list, and a taste reset that offers a backup first.

**Evidence**
- A versioned offline evaluation (19 fixtures × 12 salts) run against the 7.1 baseline with the same harness; opt-in outcome telemetry and experiment exposure logging, with the reading rules written down.

## Not done, and why

| Item | Why | Where to pick it up |
| --- | --- | --- |
| Apply the three SQL migrations | No database in this environment | `frontend/supabase/migrations/README.md` names each file and what degrades until it is applied |
| Live trend ingestion | No provider credentials, and an attribution decision is owed (below) | `docs/trends.md` |
| Momentum and "new entry" markers | The video platform's terms forbid derived metrics without an audited agreement | `TRENDS_DERIVED_METRICS_SOURCES` |
| Android device QA | No device here; mocked web tests are not native QA | `docs/qa-device-script.md`, plus the specific list in the 7.2 UI report |
| Multi-operator identity, roles, revocable sessions | Deliberately deferred; the shared token still signs everyone out on rotation | Migration path in `docs/operations.md` |
| An A/B result | Exposure logging exists; no experiment is wired into the engine and no result is claimed | `docs/evaluation.md` |
| Embeddings, collaborative filtering, a bandit | Not justified by the data, provenance or consent available | — |
| Toast action buttons below a 44 px hit box | Outside the queue work's scope | `components/Toasts.tsx` |
| Persisting per-entry recommendation metadata across a reload | Ownership persists; the `alg`/`picker` stamp does not | `store/playerStore.ts` |

## Decisions the owner owes

1. **Attribution versus the brand rule.** The video platform's terms require its brand to be shown where its chart data is displayed. The standing product rule bans third-party brand names in the product. Today the label is neutral and owner-configurable, and the adapter stays `not_configured` until a key is set. Setting the key without deciding this is the risk.
2. **Whether to raise the first-load budget's ceiling.** First load is 171.3 KB against a 188 KB gate; the gate was set when the measurement was 186 KB. Lowering it would lock in the gain.

## How to verify this branch

```sh
cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build && node scripts/check-bundle-size.mjs && npm run e2e
cd ../backend && npm ci && npm run lint && npm run typecheck && npm test && npx wrangler deploy --config worker/wrangler.toml --dry-run --outdir /tmp/vinax-worker-dry
cd ../frontend && node scripts/eval-recs.mjs      # the offline recommendation evaluation, with the 7.1 baseline
```
