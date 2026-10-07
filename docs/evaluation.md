# Evaluation

This document covers the offline evaluation of VinaX's next-song selection: a harness in `frontend/eval/` that runs the real recommendation engine against synthetic listeners with the network replaced, and reports rule compliance, diversity mechanics, fallback behaviour and latency. It exists so that a change to the engine can be compared with the engine before it, on the same inputs, in a few minutes. It does not measure whether anyone enjoys the songs; the last sections say what it cannot see and where that evidence comes from instead. The engine itself is described in [recommendations.md](recommendations.md).

## The model in one page

| Step | What happens | Where |
| --- | --- | --- |
| 1. Fixtures | 29 synthetic listeners, each with a seed song, a profile, a history, settings and a pool of fictional songs | `frontend/eval/fixtures/index.ts` — `buildFixtures(now)` |
| 2. Mocks | Five network-facing modules are replaced; everything else is the app's own code | `frontend/eval/lib/mocks.ts`, wired by `vi.mock` in `frontend/eval/recs.eval.ts` |
| 3. Sittings | Each fixture runs once per salt (12 by default). A sitting is four continuations of five songs, a queue of twenty | `runSession` in `frontend/eval/lib/run.ts` |
| 4. Measuring | Every queued song is checked against rules written out again for the harness | `frontend/eval/lib/rules.ts` |
| 5. Extra runs | One determinism re-run, one "asked again from the same song" run, eight latency conditions | `frontend/eval/recs.eval.ts` |
| 6. Aggregation | Counts, shares and percentiles, overall and per fixture | `summarise` in `frontend/eval/lib/metrics.ts` |
| 7. Gate | Three assertions; the process exits 0 or 1 | `frontend/eval/recs.eval.ts`, `frontend/scripts/eval-recs.mjs` |
| 8. Reports | A JSON file per pipeline, a combined JSON file and a Markdown file | `frontend/scripts/eval-recs.mjs` |

A default run plans 1 308 continuations in 348 sittings and takes a little over three minutes.

## Running it

There is no npm script and no workflow for the evaluation. It runs on demand, from `frontend/`:

```sh
cd frontend
node scripts/eval-recs.mjs --no-baseline            # the working tree only
node scripts/eval-recs.mjs --baseline <commit>      # the working tree, then that commit, side by side
node scripts/eval-recs.mjs --help                   # the header comment of the script
npx vitest run --config eval/vitest.config.ts       # the harness alone, no summary, no Markdown
npx tsc --noEmit -p eval/tsconfig.json              # type-check the harness (the root tsconfig only covers src/)
```

The default unit-test run does not collect the evaluation: `npx vitest run` looks for `*.test.*` and `*.spec.*`, and `eval/vitest.config.ts` includes only `eval/**/*.eval.ts`.

