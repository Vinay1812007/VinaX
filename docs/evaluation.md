# Evaluation

This document covers how VinaX's next-song selection is measured: the offline
evaluation harness (`frontend/eval/`), what its fixtures contain, how the
current pipeline was compared against the 7.1 baseline, the numbers from that
comparison, the two opt-in telemetry events that record what really happened,
and how to read an A/B result from them without fooling yourself.

**What these numbers are.** Rule compliance, diversity mechanics, fallback
behaviour and latency, measured against synthetic fixtures with the network
replaced. **What they are not.** Evidence that anyone enjoys the songs. A
queue can break no rule, space every artist, open with a familiar song, ship
in a millisecond — and still be a bad half hour of music. Nothing in this
document is a quality claim about the listening; only real listeners answer
that, and the only honest source for it is the opt-in telemetry described
under [Reading an A/B result](#reading-an-ab-result).

## The harness

```sh
cd frontend
node scripts/eval-recs.mjs                 # current + the 7.1 baseline, JSON + Markdown reports
node scripts/eval-recs.mjs --no-baseline   # the current pipeline only
node scripts/eval-recs.mjs --quick         # 3 salts, 3 latency runs (a smoke run)
node scripts/eval-recs.mjs --report-only   # rebuild the reports from the last run
npx vitest run --config eval/vitest.config.ts   # the harness alone, current pipeline
```

Reports land in `frontend/eval/reports/` (git-ignored): `recs-eval.json` (both
pipelines, every metric) and `recs-eval.md` (the tables below). The default
unit-test gate does not collect any of this: `npx vitest run` looks for
`*.test.ts` / `*.spec.ts`, and every file here is `*.eval.ts` or plain
support code, so the evaluation only ever runs on demand. `vite.config.ts` is
untouched.

| Piece | Where |
| --- | --- |
| Fixtures (versioned, deterministic) | `eval/fixtures/` — `EVAL_FIXTURES_VERSION` |
| The measuring stick (rules, identity, repetition) | `eval/lib/rules.ts` |
| The sitting simulator and the pipeline adapters | `eval/lib/run.ts` |
| Aggregation (percentiles, shares, counts) | `eval/lib/metrics.ts` |
| The network-facing mocks | `eval/lib/mocks.ts` |
| The run itself | `eval/recs.eval.ts` — `EVAL_HARNESS_VERSION` |
| Runner and report writer | `frontend/scripts/eval-recs.mjs` |

### What is real and what is replaced

The harness runs the REAL pipeline through its public entry points —
`planNextSongs` (7.2) or `recommendNextSongs` (the baseline's only one) — so
it keeps working when the modules underneath them change. Four
network-facing modules are replaced, and nothing else:

| Replaced | By |
| --- | --- |
| `@/services/api` (the catalogue client) | The fixture's pool, with scripted failures, delays and never-settling calls |
| `@/services/ai/recommendations` | A classifier that never answers, and the re-rank the real client returns when the curator is unreachable |
| `@/services/ai/dj` | A scripted DJ: unavailable, timing out, answering with an order of its own, or proposing songs that break the rules |
| `@/services/queryClient` | No cached owner flags |

Mocking one level below `candidates.ts` is deliberate: the candidate stage
carries rules of its own (soft mutes, Kid mode, blocked songs, junk titles),
so replacing the whole module would have taken those out of the measurement.
Filtering, scoring, diversity, sequencing, validation and the stores are the
app's own code at the commit under test.

### One sitting, four continuations

Each run simulates what the player does: plan five songs, queue them, let the
sitting play down to the song with one left after it, then plan the next five
with everything queued excluded — four times, for a queue of twenty. The seed
for each continuation is the song the player would be playing at that moment
(`queue[length − 2]`), and the songs before it count as played, so the taste
history, the recency window and the "known artists" set grow as they would in
a real sitting.

Every fixture runs with twelve fixed salts (the app's per-session rotation
seed). The clock is frozen at one instant, fixtures never read it, and the
harness re-runs one fixture at the end to prove the same salt still yields the
same songs; the report carries `deterministic: true` (or both orders, when it
does not).

### The measuring stick

The rules are written out again in `eval/lib/rules.ts` from
[recommendations.md](recommendations.md) rather than imported from the
pipeline, so the evaluation cannot agree with a bug by sharing its code. The
one exception is song identity (`canonicalKey` / `recordingKey` in
`services/recommendation/identityCore.ts`), which is a published contract
shared with the Worker and pinned by `shared/identity-vectors.json`: both
pipelines are measured with the CURRENT contract, so "another cut of a song
played minutes ago" means the same thing on both sides.

| Metric | Definition |
| --- | --- |
| Hard-rule violation | A queued song that is explicit under Kid mode, in a muted language, by a hidden or soft-muted artist, hidden by id, another cut of one of the last twenty plays, or a second cut of a song already in the queue |
| Off-language under the lock | A queued song in a known language other than the seed's. Counted as a violation only when at least three in-language candidates were still available; otherwise it is the documented relaxation |
| The mix rules (8.1) | For a fixture with `queueLanguages: 'mix'` there is no lock. A queued song in a known language outside the listener's languages (pinned, played, the seed's; muted ones removed) is `off-language`; a song in another language in slot 1 or 2 is `language-opening`; two off-lead songs back to back are `language-run`. All three count as hard violations |
| Repetition | The same lead artist back to back (the boundary between two continuations included), the same lead within three songs, the same identity twice in a sitting |
| Artist coverage | Distinct lead artists per continuation, and per sitting as a share of its songs |
| Discovery share | Songs whose lead artist this listener has never played, against the mode's allocation (5 / 20 / 45 % plus the sitting's appetite). The pipeline's own count (`plan.discoveryIds`) is recorded next to it |
| Familiar-first | Slot 1 (and slot 2 of a stretch of four or more) is not a discovery, counted only where a familiar, eligible candidate existed |
| Fallback | `plan.fallback` and the refinement's outcome: `deadline`, `ai_timeout`, `ai_unavailable`, `ai_rejected`, `error`, or none |
| Queue-ready latency | Wall time from the call to a list the player could queue. For 7.2 that is the local plan; for the baseline it is the whole call, AI included |

