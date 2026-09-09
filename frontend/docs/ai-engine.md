# VinaX Multi-Model AI Engine (v5.21.0)

The owner's multi-model mandate, implemented on the existing lane
architecture. Nothing was rewritten to add or retire an engine: features talk
to **lanes**, lanes pin **models**, and a central **registry** describes every
model VinaX can reach.

## Architecture

```
VinaX Frontend  (no keys, ever)
      ↓ POST /api/dj · /api/home · /api/playlist · /api/vinaxai · …
      ↓ GET  /api/aimodels   ← the live free-model menu for the two catalog keys
VinaX Worker (Cloudflare)
      ↓ lane router — functions/_lib/ai.ts
      ↓ chat() / gather() / moderate()
      ↓ per-attempt key + model + provider base
default inference base  /  fast external base  /  free-model marketplace
```

Every feature keeps a deterministic non-AI fallback: the player, home shelves
and queue all work with zero AI keys configured.

## The pieces

| Piece | File | What it is |
| --- | --- | --- |
| Model registry | `worker/functions/_lib/models.ts` | `AI_MODEL_REGISTRY`: every owner-listed model — capabilities, env key, latency/quality/cost class, fallbacks, health notes. `training_supported: false` on every entry (hosted inference only — no training pipeline exists, and none is claimed). |
| Lane router | `worker/functions/_lib/ai.ts` | 19 lanes over 18 keys; each lane = env key + pinned model + optional same-key secondary + cross-lane failover ladder + per-call deadline budget. |
| Free-model catalogs | `worker/functions/_lib/catalog.ts` | The two aggregator keys don't pin one model — their live catalogs are fetched from each provider's own `/models` list, filtered to chat-capable and zero-cost, cached 15 minutes, and served to the picker by `/api/aimodels`. |
| Adapters | `ai.ts` | `chat()` (JSON-mode aware, reasoning-off knobs per model family), `gather()` (parallel idea pools), `moderate()`. |
| Observability | `vinax_ai_events` (Supabase) + admin AI dashboards + AI Lab | model, ok, status, latency per call; the Lab benches every lane on its own key with no failover. |

## Routing table (v5.21.0 — the owner's 2026-09-09 key set)

| Lane | Env key | Model | Drives |
| --- | --- | --- | --- |
| dj | `VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B` | nemotron-3.5-lightning-30b-a3b | AI DJ, Smart Radio, queue; secondary: gpt-oss-20b |
| chat | `VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B` | nemotron-3.5-lightning-30b-a3b | Assistant, AI playlists; secondary: mistral-nemotron |
| deep | `VINAX_NVD_NEMOTRON_3_SUPER_120B_A12B` | nemotron-3-super-120b-a12b | Think button |
| fast | `VINAX_OAI_GPT_OSS_20B` | gpt-oss-20b | Quick tasks; secondary: lightning |
| scholar | `VINAX_GROQ_API_KEY` | **resolved live** from the free catalog | Music Q&A, live voice |
| router | `VINAX_OPENROUTER_API_KEY` | **resolved live** from the free catalog | The free-model marketplace seat |
| home | `VINAX_NVD_NEMOTRON_3_ULTRA_550B_A55B` | nemotron-3-ultra-550b | Premium backstop, always last |
| search | `VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING` | nemotron-3-nano-omni-30b-a3b-reasoning | Search-page expert |
| pro | `VINAX_DEEPSEEK_V4_PRO_0813` | deepseek-v4-pro-0813 | Ladder reserve |
| mini | `VINAX_MISTRAL_NEMOTRON` | mistral-nemotron | General ladder reserve |
| agent | `VINAX_KIMI_K3` | kimi-k3 | Wired, in no ladder (see below) |
| vision | `VINAX_MTA_LMA_3_2_11B_VSN_INT` | llama-3.2-11b-vision-instruct | Image understanding |
| vision90 | `VINAX_MTA_LMA_3_2_90B_VSN_INT` | llama-3.2-90b-vision-instruct | Deep image understanding |
| dsflash | `VINAX_DEEPSEEK_V4_FLASH_0731` | deepseek-v4-flash-0731 | Bench only |
| muse | `VINAX_MTA_MUSE_GLIMMER_30B` | muse-glimmer-30b | Bench only |
| rank | `VINAX_NVD_ISING_CALIBRATION_1_5_31B` | ising-calibration-1.5-31b | Bench only |
| laguna | `VINAX_POOLSIDE_LAGUNA_XS_2_1` | laguna-xs-2.1 | Bench only |
| diffusion | `VINAX_GGL_DIFFUSIONGEMMA_26B_A4B_IT` | diffusiongemma-26b-a4b-it | Bench only (text side) |
| gemma4 | `VINAX_GGL_GEMMA_4_31B_IT` | gemma-4-31b-it | Bench only |

