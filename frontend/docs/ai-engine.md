# VinaX Multi-Model AI Engine (v5.4.0)

The owner's multi-model mandate (2026-08-29), implemented incrementally on the
existing lane architecture. Nothing was rewritten; features still talk to
**lanes**, lanes pin **models**, and a central **registry** now describes every
model VinaX can reach.

## Architecture

```
VinaX Frontend  (no keys, ever)
      ↓ POST /api/dj · /api/home · /api/playlist · /api/assistant · …
VinaX Worker (Cloudflare)
      ↓ lane router — functions/_lib/ai.ts
      ↓ chat() / gather() / embed() / moderate()
      ↓ per-attempt key + model + provider base
NVIDIA NIM  /  Groq
```

Every feature keeps a deterministic non-AI fallback: the player, home shelves
and queue all work with zero AI keys configured.

## The pieces

| Piece | File | What it is |
| --- | --- | --- |
| Model registry | `worker/functions/_lib/models.ts` | `AI_MODEL_REGISTRY`: all 26 owner-listed models — capabilities, env key, latency/quality/cost class, fallbacks, live-probe health notes. `training_supported: false` on every entry (hosted inference only — no training pipeline exists, and none is claimed). |
| Lane router | `worker/functions/_lib/ai.ts` | 13 lanes; each = env key + pinned model + optional same-key secondary + cross-lane failover ladder + per-call deadline budget. |
| Adapters | `ai.ts` | `chat()` (JSON-mode aware, reasoning-off knobs per model family), `gather()` (parallel idea pools), `embed()` (2048-dim vectors, new), `moderate()` (safety pair, new). |
| Observability | `vinax_ai_events` (Supabase) + admin AI dashboards | model, ok, status, latency per call — unchanged, now covering the new pins. |

## Routing table (as deployed — every pin probed live on its own key)

| Lane | Env key | Model | Probe | Drives |
| --- | --- | --- | --- | --- |
| dj | VINAX_NEMOTRON_3_5_LIGHTNING_30B_A3B | nemotron-3.5-lightning-30b-a3b | 0.80s warm | AI DJ, Smart Radio, queue; secondary: gpt-oss-20b (same key) |
| chat | VINAX_DEEPSEEK_V4_FLASH | gpt-oss-20b | proven | Assistant, AI playlists |
| deep | VINAX_NEMOTRON_SUPER | nemotron-3-super-120b-a12b | 0.55s | Think button; secondary: the old 49b |
| fast | VINAX_CHATGPT_20_B | gpt-oss-20b | proven | Quick tasks |
| scholar | VINAX_GROQ_API_KEY | llama-3.3-70b-versatile (Groq) | ~0.12s TTFB | Music Q&A, live voice |
| home | VINAX_NEMOTRON_ULTRA | nemotron-3-ultra-550b | slow | Premium backstop, always last |
| search | VINAX_NVIDIA_NEMOTRON_3_NANO_30B_A3B | nemotron-3-nano-30b-a3b | proven | Search-page expert |
| pro (new) | VINAX_DEEPSEEK_V4_PRO | deepseek-v4-pro-0813 | 0.59s warm | Ladder reserve |
| mini (new) | VINAX_MINIMAX_M3 | minimax-m3 | 0.41s warm | Ladder reserve |
| translate (new) | VINAX_RIVA_TRANSLATE_4B_INSTRUCT_V2 | riva-translate-v2 | 0.93s | Translation (helper ready) |
| safety (new) | VINAX_NEMOTRON_3_5_CONTENT_SAFETY | nemotron-3.5-content-safety | 0.52s | `moderate()` primary |
| guard (new) | VINAX_LLAMA_3_1_NEMOTRON_SAFETY_GUARD_8B_V3 | safety-guard-8b-v3 | 0.53s | `moderate()` second opinion |
| agent (new) | VINAX_KIMI_K3 | kimi-k3 | UNSTABLE | Wired, drives nothing (see below) |
| (embed) | VINAX_NEMOTRON_3_EMBED_1B | nemotron-3-embed-1b | 0.38s, 2048-dim | `embed()` helper |

General failover ladder: `fast → chat → dj → mini → pro → deep → scholar →
search → home`. Translate/safety/guard/agent are **excluded** — a translation
model must never answer a DJ JSON call. Below the ladder: parse-validate →
retry-in-plain-mode → deterministic fallback (`fallbackSections`, catalog-pool
shuffle floor, local recommender). The player survives every AI being down.

## What the live probes found (2026-08-29, temp /api/modelcheck, since removed)

Serving and now pinned: lightning, super-120b, deepseek-pro, minimax-m3,
riva-v2, content-safety, safety-guard, embed-1b.

Not pinned, with reasons recorded in the registry:

- **kimi-k3** — served once (16.6s cold) then hung ≥18s. Wired as the `agent`
  lane but drives no feature and sits in no ladder until it stabilizes.
- **deepseek-v4-flash-0731**, **gemma-4-31b-it** — hang consistently (18s+, no
  response). Their env keys still work; the flash key keeps serving
  gpt-oss-20b for the chat lane.
- **ising-calibration** family — 410 Gone (retired upstream). Deterministic
  on-device ranking stays authoritative.
- **muse-glimmer-30b, nemotron-voicechat, laguna-xs-2.1, riva-v1_1** — 404 on
  the NIM catalog under every slug tried.
- **synthetic-video-detector, active-speaker-detection, streampetr** — not
  chat models; no adapter or product surface exists. Inventory only.

## Honesty ledger (what this is NOT)

- **No model was trained, fine-tuned, evaluated offline, or deployed as a
  custom version.** Everything is hosted inference. The registry hard-codes
  `training_supported: false`; flipping it requires an actual pipeline.
- `embed()` is wired but no feature consumes it yet — semantic search needs a
  vector store (e.g. pgvector on the existing Supabase) as its own project.
- `moderate()` is wired but not yet called from the chat path; wiring it into
  `/api/vinaxai` is the natural next increment.
- Weighted feedback, taste profiling, A/B experiments and event telemetry
  already exist in the app (on-device profile, `/api/events`,
  `/api/experiments`) and were not duplicated.

## Adding / replacing a model (the whole point)

1. Add the env secret in Cloudflare; add its entry to `AI_MODEL_REGISTRY`.
2. Probe it live on its own key (re-create a temp modelcheck if needed —
   pattern in git history).
3. If healthy: pin it to a lane in `LANE_MODEL`/`LANE_ENV` (or as a same-key
   `LANE_SECONDARY`), update `.env.example`.
4. Features don't change — they name lanes, not models.