## The fixtures (version 1.0.0)

Twenty fixtures (nineteen at 7.2; 8.1 added `mixed-queue`), each a pure
function of the timestamp the harness passes in. Songs, titles and artists
are fictional, written in Telugu, Hindi, Tamil, Punjabi, Malayalam and Latin
scripts.

| Fixture | What it is for |
| --- | --- |
| `cold` | A cold listener: no profile, no history, no favourites |
| `warm` | A full profile with the AI DJ answering with an order of its own |
| `familiar` | Familiar mode: a 5 % discovery allocation, known ground as a source |
| `discover` | Discover mode (Hindi), AI unavailable |
| `tamil` | Tamil, the DJ times out |
| `punjabi` | Punjabi, AI off |
| `malayalam` | Malayalam, Familiar mode |
| `mixed` | A listener who plays Hindi, Telugu and Tamil, with a mixed pool and a DJ that proposes an off-language song, an explicit one and a hidden artist |
| `mixed-queue` | 8.1: the same listener with Queue languages on "Your languages" (`queueLanguages: 'mix'`): a Hindi seed, Hindi, Telugu and Tamil pinned, and a pool that also holds Punjabi, which the listener never chose. The queue may change language within the mix rules; Punjabi must stay out |
| `prefs` | Mixed preferences: a quiet cluster and a loud one in one pool |
| `skips` | A skip streak of three, with the skipped songs in the pool |
| `partial-outage` | The seed-suggestions source throws; the searches answer |
| `offline` | Every source throws |
| `sparse` | No energy, tempo, mood, genre, year or duration |
| `versions` | One work in six cuts, plus a zero-width joiner, a Latin accent and a featured credit |
| `small-catalogue` | Six candidates for a sitting that wants twenty |
| `kid-mode` | Kid mode with explicit songs in the pool and a DJ proposing more |
| `muted-languages` | Hindi and English muted, with a pool full of them |
| `hidden-artists` | Two hidden artists (one in an Indic script, one Latin) and two hidden songs |
| `soft-muted` | Two lead artists under "show fewer like this" |