General failover ladder: `chat → search → deep → fast → dj → scholar → mini →
pro → home`. The order comes from the post-rotation probe, not from intent:
lanes that actually answered go first, the two reserves that came back
unreachable sink below them, and the 550B home lane stays last because it
needed 25s for a 4-token ping. The vision lanes, the agent reserve, `router`
and every bench lane are **excluded** — an image model must never answer a DJ
JSON call, and a catalog lane has no fixed slug for the synchronous ladder to
trust.
Below the ladder: parse-validate → retry-in-plain-mode → deterministic
fallback (`fallbackSections`, catalog-pool shuffle floor, local recommender).
The player survives every AI being down.

## The two catalog keys

Sixteen keys sign exactly one engine each. Two do not:

- **scholar** opens its account's own catalog — the fast external base VinaX
  already used for music Q&A and live voice.
- **router** opens a marketplace of hundreds of community engines.

For both, `_lib/catalog.ts` asks the provider for its own model list and keeps
only what VinaX can honestly offer:

- **chat-capable only** — transcription, speech, embedding, moderation and
  image-output models ride different endpoints; listing them in a chat picker
  would hand the listener an engine that 404s.
- **free only** — on the marketplace that means the provider prices *both*
  prompt and completion at zero. An unparseable or missing price counts as
  paid, so an unknown-cost model is never offered and the key cannot quietly
  run up a bill.

**A catalog lane must never carry a fixed pin.** This is the lesson of
v5.23.0: both catalog lanes were pinned to a specific slug, the providers
retired those slugs, and every call to either lane answered `404` — the keys
were fine the whole time. The model is now resolved from the live free list
on every path that can await it (the assistant, the admin bench, health),
with a preference order matched as a *substring* so a re-published id still
resolves. When the provider offers nothing, the resolver returns `null` and
the caller reports the lane unavailable rather than guessing a slug.

