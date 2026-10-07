# AI in VinaX

This document covers the AI layer of VinaX for developers: the four provider keys, lanes and failover, every AI route's contract, the VinaX AI chat page (streaming, chat styles, attachments) and what each surface does when AI is unavailable. The recommendation and AI-music routes are in [ai-music.md](ai-music.md); the listener's view of the chat is in [user-guide/vinax-ai.md](user-guide/vinax-ai.md); the feature-by-feature audit is in [ai-assistant-matrix.md](ai-assistant-matrix.md).

Backend paths are relative to `backend/worker/functions/`; frontend paths are relative to `frontend/src/`.

## Principles

| Rule | How the code enforces it |
| --- | --- |
| No key reaches the browser. | Keys are Worker secrets read only through `providerKey()` in `_lib/ai.ts`. Responses name the model that answered (published name, slug, provider id), never a key or a host. |
| Features name lanes, not models. | A route asks for a lane (`dj`, `scholar`, …). The model and key behind a lane are tables in `_lib/ai.ts`. |
| AI proposes; code decides. | Every AI answer is parsed, clipped and validated on the server, then validated again on the device. |
| Every AI feature has a non-AI result. | See [When every provider is down](#when-every-provider-is-down). |
| Model output is untrusted. | Display text with markup or links is rejected; song suggestions are resolved against the catalogue. |
| No live web access. | No route searches or fetches the web, and models that browse on their own (`WEB_BROWSING_SLUGS` in `_lib/catalog.ts`) are left out of every list. The chat prompt says so, and tells the model to flag answers that may be out of date. |

## Providers and keys

One secret per provider. `providerKey(env, provider)` reads the primary name and falls back to the older name while the primary is unset (`PROVIDER_ENV`, `PROVIDER_ENV_FALLBACK`); `providerKeySource()` reports which one is in use.

| Provider id | Label | Secret | Older name still read | Lane used for a picked model (`PROVIDER_LANE`) |
| --- | --- | --- | --- | --- |
| `nvidia` | NVIDIA | `NVIDIA_API_KEY` | `VINAX_NVIDIA_API_KEY` | `chat` |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` | `VINAX_OPENROUTER_API_KEY` | `router` |
| `groq` | Groq | `GROQ_API_KEY` | `VINAX_GROQ_API_KEY` | `scholar` |
| `gemini` | Gemini | `GEMINI_API_KEY` | `VINAX_GGL_GEMINI_API_KEY` | `maestro` |

Any one key is enough for the chat to work. With none, AI routes answer `503 ai_not_configured` and every surface uses its on-device path.

## Lanes and failover

`_lib/ai.ts` defines 13 lanes. `LANE_PROVIDER` maps each to a provider, `LANE_MODEL` to its pinned model and `LANE_SECONDARY` to a same-key second model.

| Lane | Provider | Role |
| --- | --- | --- |
| `maestro` | Gemini | Flagship: leads the DJ, AI Playlist, ranking and the Home builder when its key is set |
| `chat` | NVIDIA | Everyday assistant chat |
| `dj` | NVIDIA | Creative generation |
| `deep` | NVIDIA | Deep reasoning |
| `fast` | NVIDIA | Quick tasks and candidate gathering |
| `search` | NVIDIA | The Search-page music expert |
| `home` | NVIDIA | Large, slow reserve; last in latency-sensitive ladders |
| `pro`, `mini` | NVIDIA | Ladder reserves |
| `vision`, `vision90` | NVIDIA | Image understanding (one image per request) |
| `scholar` | Groq | Music knowledge, lyric tools, live voice, small JSON tasks |
| `router` | OpenRouter | Zero-cost models; the model comes from the live catalogue, the pin is a last resort |

**One call.** `chat(env, messages, opts)` asks `laneAttempts()` for an ordered list: the lane's own model, its same-key secondary (unless `skipSecondary`), then the cross-lane ladder. The default ladder (`defaultLadder()`) is

`chat → search → deep → fast → dj → scholar → mini → pro → maestro → home`

A route may pass its own ladder. Lanes without a key produce no attempt. Each attempt carries its own endpoint, because hops cross provider hosts. An error status, a timeout, a network error, an empty 200 or a refusal by the caller's `accept()` check moves to the next attempt. The result is `{ content, model, keyRole, usage }` or an error (`ChatError`: `not_configured`, `unreachable`, `failed`, `invalid_output`, or an owner block). `gather()` runs one prompt on several lanes in parallel.

**The `router` lane is not on the default ladder.** Only the chat route adds it; see [the Auto ladder](#the-auto-ladder). Routes that call `chat()` with the default ladder do not reach the OpenRouter key.

### Cooldowns

A failed attempt can rest its lane+model, or its whole lane (`cooldownForFailure`, `noteLaneFailure`, `markCooldown`). The table lives in module memory per isolate and is shared by `chat()`, the streaming chat route and the catalogue. A resting pair is skipped without a round trip; when every pair is resting they are all asked anyway.

| Upstream answer | Scope | Rest |
| --- | --- | --- |
| 429 | lane+model | What the provider asks for (`cooldownFor`) |
| 429 whose body says the free quota is zero (`isZeroFreeQuota`) | lane+model | 24 hours (`NOT_FREE_COOLDOWN_MS`) |
| 404, 410, or a 400 that says the model is gone | lane+model | 1 hour |
| 401, 402 | the whole lane | 10 minutes |
| 403 | lane+model | 10 minutes |
| 5xx | lane+model | 30 seconds |

Timeouts and plain 400s earn no cooldown.

## `GET /api/aimodels` — the live model catalogue

`_lib/catalog.ts` asks each configured provider for its own model list, keeps the chat-capable free models, and drops models that browse the web. There is no hard-coded fallback menu.

```
{ fetchedAt,
  providers: [{ id, label, configured,
                models: [{ id, name, maker, context, vision }],
                media:  [{ id, name, maker, kind, voices? }],   // kind: image | speech | transcription | music | embedding
                tools:  [{ id: 'code_execution', name, … }] }],
  features: { image, speech, transcription, music, code } }
```

Always four providers, in the order `nvidia`, `openrouter`, `groq`, `gemini`. `id` is the exact slug to send back; `vision` marks a model that reads images. A missing secret or an unreachable provider gives `configured: false` or an empty list. A chat or media request that names a model is checked against the same live list and refused with `400 unknown_model` when it is not there.

## `POST /api/vinaxai` — the chat

**Request** `{ messages, mode?, provider?, model?, images?, tools?, taste?, profile?, place? }`, plus project context and memory lines when the chat has them.

- `mode` — `auto`, `model` (the listener's pick: `provider` + an exact slug), or an internal seat other features send (`voice`, `expert`, `translator`). `requestMode()` maps anything else to a default.
- `images` — inline `data:image/` URLs, 6 MB in total.
- `tools` — only `['code_execution']` is honoured (`requestTools`).
- The body cap is 12 MB.

**History budget.** After the per-turn clipping, `trimHistory()` drops the oldest turns until the thread fits `HISTORY_CHAR_BUDGET` (120,000 characters). At least one turn is always kept, and a trimmed thread never opens on an assistant reply whose question was dropped. The client trims earlier: `features/ai/chat/longThread.ts` sends recent turns verbatim and replaces older ones with one context turn.

### The Auto ladder

1. A seat lane is chosen: the pick's provider lane for `mode: 'model'`; for Auto, `pickAutoMode()` reads the question's shape, and the flagship lane leads when `flagshipReady()`.
2. `laneAttempts(env, seatLane, seatDefault)` builds the plan: the seat's model, its secondary, then the default ladder above. For the `scholar` and `router` seats the lead model is the live catalogue default (`catalogDefaultModel`).
3. **The OpenRouter lane (11.0).** When `OPENROUTER_API_KEY` is set and the plan has no `router` attempt, one is inserted just ahead of the `home` attempt — a late fallback before the slow reserve. When there is no `home` attempt it goes at the end, which makes it the lead when OpenRouter is the only key. Its model is the live catalogue default, with the `router` pin as the last resort.
4. A picked model goes first. On Auto with code execution requested, a code-capable model leads: the flagship if it is already first, otherwise the best `gpt-oss` model Groq lists (`codeExecutionModels`).
5. Pairs that are cooling down are removed, unless that would empty the plan. An empty plan answers `503 ai_not_configured`.

Time limits: 40 s to get response headers from some engine (22 s for `expert` and `voice`), then 90 s for the stream.

### Vision

A turn with images walks `visionLadder()` instead: the `vision` seat, then `vision90`, then the Gemini flagship and any catalogue model flagged `vision`. A turn with more than one image asks Gemini and the catalogue models first. A picked model that reads images goes in front. The two NVIDIA vision seats accept one image per request, so `singleImageFor()` sends them only the newest image; every other engine gets the full set. Without the NVIDIA key a photo is still read if the Gemini key or a vision-flagged catalogue model is available.

### Code execution

A model runs code only when its provider lists the tool for it (`attemptRunsCode`): Gemini, and the Groq models that support the provider's code interpreter. The code runs in the provider's sandbox, never in the Worker. An attempt that refuses the tool with a 400 is asked again without it. A pick that cannot run code answers without it. `meta.tools` is `['code_execution']` when the answering model had the tool.

### Status codes

| Status | Body | When |
| --- | --- | --- |
| 400 | `bad_request` | Unreadable or empty body, no usable message |
| 400 | `unknown_model` | The picked provider + slug is not on the live list |
| 413 | `too_large` / `image_too_large` | Body over 12 MB / images over 6 MB |
| 429 | rate-limit answer from `_lib/ratelimit.ts` | This client sent too many requests |
| 429 | `{ error: 'upstream', status: 429 }` + `Retry-After` | The last engine asked answered 429. The header is the provider's value capped at 60 s, or 5 s when it sent none. |
| 500 | `{ error: 'upstream', status }` | The last engine answered any other error. Deliberately not 502. |
| 500 | `{ error: 'exception', message: 'internal_error' }` | An unexpected error in the handler |
| 503 | `ai_not_configured` | No attempt has a key |
| 503 | `ai_disabled` / `ai_over_budget` | The owner's controls refused the call |
| 503 | `engine_unreachable` | No engine returned headers in time |

The other routes that map "every engine is rate-limited" to 429 are listed with their contracts below. Only `/api/vinaxai` sets a `Retry-After` header on that answer.

### Stream events

A success is a server-sent event stream, one JSON object per `data:` frame.

| Frame | Meaning |
| --- | --- |
| `{ meta: { model, modelId, provider, mode, tools? } }` | Published name, slug and provider of the model answering, and the requested mode. Sent again when a failover hop changes the model. |
| `{ delta: "text" }` | The next piece of the reply |
| `{ done: true }` | The end |
| `{ done: true, truncated: true }` | The reply was cut short |

- **Reasoning gate.** The start of each upstream stream is buffered until it is clear whether it opens with `<think>`. Reasoning is never forwarded; only what follows the closing tag is.
- **Unclosed reasoning.** A stream that ends inside `<think>` is discarded and the next engine is asked (logged as `unclosed_think_fallback`; an empty stream is `empty_stream_fallback`). If no engine produces an answer and the only text was unclosed reasoning, the stream ends with `done` + `truncated` and no text.
- **Truncation.** A stream cut after some text arrived ends with `truncated: true`. The client then appends "This answer was cut short — ask me to continue."
- **Cancellation.** When the listener disconnects or presses Stop, the response stream's `cancel()` cancels the upstream reader, so the provider read stops too.

## Media routes

Each route sits behind its owner switch, a rate limit and a body cap, and validates a pick against the live list. A route with nothing to serve answers `503 not_configured` (`reason: 'no_key' | 'no_free_model'`).

| Route | Request | Answer |
| --- | --- | --- |
| `POST /api/image` | `{ prompt, provider?, model? }` | `{ image, model, modelId, provider }`, `image` a `data:image/` URL |
| `GET /api/voices` | — | The voice list, with `providers: [{ id, label, models: [{ id, name, voices }] }]` |
| `POST /api/tts` | `{ text, provider?, model?, voice? }` | Audio. `400 text_required`, `413 too_large`, `502 unreachable`, `503` |
| `POST /api/transcribe` | `{ audio, mime?, provider?, model?, language? }` | `{ text, model, modelId, provider }` |
| `POST /api/music` | `{ prompt, provider?, model? }` | `{ audio, mime, model, modelId, provider }` |

**Default speech (11.0).** A `/api/tts` request that names no provider used to need the Groq key. It now falls to any provider with a free speech model, and answers `503 not_configured` only when none can speak.

`features` in `/api/aimodels` tells the app which of these to offer; **Create image** and **Create music clip** appear in the composer only when their kind is on.

## The chat page

`pages/VinaXAIPage.tsx` renders `/VinaXAI` outside the main app layout and orchestrates the parts in `features/ai/chat/`:

| Module | Owns |
| --- | --- |
| `models.ts`, `ModelMenu.tsx`, `useModelCatalog.ts`, `placeMenu.ts`, `ProviderLogo.tsx` | The model menu: Auto, recent models, then the four providers |
| `Composer.tsx`, `CreateBar.tsx`, `Connectors.tsx`, `../connectors.ts` | Text box, attachments, the + menu, connectors (Run code among them), Create image / Create music clip |
| `MessageList.tsx`, `Message.tsx`, `MediaCard.tsx`, `EmptyState.tsx`, `starters.ts` | The conversation, file chips, the greeting and starters |
| `buildChatRequest.ts`, `longThread.ts`, `streamClient.ts`, `streamReducer.ts`, `endpoints.ts` | The request and the event stream |
| `chatStyle.ts`, `ChatStyleScope.tsx` | Chat styles |
| `Sidebar.tsx`, `ProjectSheet.tsx`, `MemorySection.tsx`, `SettingsDialog.tsx` | History, projects, memory, settings (tabs: General, Replies, Voice, Data, Shortcuts) |
| `storage.ts` | Chats on the device (`vinax_ai_chats_v1`), export and import |
| `musicCommands.ts`, `useDictation.ts`, `useServerDictation.ts`, `useLiveVoice.ts`, `liveVoiceStore.ts` | On-device music commands, dictation, live voice |

Rendering lives in `components/ai/` (`RichContent.tsx`, `tokenize.ts`, `ChartBlock.tsx`, `SongPick.tsx`). Supporting modules in `features/ai/`: `attachments.ts`, `pdfText.ts`, `projects.ts`, `memory.ts`, `savedPrompts.ts`, `slashCommands.ts`, `readAloud.ts`, `artifacts/`.

### What the client does with each failure

`streamClient.ts` turns a refused request into a `StreamFailure` (`failureFromResponse`) and one line (`failureLine`).

| Kind | Trigger | Line shown | Next step offered |
| --- | --- | --- | --- |
| `offline` | No text arrived and the browser reports offline | "You’re offline — reconnect and ask again." | Retry |
| `busy` | 429 | "That was a lot of messages at once — give it a moment, then try again." | Retry |
| `unavailable` | Any other status (500, 502, 503 without a known code) | "The assistant paused — please try again." | Retry |
| `disabled` | `ai_disabled`, `ai_not_configured` | "VinaX AI is switched off right now — the rest of the app works as usual." | — |
| `over_budget` | `ai_over_budget` | "VinaX AI has reached its limit for today — please try again later." | — |
| `bad_model` | `unknown_model` | "That model is no longer available — switched to Auto." | The chat switches to Auto |
| `too_large` | 413, `too_large`, `image_too_large` | "That picture or file is too large to send — try a smaller one." | Edit message |
| `rejected` | Any other 400 | "That message couldn’t be sent as it is — try rewording it or removing an attachment." | Edit message |

`busy` and `unavailable` are re-asked once automatically when no text has arrived: after 2.5 s for `busy`, 1.2 s for `unavailable`. `needsEdit()` is true for `too_large` and `rejected`, where **Edit message** replaces Retry because the same message would be refused again. A reply interrupted by a page reload is restored as "No reply — try again" (`storage.ts`). A failure line is never sent back to the model.

### Chat styles

The chat restyles itself to the family of the model in use. `chatStyle.ts` is the single source:

- `CHAT_STYLE_IDS` — nine ids: `vinax`, `mono`, `spectrum`, `paper`, `loop`, `void`, `forge`, `circuit`, `deep`.
- `CHAT_STYLES` — each entry has `id`, `label`, `description`, `audience`, the maker `families` it serves and a `layout` record.
- `makerFamily(slug, maker, provider)` matches the slug and maker against patterns; `styleForFamily()` maps a family to a style and falls back to `deep`.

| Style | Families | Style | Families |
| --- | --- | --- | --- |
| `vinax` | none — Auto | `void` | `xai` |
| `mono` | `openai` | `forge` | `mistral` |
| `spectrum` | `google` | `circuit` | `nvidia` |
| `paper` | `anthropic` | `deep` | `deepseek`, `qwen`, `moonshot`, `microsoft`, `cohere`, `other` |
| `loop` | `meta` | | |

**Layout record.** `ChatLayout` has ten keys (`CHAT_LAYOUT_KEYS`): `composer` (`card`, `pill`, `bar`, `terminal`), `dock`, `greeting` (`center`, `left`), `starters` (`grid`, `chips`, `row`, `list`), `user`, `assistant`, `avatar`, `modelChip`, `density` (`roomy`, `regular`, `compact`) and `engine` (`chip`, `tag`).

**Attributes.** `ChatStyleScope.tsx` sets `data-chat-style="<id>"` on the chat's `.ai-scope` element, and `layoutAttrs(id)` produces one `data-cs-*` attribute per layout key (`layoutAttrName`; `modelChip` is written as `data-cs-chip`). `styles/ai-styles.css` holds one block per style under `.ai-root[data-chat-style='<id>']` and `.ai-scope[data-chat-style='<id>']`, and the layout rules key on the `data-cs-*` attributes.

**The setting.** `ChatStylePref` is `'match'` (default) or a style id, stored under `vinax.ai.chatStyle` (`CHAT_STYLE_KEY`) and included in backups (`features/settings/backup.ts`). `resolveChatStyle(pref, choice, providers)` gives the style to show. The picker is the **Chat style** radio group in chat settings → General: "Match the model", "Always VinaX", then one option per style, each with a drawn miniature.

**Adding a style.** Add the id to `CHAT_STYLE_IDS`; add its `CHAT_STYLES` entry with `families` and a complete `layout`; add its colour block and any layout rules to `styles/ai-styles.css`. The picker lists it without further work. `chatStyle.test.ts` reads the stylesheet and fails when a style has no block. Styles are original designs: no other product's name, logo or wording belongs in them.

### Attachments

`features/ai/attachments.ts` accepts up to 24 files per message (`MAX_ATTACHMENTS`), of which up to 6 images (`MAX_IMAGES`).

- **Images** — 4 MB each and 5.5 MB of image data together, kept under the Worker's 6 MB limit. They travel in `images`.
- **Text and code files** — 2 MB each. Folders and drag-and-drop are supported (`droppedFiles`).
- **PDF** — up to 8 MB. `pdfText.ts` extracts the text layer on the device, without a library, up to 120,000 characters. The outcome is one of `ok`, `no-text` (a scan or images only), `unreadable`, `encrypted`, `too-large`, `failed`, and each has its own message.

`foldAttachments()` appends each non-image file's text to the message as `--- File: <path> ---` followed by the text; a shortened file is marked `(excerpt)`. Send waits until every attached file has been read (`prepareAttachments`). In the conversation the files show as compact chips with **Show contents** / **Hide contents** (`Message.tsx`). Images are stripped before a chat is saved.

## When every provider is down

| Surface | What the listener gets |
| --- | --- |
| VinaX AI chat | A JSON error before the stream. The client re-asks once, then shows the line for the failure kind above. |
| Queue continuation, Home re-rank, "Trending for you" | The on-device order |
| Classifier metadata | Scores from catalogue metadata and title-based mood inference; cached classifications still apply |
| Playlist from a description | A playlist built from catalogue searches, ranked on the device |
| Natural-language search | On-device vectors |
| DJ voice | The device's speech engine announces the song |

Three kinds of switch turn AI off on purpose: the listener's settings, the owner's feature flags, and the owner's backend AI controls (below, and [admin-console.md](admin-console.md)).

## Tests

- Worker, in `backend/worker/__tests__/`: `aiChatAudit.test.ts` and `aiAuditSweep.test.ts` (the 11.0 chat fixes: OpenRouter on the ladder, vision, 429, history budget, unclosed reasoning, cancellation, default speech), `aiFallback.test.ts`, `aiControls.test.ts`, `aiMedia.test.ts`, `aiOps.test.ts`, `aiProviderAdmin.test.ts`, `aiTokens.test.ts`, `aicost.test.ts`, `catalog.test.ts`.
- Chat page, beside the code in `features/ai/chat/`: `streamClient.test.ts`, `streamReducer.test.ts`, `buildChatRequest.test.ts`, `chatStyle.test.ts`, `longThread.test.ts`, `models.test.ts`, `ModelMenu.test.tsx`, `Composer.test.tsx`, `Message.test.tsx`, `media.test.ts`, `storage.test.ts`; in `features/ai/`: `attachments.test.ts`, `pdfText.test.ts`, `memory.test.ts`, `projects.test.ts`; in `components/ai/`: `tokenize.test.ts`, `RichContent.test.tsx`.
- Browser: `frontend/e2e/vinax-ai.spec.ts`.

## Observability

`logAiEvent` (`_lib/ai.ts`) writes one row to `vinax_ai_events` per AI request: feature, model (as `model @lane`, or `model @provider` on the media routes), ok, status, error, client (`web` or `app`), latency, and token counts when the provider reports them. It does nothing when the analytics database is not configured.

`_lib/laneHealth.ts` aggregates those rows per lane for the owner console: calls, successes, p50 / p95 / p99 latency, failover hops, empty streams, and 401 / 403 / 429 responses. See [admin-console.md](admin-console.md).

Two things are not in that table. `/api/embed` does not log its calls, so embeddings appear in neither lane health nor the spend caps. `/api/curate` keeps its own 60-second in-memory note per lane and moves a lane that just failed, or answered slower than 6 s, to the back of the order.

## Rate limits and body caps

A request over its limit gets `429 { error: 'rate_limited', retryAfter }` with a `Retry-After` header, before any other work.

Each route has a per-isolate token bucket (`_lib/ratelimit.ts`). When the Worker has the Rate Limiting bindings, `rateLimitAsync` also asks a counter shared by every isolate in one edge location, on the smallest tier (`RATE_LIMIT_10`, `_30`, `_60`, `_300` requests per 60 s) at or above the bucket's capacity plus one minute of refill. A missing or failing binding fails open. Limits are per location, never global, and permissive by design; [operations.md](operations.md#rate-limiting) has the tiers and the guarantees.

Bodies are read through a capped reader (`_lib/body.ts`, `readJsonCapped`); a body over the cap answers `413 too_large`. A KB below is 1,000 bytes.

| Route | Bucket (burst / refill per minute) | Body cap |
| --- | --- | --- |
| `POST /api/dj` | 15 / 8 | 48 KB |
| `POST /api/curate` | 12 / 6 | 32 KB |
| `POST /api/playlist` | 6 / 3 | 32 KB |
| `POST /api/embed` | 30 / 30 | 110 KB |
| `POST /api/vinaxai` | 20 / 10 | 12 MB, of which 6 MB of inline images (`413 image_too_large`) |
| `POST /api/assistant` | 20 / 10 | 64 KB |
| `POST /api/lyrics-tools` | 12 / 6 | No byte cap; 120 lines of 200 characters are kept |
| `POST /api/image` | 6 / 3 | 8 KB |
| `POST /api/tts` | 30 / 30 | 16 KB |
| `POST /api/transcribe` | 30 / 30 | 8 MB |
| `POST /api/music` | 3 / 3 | 4 KB |
| `GET /api/voices` | 12 / 12 (bucket only, no shared counter) | — |
| `GET /api/aimodels` | 12 / 12 | — |

## The owner's switches and spend caps

The owner publishes one record, `vinax_config` key `ai-controls`, and the Worker enforces it. It holds an emergency stop, one switch per feature, and a daily token cap and a daily cost cap.

The features are `dj`, `curate-metadata`, `curate-ranking`, `curate-home`, `curate-shelves`, `playlist`, `vinaxai`, `assistant`, `tts`, `lyrics`, `image`, `embed`, `search`, `transcribe` and `music` (`AI_FEATURES` in `_lib/ai.ts`). A feature is on unless its value is exactly `false`.

Every route calls `aiGate(env, feature)` before it contacts a provider, and `chat()` checks again before its first attempt, so a switch flipped mid-request still takes effect.

- A refused call answers `503 { error: 'ai_disabled' }` (the stop, or the feature's switch) or `503 { error: 'ai_over_budget' }` (a cap). Clients treat both as "AI is unavailable here" and use their on-device path; see [When every provider is down](#when-every-provider-is-down).
- The refusal is logged to `vinax_ai_events` with that error and no model, so it is told apart from a provider failure.
- Each isolate caches the record for 30 s. A failed read is logged and fails open, except that an emergency stop already in the cache keeps applying until the cached copy is 60 s old.
- Caps are compared with today's (UTC) token sums from `vinax_ai_events`, priced with the `ai-prices` table and cached for 60 s. Tokens on an unpriced model, and calls whose provider reported no usage, make the cost a lower bound (`costKnown: false`). If the usage read fails, caps are not enforced until it recovers. Caps are therefore soft by up to one cache period plus the calls already in flight.

`aiControlsStatus(env)` returns the same picture for the owner console. The procedures are in [operations.md](operations.md#ai-controls-emergency-stop-feature-switches-and-spend-caps).

## `POST /api/dj` — the AI DJ

The client sends a listening context and a pool of real songs it has already gathered, filtered and ranked. The DJ picks and orders songs from that pool and, when asked, proposes a few from outside it.

**Request**

```
{ context: {...}, pool: [{ id?, title, artist, language?, album?, year?, mood?, energy?, tempo?, known? }],
  count?, discover?, maxDiscover?, wantSegues? }
```

- `pool` keeps entries with a title and an artist, 60 at most. Fewer than 3 answers `400 pool_too_small`; an empty context answers `400 empty_context`.
- `count` is clamped to 1–20 (default 8). `maxDiscover` is clamped to 0–6 (default 4) and is 0 unless `discover` is `true`.
- `wantSegues: false` asks for no spoken segues. The client sends `true` only when the DJ voice is on.
- `context` is built by `buildDjContext` (`services/ai/dj.ts`). It carries `currentLanguage`, `languagePolicy`, `queueLanguages` and, optionally, `arcShape`, `listenerGoal`, `tuneInstruction` and `style`. `style` may be `dj`, `folk` or `devotional`; any other value is removed before the model sees it (`sanitizeStyle`).

**Response**

```
200 { intro, songs: [{ songId, title, artist, reason, segue, confidence, fromPool }], model }
400 bad_request | empty_context | pool_too_small     413 too_large
429 { error, status }      every engine is rate-limited (see below)
500 { error, status }      no usable set for any other reason
503 ai_not_configured | ai_disabled | ai_over_budget
```

**How the server answers.** The whole request has 26 s.

1. With discovery on and a pool under 12 songs, the `maestro` and `scholar` lanes each pitch extra candidates in parallel (4.5 s, optional); up to 30 new ones are kept.
2. With a `style` and discovery on, the Worker also searches the catalogue for the style's phrase (`stylePhrase`, 4 s, optional). Those real songs are waited for at most 1 s after step 1 (`EXTRAS_WAIT_MS`), so they never hold the set up.
3. The set is written by `maestro` when its key is set (12 s first attempt, then `scholar → dj → fast → chat → home`), otherwise by `scholar` (9 s, then `dj → fast → chat → home`). Later attempts get 10 s. The lane's secondary model is skipped.
4. An answer from which `parsePicks` keeps no pick is refused and the next engine is asked inside the same 26 s. With a style, the prompt carries a style lock (`STYLE_BRIEF`).

**When engines are rate-limited.** If the ladder ends on a rate limit — the last engine asked answered 429, or every engine was in [cooldown](#cooldowns) and none was asked — the route answers `429 { error, status: 429 }` instead of 500. It sets no `Retry-After` header; only the route's own rate limiter and `/api/vinaxai` send one.

**Client rules** (`services/ai/dj.ts`, `services/recommendation/engine.ts`)

- The client sends the top 10 ranked songs plus 20 sampled from the next 30 (`samplePool`), so consecutive rounds differ. It waits at most 30 s.
- An off-pool proposal is searched in the catalogue and kept only when a result matches its title and credited artist (`matchesProposal`). At most 4 are resolved per round.
- Fewer than 3 usable picks means no DJ set. The DJ's order is also dropped when it strays from the local order's energy arc by more than 0.08 (0.2 during a tune); the local order ships instead.
- A 503 saying `ai_not_configured` or `ai_disabled` turns the DJ off for the session. `ai_over_budget` backs it off for 15 minutes, any other 503 for 60 s, a 404 or 405 (an older backend) for 10 minutes.
- The DJ runs only when the listener's "AI in recommendations" and "AI DJ" settings are on and the owner's `aiDj` flag is not `false`.

## `POST /api/curate` — structured music tasks

One route, four tasks. The body is `{ task, data }` and success is `200 { data }`.

| Task | Used for | Lane order | Server budget | Client leash |
| --- | --- | --- | --- | --- |
| `metadata` | Classifies songs: mood, vibe, genre, context, language, dialect, energy, tempo | `scholar → fast → chat` | 6 s | 6.5 s |
| `ranking` | Orders a supplied list of songs for a context | `maestro → scholar → dj → chat` | 9 s | 10.5 s |
| `home` | Orders the Home blocks for a listener request | `scholar → maestro → fast → chat → dj` | 9 s | 10.5 s |
| `shelves` | Designs titled Home shelves | pitch on `scholar` and `fast`, then curate on `maestro → scholar → dj → fast → chat` | 14 s | 16 s |

The first attempt gets 3.5 s (`metadata`) or 5 s; later attempts get 4 s. A lane with no key is skipped.

**Errors**

- `400 bad_request` — unknown task, missing `data`, or a body that is not JSON. `413 too_large`.
- `502 { error }` — `invalid_output` when every engine answered and none usably, otherwise the failure `chat()` reported (`failed`, `unreachable`). Rate-limited engines land here too, as `502 { error: 'failed' }`: this route has no 429 for them, and the client falls back the same way.
- `503` — `ai_disabled` or `ai_over_budget` from the owner's controls; `ai_not_configured` (`shelves`) or `not_configured` (the other three tasks) when no lane has a key.

**Validation** (`sanitizeCurated`). The engine's JSON is never passed through; each answer is rebuilt field by field, and an answer with nothing valid left asks the next lane.

- `metadata` — only ids the client supplied (the first 60 songs). Mood must be one of romantic, energetic, chill, melancholy, devotional, neutral; tag lists are clipped to 6.
- `ranking` — `{ ids }` drawn from the supplied ids. The client also discards any id it did not send, so AI changes the order and never the contents.
- `home` — `{ title, description, order }`; `order` may hold only the known Home block keys, and text containing markup or a link is dropped.
- `shelves` — served by `_lib/homeShelves.ts`. Two lanes pitch ideas in parallel (4.5 s); one curate call picks and refines them (6 s first attempt, 5 s later). Each shelf has a `kind` (artist, composer, mood, era, film, fresh, trending, classics). If the curate fails, the pitched ideas are used; if there are none, deterministic on-taste shelves are returned. The task therefore answers 503 only when no lane is configured. The model never supplies songs; the client fills each shelf from the catalogue.

**Client** (`services/ai/recommendations.ts`, `services/ai/home.ts`). Nothing is sent while "AI in recommendations" is off. `metadata` results are cached on the device for 30 days, 500 songs at most. The client backs off for 30 s after a failure and for 10 minutes after a 404 or 405, or a 503 that says `ai_disabled`, `ai_not_configured` or `ai_over_budget`.

## `POST /api/playlist` — playlist from a description

**Request** `{ prompt, languages?, taste?, avoidTitles? }`. `prompt` is required and clipped to 500 characters, `languages` to 5 entries, `avoidTitles` to 60 titles of 90 characters.

**Response**

```
200 { name, description, songs: [{ title, artist }], reading, model }
400 bad_request     413 too_large
429 { error, status }      every engine is rate-limited (the DJ's rule; no Retry-After header)
500 { error, status }      no songs for any other reason
503 ai_not_configured | ai_disabled | ai_over_budget
```

**Server.** The budget is 31 s.

1. `readRequest(prompt)` reads the request's own languages, activity and energy into `reading`. A language the request names replaces the client's `languages`. `reading` goes to the prompts as `requestReading` and back in the response.
2. `detectStyle(prompt)` reads a style (DJ remix, folk or devotional). A style adds the DJ's style lock, and the catalogue songs for its phrase are looked up beside the gather and waited for at most 1 s after it.
3. The `fast` lane gathers about 25 candidate songs (6 s, optional).
4. The playlist is assembled and named by `maestro` when its key is set, otherwise by `dj`, with a 14 s leash; the ladder is `dj → scholar → fast → home`.
5. Strings are clipped to 200 characters and the list to 30 songs. If the curate returns nothing but the gather did, the first 25 gathered songs are returned.

**Client** (`services/ai/playlist.ts`). It aborts at 34 s.

- The response holds titles and artists, not songs. Each suggestion is searched in the catalogue in batches of four.
- The last 100 generated titles are remembered on the device and sent as `avoidTitles`.
- While the curator works, the client builds its own pool from catalogue searches. That pool fills the list up to its target (25 unless the request asks for a length), and becomes the playlist (`source: 'catalogue'`) when the curator fails and at least 8 songs survive.
- Failures map to reasons (`failureReason`): `disabled` (`ai_disabled`), `not_configured` (`ai_not_configured`), `busy` (a 429 or any other 503), `empty` and `error`.

## `POST /api/embed` — text embeddings

Turns short texts into unit-length vectors for natural-language search, the playlist builder's pool ranking and the taste fit. Route: `api/embed.ts`; engines: `_lib/embed.ts`.

**Request** `{ texts: string[], kind?: 'query' | 'passage', prefer?: string }`. 1 to 64 texts, each clipped to 512 characters. `kind` defaults to `passage`. `prefer` is the model the client already holds vectors from; that engine is tried first.

**Response**

```
200 { model, dim, vectors: number[][] }      vectors[i] belongs to texts[i]
400 bad_request    413 too_large    429 rate_limited (the route's own limiter)
503 no_engine | ai_disabled | ai_over_budget
500 internal
```

When no engine answers — including when every one is rate-limited — the route answers `503 no_engine`, not 429. The client backs off either way.

**Server.** Engines come from the providers' live lists of free embedding models: every NVIDIA embedding model listed now, in a fixed preference order, then Gemini's. If a list does not arrive within 1.5 s, or is empty, pinned models are used instead: two on the NVIDIA key (one asked for 384 dimensions, one of 1024), then `gemini-embedding-001` on the Gemini key (its native batch endpoint, then its standard one).

Each engine gets 6 s and the whole ladder 13 s. A failed model rests for 30 minutes after a 404 and 60 s after anything else, per isolate. Vectors from models trained for truncation are cut to 384 numbers; every vector is renormalised and rounded to five decimals.

**Client** (`services/ai/embeddings.ts`)

- Vectors from different models are never compared. Every answer names its model, and the client keeps the active one in `vinax.embed.model.v1`.
- Vectors live in an IndexedDB database of their own, `vinax-embeddings`: 5,000 songs at most.
- Songs are sent 64 per request, 256 per call at most. Requests time out at 15 s; 200 query vectors are cached in memory.
- Back-off: 30 minutes after a 404 or 405 or `ai_disabled`, 60 s after a 429, otherwise 30 s doubling to 15 minutes.
- Nothing is sent while "AI in recommendations" is off.

`services/ai/localVectors.ts` provides a 128-number on-device space that needs no network, and `services/ai/semantic.ts` ranks songs against a query. The two spaces are never compared with each other.

## Other routes that use a lane

Each keeps its key on the Worker, checks the owner's controls, and fails with a JSON error.

| Route | What it does |
| --- | --- |
| `POST /api/assistant` | One help reply per request, nothing stored. Body `{ messages, taste? }`: the last 12 messages, 600 characters each, ending with a user message. `chat` lane with the default ladder, 15 s per engine, 28 s in all. A blank or prompt-echoing reply asks the next engine. Answers `200 { reply, model }` |
| `POST /api/lyrics-tools` | `mode` is `romanize`, `translate` or `explain`. `scholar` lane, 12 s first attempt, 10 s later, 32 s in all. An answer without JSON, or with a different line count, asks the next engine. No key answers `503 not_configured` |
| `POST /api/tts`, `GET /api/voices` | Speech, and the speech models and voices the keys serve. If the chosen voice model fails with anything but a 429, the default voice model is asked once. The client falls back to the device's own voice |
| `POST /api/image`, `POST /api/transcribe`, `POST /api/music` | The chat's media tools (`features/ai/chat/media.ts`) |
| Scheduled push jobs (`api/cron/ai-daily-push.ts`, `api/cron/song-push.ts`) | Song picks and blurbs under the `dj` feature: 12 s per engine and 30 s in all for the pick, 10 s / 20 s for its retry, 8 s / 15 s for a blurb |

`/api/assistant` and `/api/lyrics-tools` answer `429` instead of 500 when the ladder ends on a rate limit, as the DJ does, without a `Retry-After` header. `/api/tts`, `/api/transcribe` and `/api/music` pass a provider's 429 through as `429` and answer `502` for other provider failures.

## Which switch stops which call

| Call | Listener setting | Owner flag | Owner control (`ai-controls`) |
| --- | --- | --- | --- |
| `/api/dj` | AI in recommendations **and** AI DJ | `aiDj` | `dj` |
| `/api/curate` `metadata` | AI in recommendations | — | `curate-metadata` |
| `/api/curate` `ranking` | AI in recommendations | `aiHome` for the Home surfaces | `curate-ranking` |
| `/api/curate` `home` / `shelves` | AI in recommendations **and** AI-designed shelves on Home | `aiHome` | `curate-home`, `curate-shelves` |
| `/api/embed` | AI in recommendations | — | `embed` |
| `/api/playlist` | — (the listener asks for it) | — | `playlist` |
| `/api/vinaxai`, `/api/assistant` | — (the listener asks for it) | — | `vinaxai`, `assistant` |
| `/api/lyrics-tools`, `/api/image` | — (the listener asks for it) | — | `lyrics`, `image` |
| `/api/transcribe`, `/api/music` | — (the listener asks for it) | — | `transcribe`, `music` |
| `/api/tts` | DJ voice, read aloud | — | `tts` |
| Scheduled push picks and blurbs | — | — | `dj` |

"AI in recommendations" (`aiAssist`) is the listener's master switch for background AI. With it off the device sends nothing to `/api/dj`, `/api/curate` or `/api/embed`, and every surface uses its on-device path. Features a listener invokes by hand are not covered by it; the owner's controls still apply. The emergency stop refuses every row above. `GET /api/voices` and `GET /api/aimodels` only list models and are not gated.

## Adding or replacing a model

No secret is added per model. Each provider has one key (`PROVIDER_ENV` in `_lib/ai.ts`), and every model a provider lists as free is already in the chat's model menu.

1. To pin a model to a lane, add an entry to `AI_MODEL_REGISTRY` in `_lib/models.ts`.
2. Probe it from the owner console's AI Lab or Engine probe.
3. If it serves, pin it in `LANE_MODEL` (or as a `LANE_SECONDARY`) in `_lib/ai.ts`. A lane's key follows from `LANE_PROVIDER`.
4. A new provider needs an entry in `PROVIDER_ENV`, its base URL, and both `.env.example` files (`backend/` and `frontend/`).
5. The `maestro` pin can be replaced without a deploy through the plain var `VINAX_MAESTRO_MODEL`. It must be a model slug; a value that looks like a key is ignored and logged.

`backend/worker/__tests__/laneRegistry.test.ts` fails the build if there are not exactly four AI key secrets, if a lane signs with anything else, or if a retired engine returns to the wiring.

Features do not change when a model does: they name lanes. See [Lanes and failover](#lanes-and-failover).