Two more fixtures serve the latency conditions: the warm Telugu listener, and
the same listener with a production-sized pool (104 songs).

## Baseline versus current

**Method.** The baseline is VinaX 7.1 at commit `7c4e2f5` — the whole
`frontend/src` of that commit, extracted with `git archive` into
`eval/.cache/` (git-ignored) and run by the same harness, against the same
fixtures, with the same mocks and the same measuring stick. The only
difference between the two runs is where the `@` alias points
(`EVAL_SRC`). Nothing of the baseline is committed, and the working tree is
never touched. The baseline has no `planNextSongs`, so the harness calls
`recommendNextSongs`, which is that version's whole continuation — AI
included — in one call.

Run on `19ee9ec` (7.2, with the concurrently merged retrieval, ranking and
validation work), fixtures 1.0.0, harness 1.0.0, 12 salts per fixture. The
numbers below predate the `mixed-queue` fixture: both pipelines were measured
on the nineteen fixtures of that time, and a context without `queueLanguages`
keeps the lock, so the baseline and the current pipeline speak one language
in every row.

| Metric | Baseline `7c4e2f5` | Current `19ee9ec` | Samples |
| --- | ---: | ---: | --- |
| Continuations planned | 828 | 816 | 19 fixtures × 12 salts × ≤ 4 |
| Songs queued | 3 492 | 3 420 | — |
| Empty continuations | 72 | 84 | of the above |
| **Hard-rule violations** | **72** | **0** | 3 420 songs |
| …in the order queued first (before any AI refinement) | 72 | 0 | — |
| — hidden artist | 48 | 0 | `mixed`, `hidden-artists` |
| — another cut of a recent play | 12 | 0 | `versions` |
| — a second cut of a queued song | 12 | 0 | `versions` |
| — explicit under Kid mode / muted language / soft mute | 0 | 0 | `kid-mode`, `muted-languages`, `soft-muted` |
| Off-language songs under a relaxed lock (allowed) | 48 | 48 | `mixed` |
| Same lead artist back to back | 59 | 60 | 3 420 hand-offs |
| …of those, at the boundary between two continuations | 36 | 48 | 816 boundaries |
| Same lead artist within three songs | 1 173 | 1 098 | — |
| Same identity back to back | 12 | 0 | — |
| A song identity heard twice in one sitting | 24 | 0 | 228 sittings |
| Distinct lead artists per continuation | 3.77 | 3.87 | of five |
| Distinct lead artists per sitting | 50.2 % | 50.6 % | of its songs |
| Discovery share | 38.0 % | 38.4 % | — |
| …the mode's allocation | 16.8 % | 17.6 % | — |
| Continuations over that allocation with familiar songs free | 64 | 60 | — |
| Familiar-first compliance (slot 1) | 89.5 % | 93.0 % | 716 / 684 opportunities |
| Queue-ready latency p50 / p95 (instant sources) | 0.8 / 1.5 ms | 0.8 / 1.5 ms | 828 / 816 |

Every row above except the last is identical between runs — the harness proves
that on each run. The latency row is not: it moves by a few tenths of a
millisecond with the machine's load (a later run of the same commit read
1.0 / 2.8 ms). Read it as an order of magnitude, not a constant.

| Relaxations reported to the caller | not exposed | `language-lock` ×12 | — |

Reading the table:

- **The 72 fewer songs are the 72 rule breaks.** The current pipeline ships
  fewer songs in exactly three fixtures — `mixed` (216 vs 240), `versions`
  (120 vs 144) and `hidden-artists` (180 vs 204) — and exactly those
  differences are songs the baseline queued in breach of a rule. The extra
  twelve empty continuations are `hidden-artists` running out of pool once
  its hidden artists are actually excluded.