`GET /api/aimodels` serves the two menus (slugs, labels, context sizes, and
the upstream's `prefix` — never a key). In VinaX AI, choosing one of those two
seats reveals a second list: **Model · free on this engine**. In the owner
console every row reads `<upstream> / <model>` so the provider a slug belongs
to is unambiguous while benching. The chosen slug rides the request, and the
Worker re-checks it against the same live free list before using it — a slug
that isn't currently listed is refused, not forwarded.

If a provider is unreachable the menu comes back empty and says so; the seat
still answers on its default engine. There is no stale hard-coded fallback
list, on purpose.

## Key rotation — what "verified" means now

Every secret was deleted and re-issued on 2026-09-09, so every probe result
from the previous key set was void. The registry was reset to
`verified: false` and re-earned from the first post-rotation sweep:

| Result | Lanes |
| --- | --- |
| Serving | chat/dj (0.63–3.9s), search (0.69s), deep (0.80s), muse (0.80s), laguna (0.65s), fast (1.2s), rank (1.2s), vision 11B (0.69s), gemma4 (8.3s), home (**25.1s**) |
| Key fine, model dead | scholar and router — both pinned to slugs the provider had retired; fixed by resolving live |
| Unreachable | pro, mini, vision90, dsflash, diffusion |
| Rate-limited | agent (HTTP 429 — the key authenticates; this is a quota state, not a dead model) |

Two things worth reading off that table. `muse-glimmer` and `laguna-xs` serve
under their new vendor prefixes — the slugs that used to 404 are alive again.
And the marketplace's free list carries several engines that are unreachable
on the default base, so it is a genuine fallback for them, not just a
curiosity.

Retired with the old keys: `minimax-m3`, `gpt-oss-120b`,
`nemotron-3-nano-30b-a3b`, `ising-calibration-1-35b-a3b` and the old
`nemotron-super-49b` secondary. Arrived with the new ones:
`mistral-nemotron`, the two vision engines on keys of their own, and the
marketplace key. `muse-glimmer` and `laguna-xs` were re-published under new
vendor prefixes. Retired **engine ids** are remapped client- and server-side,
so a listener whose saved pick names one keeps a working seat.

`worker/__tests__/laneRegistry.test.ts` fails the build if a lane ever points
at a secret the registry doesn't list, if a listed secret becomes
unreachable by any lane, or if a retired name creeps back into the wiring.

## Co-work rounds

`gatherDetailed()` runs the same prompt across several lanes in parallel and
returns every non-empty answer **with the engine that produced it**. The AI DJ
and the Home Screen Builder both use it: a panel proposes, one strong lane
curates. Latency is the slowest panellist, never the sum, so a participant
costs tokens and not wall-clock.

| Feature | Panel | Curator |
| --- | --- | --- |
| AI DJ / smart queue | `fast`, `search`, `scholar` | `dj` |
| Home Screen Builder | `scholar`, `search`, `chat` | `dj` |

**`soloLadder` is what makes it a panel.** `chat()` normally walks the shared
failover ladder, so three lanes whose own engines are cold all degrade onto
the same healthy sibling and hand back three near-identical pools — one
engine, billed three times, presented as a panel. With `soloLadder` each
participant is held to its own key: it contributes its own perspective or it
abstains. `worker/__tests__/cowork.test.ts` pins both behaviours, including a
test that demonstrates the collapse when the flag is off.

Both endpoints return a `panel` receipt — lane, model, latency, and how many
picks each engine added that no other panellist had. That last number is the
engine's *marginal* contribution, so a panellist that adds nothing round after
round can be dropped on evidence rather than taste.

## Honesty ledger (what this is NOT)

- **No model was trained, fine-tuned, evaluated offline, or deployed as a
  custom version.** Everything is hosted inference. The registry hard-codes
  `training_supported: false`; flipping it requires an actual pipeline.
- `moderate()` returns `{ unchecked: true }` for every text — no safety model
  is reachable since those keys were retired, and the caller decides fail-open
  vs fail-closed. It never pretends an unchecked text was checked.
- Real image *generation* is not wired. The diffusion bench lane serves text
  through chat-completions only; never fake a picture through it.
- `kimi-k3` ran hot-and-cold on the retired key (one 16.6s answer, one 18s
  hang). It is wired as the `agent` lane, drives no feature and sits in no
  ladder until it is re-probed stable.
- Weighted feedback, taste profiling, A/B experiments and event telemetry
  already exist in the app (on-device profile, `/api/events`,
  `/api/experiments`) and were not duplicated.

## Adding / replacing a model (the whole point)

1. Add the env secret in Cloudflare; add its entry to `AI_MODEL_REGISTRY`.
2. Probe it live on its own key from the admin **AI Lab** — the Lab takes a
   model override, so a candidate slug is verified serving before it is pinned.
3. If healthy: pin it to a lane in `LANE_MODEL`/`LANE_ENV` (or as a same-key
   `LANE_SECONDARY`), and update both `.env.example` files.
4. Features don't change — they name lanes, not models.
