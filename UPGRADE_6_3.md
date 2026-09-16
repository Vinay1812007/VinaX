# VinaX 6.3 — arc sequencing, adaptive re-planning, Queue Builder

Builds on 6.2 (AI DJ, DJ voice, AI Home shelves). 6.2 made the DJ *order* a real pool; 6.3 makes the ordering itself accountable: a deterministic sequencer shapes every continuation as an energy arc from per-song signals, learns from which hand-offs the listener finished, re-plans when they are restless, and lets them plan a whole stretch from a brief with a preview.

## What was built

### Arc sequencer — `services/recommendation/sequencer.ts`
- Greedy, deterministic order over an admitted pool toward a target arc: `steady` (settle, one gentle peak near two thirds, ease off), `build`, `wind-down`, `wave`, `lift` (come up a notch quickly, then hold).
- Signals per song: energy (AI classifier value when present, else the mood-derived estimate the session tracker already uses, nudged by tempo), mood continuity, lead-artist spacing (never back to back, penalised within three), same-album spacing, decade proximity, hard language lock, discovery share cap, sure-pick bias, transition memory, and the caller's ranking as a taste prior.
- Optional duration budget (stop once the minutes are covered) and a per-slot "why here" line.
- Used by queue continuation (`recommendNextSongs`), the adaptive re-plan and the Queue Builder.

### Transition memory — `transitions.ts`, `transitionTracker.ts`
- Every forward hand-off A → B is judged when B ends: ≥ 70 % heard = completed, < 30 % = skipped, in between no verdict. Stored by song pair and by artist pair, decayed with a 45-day half-life, capped (600 pairs / 400 artist pairs), device-local under `vinax.transitions.v1`. Jumps elsewhere in the queue are not hand-offs and are not recorded.
- The sequencer reads it as a −1..1 score (exact pair 0.8, artist pair 0.4).

### Queue continuation — `engine.ts`
- After ranking and the AI metadata pass, the admitted pool is sequenced to the arc shape chosen from the live listener-energy read (restless / wavering → `lift`, late hours → `wind-down`, else `steady`), language-locked to the seed, with explore-source songs as the discovery share and favourites/most-played as sure picks. A language-locked pool that runs short is topped up in ranked order.
- The AI DJ receives the arc shape as `arcShape`; its order is accepted only when `arcErrorOf(order)` is within 0.08 of the local arc's error. Its reasons and segues are kept either way.

### Adaptive re-plan — `adaptive.ts` + player store
- The player now marks songs the recommender appended (`isAutoQueued`, `autoTail`, never persisted). Two consecutive skips inside that tail re-sequence the remaining tail with `lift`, bringing up to four unqueued favourites in the seed's language into the pool; hand-queued songs keep their place (`replaceAutoTail`). A completed song resets the streak; 90 s cooldown; a toast says what happened.

### Queue Builder — `queuePlanner.ts`, `features/queue/QueueBuilderSheet.tsx`
- Brief: start from now-playing / a favourite / taste alone; 20–90 minutes; mood; energy shape; discovery level (5 % / 20 % / 40 % of slots); language; an optional note for the DJ.
- Gathers seed-first and taste-wide candidates, admits them through the standard gates (language, mute, block, explicit, junk, de-dup, recent) plus the mood filter, ranks by taste, sequences to shape and minutes, optionally asks the DJ for an intro and reasons (`listenerGoal`).
- Preview: energy-arc chart, every song with duration and reason, candidate count; then **Play this plan** (`applyPlan('replace')`) or **Add after current** (`applyPlan('append')`). Opens from the Queue page header and its empty state.

## Verification (2026-09-16)
- Frontend: lint ✓, typecheck ✓, unit tests ✓ (96 files, 593 tests — 17 new: sequencer, transition memory, tracker verdicts, adaptive re-plan and store actions, planner admission and plans), build ✓. Bundle-size gate: still red for the pre-existing reason (UPGRADE_6_1.md).
- Backend: lint ✓, typecheck ✓, tests ✓ (the DJ contract gained `arcShape` / `listenerGoal`).
- Browser (mocked catalogue, real Chromium, `npm run e2e`): **39 tests in 10 files pass** — `e2e/v63-queue.spec.ts` at 390 px and 1280 px (the Queue Builder opens, plans a bounded arc, previews it with reasons and the arc chart, and installs it as the queue) plus every earlier suite. Screenshots: `frontend/test-results/v63-queue-builder-*.png`.
- Not verified: live DJ output with real engine keys; how well the mood keyword estimate matches audio for songs the classifier has not seen (the sequencer only knows what the catalogue and classifier give it).

## Limitations
- Energy is an estimate for songs without classifier metadata; the arc is only as good as those estimates.
- Transition memory starts empty and needs completed hand-offs to become useful; it never leaves the device.
- The re-plan only touches songs the recommender added in this session (marks are not persisted across reloads).

## Configuration
- No new secrets or flags. AI DJ / AI shelves switches from 6.2 still apply; the Queue Builder asks the DJ only when AI DJ is on.
- New client key: `vinax.transitions.v1` (not included in backups on purpose — it is behavioural memory, rebuilt by listening).
- Not deployed as part of this work.