- **The hidden-artist failures are the Indic-script bug.** At 7.1 the
  never-play key folded a name written in an Indic script to the empty
  string, so those artists could not be hidden at all; 7.2's Unicode-safe
  identity fixed it. The `versions` failures are the same story for titles: a
  zero-width joiner, a Latin accent and a "feat." credit each used to make
  one work look like two.
- **Nothing else regressed into a violation.** Kid mode, muted languages and
  soft mutes were already airtight at 7.1 under these fixtures, and the AI's
  rule-breaking proposals (`mixed`, `kid-mode`) never reached a queue in
  either version.
- **One thing got worse:** same-artist hand-offs at the boundary between two
  continuations, 36 → 48. See the findings below.
- **Latency is unchanged when nothing is wrong**, and completely different
  when something is. See the next table.

### Latency

Wall time from the call to a list the player could queue ("queue-ready") and
to the final order ("final"), measured with `performance.now()` around the
public entry point. Sequential runs, one fixture, one salt; the AI and the
sources are scripted per run. A run marked "cut off" hit the harness cap for
that condition: its latency is a floor, not a measurement.

| Condition | Runs | Pool | Cap | Baseline queue-ready p50 / p95 | Current queue-ready p50 / p95 | Current final order p50 / p95 | Songs (base → cur) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Every source answers at once, AI off | 24 | 26 | 12 s | 1.3 / 1.6 ms | 1.4 / 2.2 ms | same | 5 → 5 |
| Every call answers after 140–900 ms | 8 | 26 | 12 s | 908 / 910 ms | 429 / 950 ms | same | 5 → 5 |
| The seed-suggestions source throws | 8 | 26 | 12 s | 2.6 / 6.2 ms | 2.7 / 4.9 ms | same | 5 → 5 |
| A search never settles, small pool | 5 | 26 | 10 s | never returns (cut off ×5) | 7 302 / 7 307 ms | same | 0 → 0 |
| A search never settles, production-sized pool | 5 | 104 | 10 s | never returns (cut off ×5) | 6.9 / 2 543 ms | same | 0 → 5 |
| A search never settles, urgent deadline | 5 | 26 | 6 s | no deadline option | 2 801 / 2 802 ms | same | — → 0 |
| The AI DJ answers after 2 s | 8 | 26 | 8 s | 2 011 / 2 021 ms | 2.9 / 9.6 ms | 2 005 / 2 013 ms | 5 → 5 |
| The AI DJ never answers | 5 | 26 | 8 s | nothing within 8 s (cut off ×5) | 7.8 / 11.4 ms | cut off at 8 s | 0 → 5 |

The two rows that matter most for a listener waiting at the end of a queue:

- **A slow or dead AI no longer delays anything.** At 7.1 the continuation
  *was* the AI call: a DJ answering in 2 s made the listener wait 2 s, and a
  DJ that never answered held the whole continuation (its client's own leash
  is 30 s). At 7.2 the on-device order is ready in single-digit milliseconds
  and the AI is a refinement that may replace the automatic tail later, or
  never.
- **A never-settling catalogue source still costs the whole deadline when
  the rest of the pool is small.** `planNextSongs` calls
  `generateNextCandidates` without the new gather options, so the gather's own
  hard deadline (8 s) lands after the engine's budget (8 s − 700 ms), the
  plan ships empty and the player falls back to its reserve. With a
  production-sized pool the gather's soft deadline does its job and the plan
  is ready in milliseconds. At 7.1 the same failure hung the continuation
  outright.

### Findings worth acting on

None of these are blockers, and none of them are mine to fix (the engine and
the player are owned elsewhere), so they are recorded here:

1. **Same artist across a continuation boundary (48 of 816).** Validation
   forbids the same lead artist back to back and counts the seed as the
   previous song — but the player seeds a continuation with the song it is
   *playing* (`queue[index]`), while the new songs are appended after the
   *last* song in the queue. Nothing checks that pair. It shows up wherever a
   few artists dominate a pool, and it got more common at 7.2 because an
   applied AI refinement rewrites the tail without that check either.
2. **The gather's deadlines are not wired to the engine's.** Passing
   `hardDeadlineMs` (and a smaller `minPool`) from `planNextSongs` would turn
   the empty plan above into a short one.