| Flag | Effect | Default |
| --- | --- | --- |
| `--no-baseline` | Run the working tree only | off |
| `--baseline <commit>` | The commit to compare against | `7c4e2f5` (see [Comparing with a baseline](#comparing-with-a-baseline): this default no longer loads) |
| `--quick` | 3 salts and 3 latency runs | off |
| `--salts <n>` | Salts per fixture | 12 |
| `--latency-runs <n>` | Runs per latency condition | 8 |
| `--cap-ms <n>` | Upper bound on any single latency run | 12000 |
| `--out <dir>` | Where the reports go, relative to the current directory | `frontend/eval/reports` |
| `--report-only` | Rebuild the combined reports and the summary from the per-pipeline JSON of the last run | off |

An unknown flag exits with code 2. The runner passes these on as environment variables (`EVAL_PIPELINE`, `EVAL_REF`, `EVAL_OUT`, `EVAL_SALTS`, `EVAL_LATENCY_RUNS`, `EVAL_LATENCY_CAP_MS`, `EVAL_ASSERT`, `EVAL_SRC`), which `recs.eval.ts` and `eval/vitest.config.ts` read.

### Files it writes

| File | Written by |
| --- | --- |
| `<out>/recs-eval-current.json`, `<out>/recs-eval-baseline.json` | Each harness run (`EVAL_OUT`) |
| `<out>/recs-eval.json`, `<out>/recs-eval.md` | The runner, after the runs |
| `frontend/eval/reports/current.json` | A direct `npx vitest run --config eval/vitest.config.ts`, which has no `EVAL_OUT` |
| `frontend/eval/.cache/baseline-<commit>/` | A baseline run: the `frontend/src` of that commit, extracted with `git archive`, its test files deleted |

`frontend/eval/reports/` and `frontend/eval/.cache/` are git-ignored (`frontend/eval/.gitignore`). Nothing tracked is written. The cache is kept between runs and can be deleted at any time.

## Fixtures

`buildFixtures(now)` returns 29 fixtures, each a pure function of the timestamp the harness passes in (`NOW = 1_800_000_000_000`). Songs, titles and artists are fictional, in Telugu, Hindi, Tamil, Punjabi, Malayalam and Latin scripts (`frontend/eval/fixtures/catalogue.ts`). `EVAL_FIXTURES_VERSION` is `1.3.0`; bump it whenever a fixture changes, because two reports with different fixture versions are not comparable.

| Fixture | What it is for |
| --- | --- |
| `cold` | No profile, no history, no favourites |
| `warm` | A full profile; the AI DJ answers with an order of its own |
| `familiar` | Familiar mode: a 5 % discovery allocation |
| `discover` | Discover mode (Hindi), AI unavailable |
| `tamil` | Tamil; the DJ times out |
| `punjabi` | Punjabi, AI off |
| `malayalam` | Malayalam, Familiar mode |
| `mixed` | A listener who plays Hindi, Telugu and Tamil; the DJ proposes an off-language song, an explicit one and a hidden artist |
| `mixed-queue` | The same listener with `queueLanguages: 'mix'`: Hindi seed, three languages pinned, and Punjabi in the pool, which must stay out |
| `prefs` | A quiet cluster and a loud one in one pool |
| `skips` | A skip streak of three, with the skipped songs in the pool |
| `partial-outage` | The seed-suggestions source throws; the searches answer |
| `offline` | Every source throws |
| `sparse` | No energy, tempo, mood, genre, year or duration |
| `versions` | One work in several cuts, plus a zero-width joiner, a Latin accent and a featured credit |
| `small-catalogue` | Six candidates for a sitting that wants twenty |
| `kid-mode` | Kid mode with explicit songs in the pool and a DJ proposing more |
| `muted-languages` | Hindi and English muted, with a pool full of them |
| `hidden-artists` | Two hidden artists (one in an Indic script, one Latin) and hidden songs |
| `soft-muted` | Two lead artists under "show fewer like this" |
| `dj-session`, `folk-session` | A DJ-remix sitting and a folk sitting; what follows should stay in style |
| `deep-sources` | Thin suggestions; the album page and two similar artists' pages hold songs no search returns. Declares those as its taste |
| `embeddings`, `embeddings-off` | The device holds learned vectors that tell the fitting half of a 60-song pool apart; `-off` is the same listener without them |
| `served` | Eight of the strongest suggestions were shown on Home this week |
| `memory` | Every continuation is committed and its first four songs end (three finished, one skipped) |
| `unplayable` | The suggestions response can stream only half its songs |
| `sparse-history` | Three plays, no favourites, one pinned language |

Two more fixtures serve the latency conditions only: `latencyFixture` (a warm Telugu listener, pool of 26) and `largePoolFixture` (the same listener, pool of 104).

## How the real engine is loaded

`recs.eval.ts` imports `@/services/recommendation/engine` and calls `planNextSongs` when the tree exports it, otherwise `recommendNextSongs`. The `@` alias points at `frontend/src`, or at `EVAL_SRC` for a baseline. Five modules are replaced, and nothing else:

| Replaced | By |
| --- | --- |
| `@/services/api` (the catalogue client) | The fixture's pool, with scripted failures, delays and never-settling calls. Album pages, artist pages, artist top songs and exact-name artist searches answer as the catalogue does |
| `@/services/ai/recommendations` | A classifier that never answers, and the re-rank the real client returns when the curator is unreachable |
| `@/services/ai/dj` | A scripted DJ: off, unavailable, timing out, never answering, re-ordering, or proposing songs that break the rules |
| `@/services/queryClient` | No cached data |
| `@/services/ai/embeddings` | Only the vectors a fixture says the device holds; no network |

The mock sits one level below `candidates.ts` on purpose: the candidate stage has rules of its own (soft mutes, Kid mode, blocked songs), and replacing the whole module would remove them from the measurement.

Before each continuation `applyFixture` clears `localStorage` and `sessionStorage`, resets the transition memory and the candidate cache, and writes the fixture's settings and library into the stores. The `memory` fixture is the exception: its state is applied once and kept for the sitting. The clock is frozen at `NOW` for the quality runs and real for the latency runs.

### One sitting

`runSession` does what the player does. It plans five songs (`LIMIT`), appends them to the queue, and plans again, four times (`batches: 4`). The seed of each later continuation is `queue[length - 2]`, the song the player would be on with one left after it. Songs before the seed count as played and are added to the history. Every continuation is called with `excludeIds` and `excludeKeys` for the whole queue so far. The salt is the per-session rotation seed the app passes to the engine.

## Metrics

The rules are written out again in `eval/lib/rules.ts` rather than imported from the engine, so the harness cannot agree with a bug by sharing its code. The one shared piece is song identity (`canonicalKey` and `recordingKey` from `services/recommendation/identityCore.ts`), a contract pinned by `shared/identity-vectors.json`.

| Metric | Exact definition |
| --- | --- |
| Hard-rule violation | A queued song that is: explicit under Kid mode; in a muted language; credited to a hidden artist; hidden by id; led by a soft-muted artist; the same id or work as one of the last 20 plays; skipped in this sitting; unplayable; or the same id or work as a song already in the queue or earlier in the same continuation (`breaksRule`, `violationsOf`) |
| Off-language under the lock | A queued song in a known language other than the lock's. Excused when fewer than three eligible in-language candidates were left for that continuation; otherwise a hard violation |
| Mix rules (`queueLanguages: 'mix'`) | `off-language`: a known language outside the listener's set. `language-opening`: slot 1 or 2 not in the lead language. `language-run`: two off-lead songs in a row. Hard violations unless the engine reported the `language-mix` relaxation |
| Queue-ready violations | The same count on the order the player could queue first, before any AI refinement |
| Same lead back to back | Adjacent queue entries with the same lead artist. Also counted: those at a boundary between two continuations, and those "avoidable" because another lead artist was still eligible |
| Same lead within three | The lead artist also leads one of the three songs before, when not already counted as back to back |
| Identity repeats | The same work adjacent, or anywhere earlier in the sitting |
| Artist coverage | Distinct lead artists per continuation; distinct lead artists per sitting as a share of its songs |
| Discovery share | Songs whose lead artist the listener has never played, over songs queued. The allocation is `DISCOVERY_SHARE` (familiar 0.05, balanced 0.2, discover 0.45) times the continuation's length, rounded. A continuation is "over the allocation" only when familiar candidates were available |
| Familiar-first | Slot 1 is not a discovery, counted where a familiar eligible candidate existed. Slot 2 is tracked for continuations of four or more |
| Pickers, fallbacks, relaxations | Who chose the final order (`local`, `ai`), `plan.fallback`, and the relaxations the engine reported |
| Style continuity | For `dj-session` and `folk-session`: the share of a continuation in the sitting's style, and how many continuations held at least ⌈0.8 n⌉ in style |
| Retrieval depth | Queued songs only an album page or an artist page could supply, over songs queued |
| Declared-taste agreement | For fixtures with `tasteTargets`: the share of each continuation inside the declared taste |
| Pushed-away artists | Queued songs led by an artist with a sitting pull of −0.6 or below, where another lead was eligible |
| Served | For `served`: the share of queued songs Home had shown |
| Seed-memory replay | On `warm`: plan from the seed, plan again from the same seed, count how many of the first three songs repeat. Once without a commit, once with `commit` called on the first plan |
| Latency | `performance.now()` around the entry point, to the queueable order ("queue-ready") and to the final order. p50 and p95 |

### Latency conditions

Each runs sequentially on one fixture with salt 7. A run that hits its cap is "cut off": its time is a floor, not a measurement.

| Condition | What is scripted | Runs | Cap |
| --- | --- | ---: | ---: |
| `instant-sources` | Every source answers at once, AI off | 24 | 12 s |
| `slow-sources` | Every catalogue call answers after 140–900 ms | 8 | 12 s |
| `source-throws` | The seed-suggestions source fails at once | 8 | 12 s |
| `source-never-settles` | A search never settles, pool of 26 | 5 | 10 s |
| `source-never-settles-large-pool` | Later searches never settle, pool of 104 | 5 | 10 s |
| `source-never-settles-urgent` | The same with `deadlineMs: 3_500`; current pipeline only | 5 | 6 s |
| `ai-slow` | The DJ answers after 2 s | 8 | 8 s |
| `ai-never` | The DJ never answers | 5 | 8 s |

## The gate

`recs.eval.ts` has three assertions and no thresholds on any other metric:

| Assertion | Protects |
| --- | --- |
| `quality.overall.batches > 0` | The run produced data |
| `deterministic === true` | The second fixture (`warm`) with salt 1, run again at the end, queues the same song ids. Without this, no two reports are comparable |
| `hardViolations === 0` | No hard rule was broken. Skipped when `EVAL_ASSERT` is `0`, which the runner sets for a baseline: a baseline is measured, not judged |

`eval-recs.mjs` exits 0 when the current pipeline's test run exits 0, and 1 otherwise. It also exits 1 when a run writes no report. Everything else in the summary is a measurement to read, not a gate.

## Reading the output

`node scripts/eval-recs.mjs --no-baseline` on the working tree prints:

```
 Test Files  1 passed (1)
      Tests  1 passed (1)

── summary ──────────────────────────────────────────
fixtures 1.3.0 · harness 1.2.0 · 12 salts · entry planNextSongs · alg 9.0.0/1.3.0
continuations 1308 · songs 5760 · empty 84 · reproducible yes
hard-rule violations 0 (queue-ready 0) · off-language under a relaxed lock 54
same lead back to back 36 (batch boundary 12, avoidable 24) · identity repeats 0
distinct artists per continuation 3.944 · discovery 35.8 % against an allocation of 17.9 %
familiar-first compliance 95.4 % · pickers {"local":1236,"ai":72} · fallbacks {"none":1308}
queue-ready latency p50 12.3 ms · p95 196 ms (instant sources, 1308 samples)
declared-taste agreement 48.3 % (synthetic) · album/artist-page songs 1.5 % · pushed-away artists queued 0 · served songs queued 37.5 %
asked again from one song: 3 of 3 opening songs repeat without memory, 1 with it
style continuity 75.0 % of a DJ / folk stretch in its style · 72/72 stretches held four of five
```

Every line except the latency line is identical from run to run on the same tree. Latency moves with the machine's load: the figures above were taken on a machine that was busy with other work. Read latency as an order of magnitude, and compare two trees only when they were measured in the same run.

The per-condition latency of the same run (`recs-eval.md`, "Latency"):

| Condition | Queue-ready p50 / p95 | Final order p50 / p95 | Songs |
| --- | ---: | ---: | ---: |
| `instant-sources` | 31.6 / 416 ms | same | 5 |
| `slow-sources` | 967 / 2 929 ms | same | 5 |
| `source-throws` | 31.8 / 242 ms | same | 5 |
| `source-never-settles` | 7 435 / 7 500 ms | same | 5 |
| `source-never-settles-large-pool` | 56.7 / 2 083 ms | same | 5 |
| `source-never-settles-urgent` | 2 804 / 2 805 ms | same | 5 |
| `ai-slow` | 3.9 / 7.8 ms | 2 005 / 2 009 ms | 5 |
| `ai-never` | 2.8 / 5.7 ms | cut off at 8 s | 5 |

Two things to take from it. A slow or silent AI does not delay the queue: the local order is ready in milliseconds and the refinement arrives later or never. A catalogue source that never settles costs the whole deadline when the rest of the pool is small, and almost nothing when the pool is large.

### When the gate fails

| Symptom | Where to look |
| --- | --- |
| `hard-rule violations` above 0 | `quality.overall.violations` in the JSON names the kind; `quality.perFixture` names the fixture. If `queue-ready` is 0 and the total is not, the AI refinement let the song in |
| `reproducible NO` | `determinismDiff` in the JSON holds both orders. Look for state that survives `localStorage.clear()` (module-level memory), an unfrozen clock, or randomness not derived from the salt |
| `No report written for <pipeline>` | The harness did not start. The runner prints the test output; an unresolved import in the tree under test is the usual cause |
| A metric moved and no gate failed | Compare `quality.perFixture` between the two JSON files to find which fixture moved, then read that fixture's notes |

## Changing the engine safely

1. Run the unit tests next to the module you changed (`npx vitest run src/services/recommendation`), see [testing.md](testing.md).
2. Run the evaluation on the tree before the change and on the tree after it, and compare. The gate must pass; then read every line of the summary for movement you did not intend.
3. If the change touches repetition, novelty or any memory of what was already shown, run the acceptance test below. The evaluation cannot see it.
4. If a fixture or a metric definition changes, bump `EVAL_FIXTURES_VERSION` or `EVAL_HARNESS_VERSION` and do not compare across the bump.

### Comparing with a baseline

`--baseline <commit>` extracts that commit's `frontend/src` into `eval/.cache/` and runs the same harness, fixtures, mocks and rules against it, with `@` pointing at the extracted tree. The working tree is not touched. The summary gains one `baseline <commit>:` line and `recs-eval.md` puts both pipelines side by side.

The baseline commit must contain `frontend/src/services/recommendation/recMemory.ts`. The harness imports that module dynamically, and the import is resolved when the file is transformed, so a tree without it fails before any test runs. Check with `git cat-file -e <commit>:frontend/src/services/recommendation/recMemory.ts`. The built-in default, `7c4e2f5`, does not contain it: a plain `node scripts/eval-recs.mjs` measures the working tree, then exits 1 with `No report written for baseline`. Pass `--baseline` with a recent commit, or run `--no-baseline --out <dir>` on each tree and compare the two JSON files. A run with a recent release commit as the baseline completes and exits 0:

```
baseline b008f26: hard violations 0 · identity repeats 0 · same lead back to back 9 (avoidable 6) · style continuity 75.0 % (18/18 held)
```

(That line is from a `--quick` run, so its counts are a quarter of a full run's.)

### The repetition acceptance test

`frontend/src/services/recommendation/repetition.accept.test.ts` is the tool for a repetition change. It is part of the normal unit-test run.

```sh
cd frontend
npx vitest run src/services/recommendation/repetition.accept.test.ts
```

It mocks a catalogue of 120 playable songs in one language by 24 artists, so a missed target can never be blamed on a dry pool, and calls `planNextSongs` for 20 songs at a time, committing each plan as the player does. It asserts:

| Assertion | Threshold |
| --- | --- |
| The fixture has enough distinct songs | at least 100 |
| A second 20-song continuation from the same seed introduces new songs | at least 12 of 20 |
| The same after a reload (module state dropped, `vinax.recs.exposure.v1` kept in `localStorage`) | at least 12 of 20 |
| No identity repeats inside one continuation | 0, over three salts |
| Artists stay varied | no lead back to back; no artist above ⌈n / 3⌉; at least 6 artists |
| A muted language, a hidden song and a hidden artist never ship | 0 |
| An exhausted pool returns fewer songs rather than breaking a restriction | fewer than 20 |
| What the queue surfaced is in the exposure ledger for other surfaces, and what Home showed costs the queue | fewer than 10 of those songs come back |
| A liked song may come back | cooling is lifted |
| Familiar, Balanced and Discover differ on the same pool | Familiar's discovery share below 0.1 |
| A single-artist request is respected | diversity does not override it |

Why the evaluation cannot do this job. Its repetition metrics saturate, for three reasons found in the code:

- Every continuation is called with the whole queue as `excludeIds` and `excludeKeys` (`eval/lib/run.ts`, `runSession`). A repeat inside a sitting is excluded by the caller, so "identity repeats" reads 0 whatever the engine remembers.
- `applyFixture` clears `localStorage`, where the exposure ledger lives, before every continuation of every fixture except `memory`. A plan is committed only in `memory` and in one arm of the seed-memory replay. In the other 27 fixtures the engine always plans with an empty ledger.
- Each sitting starts from the fixture's state, and no metric compares the songs of one sitting with the songs of another. The harness contains no reference to the ledger at all.

The one number that touches the subject is the seed-memory replay (the opening three songs, on one fixture). It cannot tell a build that brings back most of a 20-song list from one that does not.

## What the evaluation cannot see

- **Enjoyment.** A queue can break no rule, space every artist and ship in a millisecond, and still be a bad half hour of music. "Declared-taste agreement" is agreement with what a synthetic fixture says, nothing more.
- **Repetition across sittings and surfaces.** See above.
- **A real catalogue.** Pools hold 6 to 104 songs. Discovery share, artist coverage and empty continuations are bounded by pool size as much as by policy.
- **A real AI.** The DJ is scripted; `ai` picker counts describe the scripts. The classifier never answers, so mood, energy and tempo are only what a fixture provides.
- **The profile updater and the player's admission gate.** The harness measures the engine's output; the player filters once more before queuing.
- **Field latency.** One machine, one process, no network.

### Real outcomes

Evidence about real listening comes only from two consent-gated events in `services/analytics/recTelemetry.ts`, sent for listeners who opted in. What they contain is in [data-and-privacy.md](data-and-privacy.md).

| Event | When | `meta` |
| --- | --- | --- |
| `rec_served` | Once per automatic continuation, when its final picker is known | `alg`, `picker`, `fallback`, `latencyMs`, `n`, `discovery`, `languageViolations`, `distinctArtists`, `relaxed`, `exp` |
| `rec_outcome` | When a playback of an automatic entry ends | `alg`, `picker`, `pos`, `heardSec`, `durationSec`, `outcome` (`complete`, `skip`, `early_skip`, `partial`), `liked`, `exp` |

Neither event carries a song or a song id. The client rate-limits them: a bucket of `REC_BUCKET` (12), one more every `REC_REFILL_MS` (5 s), an outbox of `REC_OUTBOX_CAP` (40), `REC_SESSION_CAP` (400) per session.

`features/experiments/recExperiment.ts` ties an outcome to an experiment. Assignment is the pure hash `pickVariant` (`features/experiments/useExperiment.ts`, mirrored by `backend/worker/functions/_lib/experiments.ts`). `decideRecVariant(key)` is the decision point: it returns the variant and records that the continuation being planned depends on it. `claimExposure` turns pending decisions into the `exp` map of a continuation that was actually served, and `exposureOf` returns it for that continuation's outcomes. A decision for a plan that is never served expires after `PENDING_DECISION_TTL_MS` (60 s). An owner tuning rollout rides in the same map as `rec-config`. Call `decideRecVariant` in every arm, control included, while planning: only an exposed control is a comparison group.

### Reading an A/B result

1. Pick one primary metric before looking, for example completion rate: `complete ÷ (complete + skip + early_skip + partial)`.
2. Aggregate per device first, then compare the arms' distributions of device rates (a bootstrap over devices). Rows from one listener are not independent.
3. Report an interval, not a point. For a rate over `n` independent trials use the Wilson score interval.
4. Have enough samples. For a completion rate near 40 %, at 95 % confidence and 80 % power:

   | Difference to detect | Outcomes per arm | Roughly, listeners per arm |
   | --- | ---: | ---: |
   | 5 points | ≈ 1 500 | ≈ 100 |
   | 3 points | ≈ 4 200 | ≈ 300 |
   | 1 point | ≈ 37 000 | ≈ 2 500 |

5. Fix the reading date in advance.
6. Remember who is in the data: only listeners who turned telemetry on.
7. Watch the guardrails in `rec_served`: `n`, `picker`, `relaxed`, `latencyMs`, `distinctArtists`.
8. Rate limiting loses rows from the most restless sittings first, which biases skip rates down. Do not read tiny differences.

## History that still matters

- **The default baseline is the 7.1 release (`7c4e2f5`).** The harness was built to compare 7.2 with it, which is why the runner still falls back to `recommendNextSongs` and why a baseline run does not assert the rules. That commit can no longer be loaded (see [Comparing with a baseline](#comparing-with-a-baseline)). Audit and progress records from that time are in [history/progress-7.2.md](history/progress-7.2.md), [history/audit-7.2.md](history/audit-7.2.md) and [history/audit-9.1.md](history/audit-9.1.md).
- **Discovery share runs at about twice the allocation** (35.8 % against 17.9 %) and has since the first comparison. The sequencer's budget holds only while familiar candidates remain, and with these small artist sets late continuations exhaust them. 72 continuations were over the allocation with familiar songs still available; the engine reports `discovery-share` as a relaxation.
- **Same lead back to back is 36, of which 24 avoidable, and same lead within three is 1 806.** Neither is gated. The fixtures have small artist sets, so late continuations have few leads to choose from; the engine reports `artist-spacing` (234 continuations) and `artist-cap` (48) as relaxations. Treat these as numbers to hold steady across a change, not as targets met.
- **The seed-memory replay reads "3 of 3 without memory".** That is the expected value, not a defect: without a commit the engine has nothing to remember. The number to watch is the committed one.
- **The algorithm version string in the summary** (`alg 9.0.0/1.3.0`) is the engine's own (`algorithmVersion()`), not the app's release number.