3. **The discovery share runs above the mode's allocation** (38 % against
   17.6 %) in both versions. The sequencer's budget only holds while
   non-discovery candidates remain, and the validated reserve tops a short
   stretch up from the ranked pool without one. In 60 of 816 continuations
   familiar, eligible songs were still available when the budget was
   exceeded. With these fixtures' small artist sets this is mostly pool
   exhaustion, not a policy failure — but it is worth a look with a real
   catalogue.

### Limitations

- Synthetic pools of 6–104 songs; a real catalogue returns hundreds, and
  several metrics (discovery share, artist coverage, empty continuations)
  are bounded by pool size as much as by policy.
- The AI is scripted. "AI rejected" and "AI applied" counts describe the
  scripts, not how a real model behaves.
- The classifier never answers, so mood, energy and tempo are only what the
  fixture provides.
- Latency is measured on one machine, in one process, with the network
  removed. It is the cost of the on-device work plus the scripted waits,
  not a field measurement.
- The harness measures the engine's output, not the player's admission gate,
  which filters once more before anything is queued.
- The baseline comparison is faithful for the recommendation pipeline and its
  stores, because the whole `frontend/src` of the baseline commit is used.
  It is not a comparison of the app as a whole.

## Real outcomes: what the events record

Two consent-gated events (`services/analytics/recTelemetry.ts`) record what
actually happened, for listeners who opted in. Exactly what they contain is
in [data-and-privacy.md](data-and-privacy.md#what-leaves-the-device-and-when)
and on the Privacy page; the shape matters here because it is what an A/B
result can be read from.

| Event | When | `meta` |
| --- | --- | --- |
| `rec_served` | Once per automatic continuation, when its final picker is known | `alg`, `picker` (`local` / `ai` / `reserve`), `fallback`, `latencyMs` (queue-ready), `n`, `discovery`, `languageViolations`, `distinctArtists`, `relaxed`, `exp` |
| `rec_outcome` | When a playback instance of an automatic entry ends | `alg`, `picker`, `pos`, `heardSec`, `durationSec`, `outcome` (`complete` / `skip` / `early_skip` / `partial`), `liked`, `exp` |

`outcome` uses the playback session's own thresholds — heard seconds, never
the playhead — so it agrees with what the taste profile learned from the same
play. Failed playback reports nothing. Neither event carries a song, a song
id, a queue or a batch number.

## Experiments: assignment, then exposure

`features/experiments/recExperiment.ts` is the recommendation half of the
existing A/B machinery:

| Call | What it does |
| --- | --- |
| `loadRecExperiments()` | Reads the anonymous `/api/experiments` config once per session |
| `recVariant(key)` | This device's variant, or `'control'` when it is not in the experiment. A pure read: it exposes nothing |
| `activeRecVariants()` | Every recommendation experiment this device is assigned to, plus an applied owner tuning rollout |
| `decideRecVariant(key)` | **The decision point.** Returns the variant and records that the continuation being planned depends on it |
| `claimExposure(batch, …)` | Called when a continuation is actually served: the pending decisions become that continuation's `exp` |
| `exposureOf(batch)` | The `exp` map of a served continuation, for the outcomes of its songs |

Assignment is the existing pure hash (`pickVariant`, FNV-1a over
`installId:key`, mirrored by the Worker's `functions/_lib/experiments.ts`), so
no identifier is created and nothing extra is stored. The owner's
recommendation-tuning rollout rides in the same map as `rec-config`
(its variant name, or `all` for a rollout to everyone).

**Exposure is not assignment.** A device assigned to a variant that never
changed anything it heard tells you nothing. `exp` is non-empty only when a
decision point read the variant *and* the continuation it shaped was actually
served. Two rules follow for whoever wires a treatment into the engine:

1. Call `decideRecVariant(key)` in **every** arm, control included, at the
   point where the treatment would change (or, under control, would have
   changed) the plan. Only the exposed control is a comparison group.
2. Call it while planning the continuation, not at app start. A decision for
   a plan that was discarded expires after a minute and exposes nobody.

No experiment is wired into the engine yet, so every `exp` map today is empty
or carries only an owner rollout, and **no A/B result exists to report.**

## Reading an A/B result

Once a treatment does call `decideRecVariant`, this is how to read what comes
back. Do the arithmetic per variant, over `rec_outcome` rows whose `exp` names
the experiment.

1. **Pick one primary metric before looking.** The obvious one is the
   completion rate: `complete ÷ (complete + skip + early_skip + partial)`.
   `early_skip` (a flip-past before the play counted) and `skip` move together
   but mean different things; decide up front which you are reading, and keep
   `liked` and the served metrics (`latencyMs`, `discovery`,
   `languageViolations`) as secondary, never as a substitute when the primary
   disappoints.
2. **Aggregate per listener first.** One listener produces dozens of
   outcomes, and their plays are not independent draws. Compute each device's
   rate, then compare the two arms' distributions of device rates
   (a bootstrap over devices: resample devices with replacement 10 000 times,
   take the 2.5th and 97.5th percentile of the difference of means). Treating
   every row as an independent trial makes the interval far too narrow and
   turns noise into a result.
3. **Report an interval, never a point.** For a rate over `n` independent
   trials the Wilson score interval is the right one at these sizes:

   ```
   centre = (p̂ + z²/2n) / (1 + z²/n)
   half   = z/(1 + z²/n) × √( p̂(1−p̂)/n + z²/4n² )      z = 1.96 for 95 %
   ```

   Two arms differ only when their intervals are read together — overlapping
   intervals are not a decision, and non-overlapping ones on clustered data
   are not either (see 2).
4. **Have enough samples before you look at all.** For a completion rate
   near 40 %, at 95 % confidence and 80 % power:

   | Difference you want to detect | Outcomes per arm | Roughly, listeners per arm |
   | --- | ---: | ---: |
   | 5 points (40 % → 45 %) | ≈ 1 500 | ≈ 100 |
   | 3 points (40 % → 43 %) | ≈ 4 200 | ≈ 300 |
   | 1 point (40 % → 41 %) | ≈ 37 000 | ≈ 2 500 |

   The listener column assumes a listener contributes about fifteen outcomes
   and inflates for clustering; it is a planning number, not a guarantee.
   Below these sizes, say "not enough data" — that is a finding too.
5. **Fix the reading date in advance.** Checking every day until the
   interval clears zero manufactures a result. One planned read, or a
   sequential method chosen beforehand.
6. **Remember who is in the data.** Telemetry is opt-in and off by default.
   The listeners in it are the ones who turned it on; they may skew by
   region, by device, by how the app was introduced to them. An A/B result
   from this data is an estimate for *those* listeners, and the honest write-
   up says so. It also cannot be checked against "everyone who used VinaX",
   because nothing about the others is collected — by design.
7. **Watch the guardrails.** A treatment that raises completions by shipping
   fewer songs (`n`), by leaning on the reserve (`picker: 'reserve'`), by
   relaxing the language lock (`relaxed`), by pushing latency up
   (`latencyMs`) or by narrowing artists (`distinctArtists`) has not made the
   queue better. Read those alongside the primary metric.
8. **Sampling loss is real.** The client rate-limits these events (a bucket
   of 12, one more every 5 s, an outbox of 40, 400 per session). A burst of
   skips can lose rows, and the loss is not random — it hits the most
   restless sittings hardest, which biases skip rates down. Do not read tiny
   differences; the size table above assumes the events arrived.

## Tests

The harness has no assertions about taste. It fails only when the run is not
reproducible, when it produces no data, or — for the current pipeline — when
a hard rule was broken (since 8.1 that includes the mix rules of
`mixed-queue`: a language outside the listener's, an off-lead opening, or two
changes of language in a row). The unit tests that pin the rules themselves live next
to the modules (see [testing.md](testing.md)); the telemetry and experiment
contracts are pinned by `services/analytics/recTelemetry.test.ts`,
`services/analytics/telemetry.test.ts` and
`features/experiments/recExperiment.test.ts`.
