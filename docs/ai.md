# AI in VinaX

This document covers the AI layer of VinaX as of 7.1: how the Worker routes a call through lanes and fails over between them, the contract of each AI route (`/api/dj`, `/api/curate`, `/api/playlist`, `/api/vinaxai`, `/api/aimodels`), the rule that AI may order or propose but never bypass validation, the timeouts and budgets on both sides, and what the app does when every provider is down. The on-device recommender that AI sits on top of is described in [recommendations.md](recommendations.md). Secret names, provider hosts and key rotation are in [operations.md](operations.md).

Backend paths below are relative to `backend/worker/functions/`; frontend paths are relative to `frontend/src/`.

## Principles

| Rule | How the code enforces it |
| --- | --- |
| No key ever reaches the browser. | Keys are Worker secrets read only in `_lib/ai.ts`. Responses carry a model name as an opaque label and nothing else about the provider. |
| Features name lanes, not models. | A route asks for a lane (`dj`, `scholar`, …). Which model and key serve that lane is a table in `_lib/ai.ts`. Replacing a model does not touch a feature. |
| AI orders or proposes; code decides. | Every AI answer is parsed, clipped and validated on the server, then validated again on the device against the same rules as non-AI results. |
| Every AI feature has a non-AI result. | The queue, Home, trending and search all work with no AI key configured. |
| Listener data sent to a model is bounded. | Routes receive a compact taste snapshot (languages, artist names, song titles, the hour). No account exists, and no listener identifier is sent. See [data-and-privacy.md](data-and-privacy.md). |
| Model output is untrusted. | Prompts tell engines never to name a vendor or model; the server and client also reject markup and links in any display text. |

## Lanes and failover

`_lib/ai.ts` defines 19 lanes over 18 key secrets. A lane is: the secret that signs it, a pinned model, an optional same-key secondary model, and a provider base URL. Most lanes share one default inference host; two lanes (`scholar` and `router`) each ride their own host. `_lib/models.ts` holds the model registry (capabilities, latency and cost class, health notes); every entry has `training_supported: false` because VinaX only uses hosted inference.

| Lane | Role |
| --- | --- |
| `dj` | Creative generation: playlists, the DJ's first failover |
| `chat` | Everyday assistant chat (shares the `dj` lane's key) |
| `deep` | Deep reasoning (the chat's Think engine) |
| `fast` | Quick tasks and candidate gathering |
| `scholar` | Music knowledge, lyric tools, live voice, small JSON tasks. Rides a low-latency host and opens that account's live model catalogue. |
| `home` | Large reasoning backstop. Slow; always last in latency-sensitive ladders. |
| `search` | Search-page music expert |
| `pro`, `mini` | Ladder reserves |
| `agent` | Reserve seat; in no ladder |
| `router` | A marketplace of zero-cost models; the model is resolved from a live catalogue, never from a fixed pin |
| `vision`, `vision90` | Image understanding, on their own keys |
| six bench lanes | One per remaining key so the owner console can probe every secret. They drive no feature. |

### How one call runs

`chat(env, messages, opts)` builds an ordered list of attempts with `laneAttempts`:

1. The lane's own key and pinned model (or a per-call model override).
2. The lane's same-key secondary model, unless the call passes `skipSecondary`.
3. The cross-lane ladder. The default is `chat → search → deep → fast → dj → scholar → mini → pro → home`; a route can pass its own. Vision lanes, `agent`, `router` and the bench lanes are never in the default ladder. A lane with no configured key is skipped.

Each attempt carries its own endpoint, because hops can cross provider hosts. For each attempt:

- The leash is `firstTimeoutMs` for the first attempt and `timeoutMs` for the rest (20 s when unset), and never longer than the time left before `deadlineAt`. An attempt is not started with 1.5 s or less remaining; the call then returns `failed` with status 408 or the last status seen.
- When `json: true`, the request asks for a JSON object. A 400 in JSON mode retries the same model once in plain mode.
- Any other error status, a timeout, a network error or a 200 with empty content moves to the next attempt. The leash stays armed while the body is read.
- Reasoning wrapped in `<think>` tags is stripped from the content. Model families that reason by default get their reasoning switched off or capped through model-gated request parameters.
- Defaults are temperature 0.7 and 6000 output tokens.

The result is `{ content, model, keyRole, usage }` or an error: `not_configured` (no attempt has a key) or `failed`. One line per attempt is logged (lane, model, status, milliseconds) with no prompt text and no secrets.

`gather(env, messages, lanes, opts)` runs the same prompt on several lanes in parallel and returns every non-empty answer; latency is the slowest lane, not the sum. With `soloLadder`, each lane stays on its own key so a panel cannot collapse onto one engine. `extractJson` parses an answer that may carry code fences or a preamble. `moderate` returns `{ unchecked: true }` for every text: no safety model is reachable, and the caller decides whether to fail open or closed.

### Observability

`logAiEvent` writes one row per AI request (feature, `model @lane`, ok, status, error, client, latency, token counts when the provider reports them) when the analytics database is configured, and does nothing otherwise. `_lib/laneHealth.ts` aggregates those rows per lane for the owner console: call count, success rate, p50/p95/p99 latency, failover hops, empty streams, self-requested searches, and 401/403/429 responses. `/api/curate` also keeps a 60-second in-memory observation per lane and tries recently failed or slow lanes later. See [admin-console.md](admin-console.md).

### Rate limits and body caps

Every AI route uses the per-isolate token bucket in `_lib/ratelimit.ts` (limits apply per edge location, not globally) and reads its body through a capped reader, so a chunked body cannot exceed the cap.

| Route | Bucket (burst / refill per minute) | Body cap |
| --- | --- | --- |
| `POST /api/dj` | 15 / 8 | 48 KB |
| `POST /api/curate` | 12 / 6 | 32 KB |
| `POST /api/playlist` | 6 / 3 | 32 KB |
| `POST /api/vinaxai` | 20 / 10, plus 5 / 5 for requests with web search | 12 MB (6 MB of inline images) |
| `GET /api/aimodels` | 12 / 12 | — |

## `POST /api/dj` — the AI DJ

The client sends a listening context and a pool of real songs it has already gathered, filtered and ranked. The DJ selects and orders from that pool and may, when asked, propose a few songs from outside it.

**Request**

```
{ context: {...}, pool: [{ id?, title, artist, language?, album?, year?, known? }],
  count?, discover?, maxDiscover?, wantSegues? }
```

- `pool` is clipped to 60 entries; fewer than 3 answers `400 pool_too_small`. An empty context answers `400 empty_context`.
- `count` is clamped to 1–20 (default 8). `maxDiscover` is clamped to 0–6 (default 4) and is 0 unless `discover` is true.
- `known` marks a song or artist the listener has played. `album` and `year` let the DJ keep era and composer style coherent.
- `wantSegues: false` tells the engine to leave spoken segues empty. The client sends `true` only when the DJ voice setting is on.
- The context (`services/ai/dj.ts`, `buildDjContext`) carries the seed song, `currentLanguage`, the pinned mood, preferred and muted languages, recent, completed, skipped, liked and top songs, preferred and avoided artists, taste dials, a discovery focus, and optionally `arcShape`, `listenerGoal` and `tuneInstruction`.

**Response**

```
200 { intro, songs: [{ songId, title, artist, reason, segue, confidence, fromPool }], model }
400 bad_request | empty_context | pool_too_small    413 too_large
503 ai_not_configured    500 { error }
```

**Server rules**

- The prompt orders by transition strength: slot 1 is the strongest, most familiar hand-off from the seed; discoveries belong in the second half; every song is in `currentLanguage` unless the tune instruction asks to switch.
- A pick is matched to the pool by id first, then by canonical title and artist. An id that is not in the pool never becomes a pool song. Repeats are dropped.
- An off-pool pick is kept only when discovery was requested, as `fromPool: false` with `songId: null`, up to `maxDiscover`, and never when its title appears in the context's avoided, recent or skipped songs.
- With discovery on and a pool under 12 songs, the `scholar` lane first gathers up to 30 supplementary candidates (3.5 s, optional).
- Budget: 26 s. The `scholar` lane leads with a 9 s leash; the ladder is `dj → fast → chat → home` at 11 s each; the secondary is skipped.

**Client rules** (`services/ai/dj.ts`, `services/recommendation/engine.ts`)

- The client sends the top 10 ranked songs plus 20 sampled from the next 30, so consecutive rounds differ. It waits at most 30 s.
- A proposal is looked up in the catalogue and kept only when a result matches title and credited artist (`matchesProposal`), passes the language gate and passes the engine's hard filter. At most 4 proposals are resolved per round.
- Fewer than 3 usable picks means no DJ set. Otherwise the DJ's order goes through `validateSequence` and must keep the energy arc within 0.08 of the local order (0.2 during a tune). If it fails either test, the local order ships.
- After a 503 the DJ is marked unavailable for the session. A 404 or 405 (an older backend) silences it for 10 minutes; any other error or timeout for 60 s.
- The DJ is off when the listener's "AI DJ" setting is off or the owner's `aiDj` flag is false.

## `POST /api/curate` — structured music tasks

One route, four tasks. The body is `{ task, data }`; an unknown task or missing data answers `400 bad_request`. Success is `200 { data }`; invalid model output is `502 invalid_output`; no configured lane is `503`.

| Task | Used for | Lane order | Server budget | Client leash |
| --- | --- | --- | --- | --- |
| `metadata` | Classifies songs: mood, vibe, genre, context, language, dialect, energy, tempo | `scholar → fast → chat → search` | 6 s | 6.5 s |
| `ranking` | Orders a supplied list of songs for a context (Home re-rank, next-song re-rank when the DJ is off, "Trending for you") | `scholar → dj → chat → home` | 9 s | 10.5 s |
| `home` | Orders the Home blocks for a listener request | `dj → scholar → chat → home` | 9 s | 10.5 s |
| `shelves` | Designs 4–6 titled Home shelves, each with a catalogue query | pitch on `scholar` + `fast`, curate on `scholar → dj → fast → chat` | 14 s | 16 s |

The first attempt gets 3.5 s (`metadata`) or 5 s; later attempts get 4 s. Lanes that failed or were slow in the last 60 s are tried later.

**Contracts and validation** (`sanitizeCurated`). The engine's JSON is never passed through. Each answer is rebuilt field by field:

- `metadata` — only ids the client supplied; mood must be one of romantic, energetic, chill, melancholy, devotional, neutral; tag lists are clipped to 6; energy must be 0–1 and tempo 40–220, otherwise null. The prompt forbids claiming measured audio features.
- `ranking` — `{ ids }` containing only supplied ids, without duplicates. The client (`aiRerankSongs`) also discards any id it did not send, so AI can change the order and never the contents.
- `home` — `{ title, description, order, hidden }`; `order` may contain only the known Home block keys; title (60) and description (160) are dropped if they contain markup or a link.
- `shelves` — served by `_lib/homeShelves.ts`: two lanes pitch ideas in parallel (4.5 s), one curate call picks and refines them (6 s leashes), titles and queries the listener was shown recently are filtered out. If the curate fails, the pitched ideas are used; if there are none, deterministic on-taste fallback shelves are returned. The task answers 503 only when no lane is configured. The client (`services/ai/home.ts`) rejects any shelf whose text contains markup, links or a disallowed name, and fills each shelf itself from the catalogue; the model never supplies songs.

The `metadata` results are cached on the device for 30 days (500 songs at most). After a failure the client skips `metadata` and `ranking` calls for 30 s; after a 404 or 405 it skips every curate task for 10 minutes.

## `POST /api/playlist` — playlist from a description

**Request** `{ prompt, languages?, taste?, avoidTitles? }` — `prompt` is required and clipped to 500 characters, `languages` to 5, `avoidTitles` to 60 titles of 90 characters.

**Response** `200 { name, description, songs: [{ title, artist }], model }`, `400 bad_request`, `413 too_large`, `503 ai_not_configured`, `500 { error, status }`.

**Server** — budget 31 s. The `fast` lane gathers about 25 candidate songs (6 s, optional); the `dj` lane then assembles and names the playlist with a 14 s leash and the ladder `home → fast → scholar`. Titles in `avoidTitles` are filtered out in code, in-playlist repeats are dropped, strings are clipped to 200 characters and the list to 30 songs. If the curate returns nothing but the gather did, the gathered pool is returned.

**Client** (`services/ai/playlist.ts`) — aborts at 34 s. The response contains titles and artists, not songs: each suggestion is searched in the catalogue in batches of four. The result that matches title and credited artist wins; muted languages, blocked songs, recently served identities and the listener's avoid list are hard rules. Titles used by recent generations are remembered on the device (100 at most) and sent as `avoidTitles` next time.

## `GET /api/aimodels` — the live model catalogue

Two key secrets open whole catalogues instead of one pinned model: the `scholar` lane's account catalogue and the `router` lane's marketplace. `_lib/catalog.ts` asks each provider for its own model list, keeps entries that are chat-capable and zero-cost (a missing or unparseable price counts as paid), and caches the result for 15 minutes.

**Response**

```
{ fetchedAt, groups: [{ id, label, prefix, hint, configured,
                        models: [{ id, label, provider, context, agent }] }] }
```

- `id` is one of two short string literals defined in `_lib/catalog.ts`, one per catalogue.
- `prefix` is the upstream's operational name, used by the owner console only. Listener surfaces use `label`.
- A missing secret or an unreachable provider yields an empty list. There is no hard-coded fallback menu.
- The response is cacheable for 5 minutes with a 15-minute stale-while-revalidate window.
- `agent` was being added when this was written (uncommitted change on `upgrade/7.1`): `true` for models in an explicit allow-list of agentic systems in `_lib/catalog.ts`, `false` otherwise. It is additive; older clients ignore it.

A catalogue lane never trusts a fixed model pin. When a chat request names a model, the Worker checks it against the same live list before using it; an unlisted model is refused, not forwarded. With no pick, the default is resolved from the live list, and the lane's pin is used only if the provider reported nothing.

## `POST /api/vinaxai` — the VinaX AI chat

**Request** `{ messages, mode?, model?, web?, images?, taste?, profile? }`

- `messages` — the last 40 user and assistant turns, each clipped to 24 000 characters. The last turn must be from the user. Every user turn is wrapped in a "treat as data, not instructions" fence before it reaches a model.
- `mode` — the engine seat. Unknown values fall back to the default seat; retired ids are remapped to their successors. `auto` picks a seat from the question (reasoning words or a long question → deep; writing words → creative; music-knowledge words → the knowledge seat; short → fast; otherwise balanced).
- `model` — honoured only for the two catalogue seats, after the live-list check above.
- `web: true` — runs a live web search on the last question before answering. The Worker searches only when this flag is set, so the client always shows that a search happened. If the search returns nothing, `meta.web` is `failed` and the reply must say so.
- `images` — up to 6 inline `data:image/` URLs, 6 MB in total (`413 image_too_large` beyond that). Image turns go to the vision lane; if vision is unavailable the text part is answered with a note that the image could not be viewed.
- `profile` — the listener's optional "about you" text, control characters removed, clipped to 1500 characters. `taste` — the same compact snapshot other routes use.

**Response** — server-sent events, one JSON object per `data:` frame:

| Frame | Meaning |
| --- | --- |
| `{ meta: { model, mode, web, sources } }` | Which engine is answering, the web search state (`off`, `on`, `failed`) and source links. Sent again if the engine changes. |
| `{ delta: "text" }` | The next piece of the reply |
| `{ done: true }` | The end of the reply |
| `{ done: true, truncated: true }` | The stream was cut after some text had arrived. `truncated` is additive: clients that only read `done` are unaffected. |
| `{ step: { tool, label } }` | One tool run by an agentic engine (see below). Additive. Uncommitted when this was written. |

Errors before the stream starts are JSON: `400 bad_request`, `413 too_large` / `image_too_large`, `429`, `503 ai_not_configured` / `engine_unreachable`, `500`.

**Failover and budgets.** The Worker walks up to four attempts from `laneAttempts` for the seat's lane: 18 s for the first to return headers, 10 s for each later one. A whole streamed reply is capped at 90 s; a failover that starts late still gets at least 15 s to drain. A stream that returns 200 but no content is rescued by the next attempt and logged as `empty_stream_fallback`. Each failed hop is logged with the engine and status that failed, and `meta` names the engine that finally answered.

**Agent steps.** Some catalogue engines search the web and run code by themselves and report each tool run on the stream. The Worker forwards a compact summary per run: `tool` is `search`, `code`, `visit` or `other`, and `label` is one line such as a search query, "Ran code", or the host of a page that was read. Raw tool output, the code itself, full URLs, control characters and anything past 12 steps per request never leave the Worker.

### The chat page

`pages/VinaXAIPage.tsx` (about 1,070 lines) renders the `/VinaXAI` route, outside the main app layout. Since 7.1 it is an orchestrator; the parts live in `features/ai/chat/`:

| Module | What it owns |
| --- | --- |
| `models.ts`, `ModelMenu.tsx`, `useModelCatalog.ts`, `placeMenu.ts` | The model menu |
| `Composer.tsx` | The text box, attachments, the tools menu, the Agent toggle, the model chip, voice, send / stop |
| `MessageList.tsx`, `Message.tsx`, `AgentActivity.tsx` | The conversation |
| `Sidebar.tsx` | Chat history |
| `SettingsDialog.tsx` | Chat settings |
| `streamReducer.ts`, `streamClient.ts`, `buildChatRequest.ts` | The request and the event stream |
| `storage.ts` | Loading, saving, exporting and importing chats |
| `musicCommands.ts`, `useDictation.ts`, `useLiveVoice.ts`, `liveVoiceStore.ts` | Device-side music commands and voice |

- **Model menu.** One menu with a search field and these sections: recently used (five at most), Recommended (Auto, Balanced, Fast, Deep, Creative, Translate), VinaX engines (the remaining pinned seats under the owner's labels), then one section per catalogue group listing every model `/api/aimodels` returns, each with its context size and, where the server says so, an Agent badge. Labels are shown as the server returns them. A catalogue pick is sent as the group's seat in `mode` plus the slug in `model`; the Worker validates the slug against the live catalogue. A group that is unconfigured or empty shows "Not available right now"; nothing is invented. The catalogue is not fetched on page load: it is requested when the menu is first opened, when Agent mode is switched on, or when "Start in Agent mode" is set, and is trusted for five minutes. The menu is a combobox over a `listbox` with `group` and `option` rows and full keyboard support.
- **Agent mode.** `_lib/catalog.ts` marks a model `agent: true` from one explicit allow-list (`AGENT_MODEL_SLUGS`); the client never infers it from a name. The composer's Agent toggle loads the catalogue, moves to the best agent model (largest context, then shortest name) and remembers the previous model to restore when it is switched off; while it is on, the menu lists agent models only. With no agent model available the toggle is disabled and says so. Replies from an agent model show a collapsible "Working…" list built from `step` frames, which folds to a one-line summary when the answer finishes.
- **Composer.** One instance that never remounts: centred under a first-name greeting on an empty chat, docked to the bottom once there are messages. The text box grows from one to eight rows. The + menu holds file and folder upload, Web search, Think (adds a "reason privately, then summarise the steps" instruction; ignored while an agent model answers), Research (turns web search on and adds a cross-check instruction) and Saved prompts. Image generation is wired but disabled by a constant (`IMAGES_ENABLED = false` in `endpoints.ts`). Send becomes Stop while a reply streams. Text and attachments are composer-local state, so typing does not re-render the page.
- **Streaming.** `streamReducer.ts` is a pure reducer over `meta` (`model`, `sources`), `delta`, `step`, `truncated` and `done` frames; it tolerates malformed frames and frames split across chunks, and keeps at most 12 steps. When `truncated` is true the page appends "This answer was cut short — ask me to continue." On a failed request with no text it shows "The assistant paused — please try again.", with separate lines for offline and rate-limited requests.
- **Conversation.** A 46rem column. The listener's messages are right-aligned bubbles; replies are plain text led by the sparkle mark. A thread opens on its last 40 messages (`MESSAGE_WINDOW`) with "Show earlier messages". Reply actions — Copy, Read aloud, Regenerate, Good / Bad response, Branch, Pin, and a More menu with Continue, Shorten, Expand, Simplify — appear on hover or focus and are always visible on touch.
- **Sidebar.** Collapsible (remembered). New chat, search, then threads grouped Pinned / Today / Yesterday / Previous 7 days / Older, with rename, pin and delete (delete offers Undo). On phones it is a slide-over with a focus trap and back-button close.
- **Settings.** A modal dialog on the shared `<Sheet>` with five tabs: General (text size, default model, Send with Enter, Start in Agent mode), Replies (reply language, style, use the song playing now, About you), Voice (voice, preview, auto read-aloud), Data (storage used, export, import, clear all with Undo) and Shortcuts.
- **Storage.** Chats stay on the device under `vinax_ai_chats_v1` (50 at most, images stripped before saving; a message may carry `steps`). Preferences: `vinax.aiDefaultMode`, `vinax.aiCatalogModels`, `vinax.aiLastModel`, `vinax.aiRecentModels`, `vinax.aiFontSize`, `vinax.aiProfile`, `vinax.aiReplyLang`, `vinax.aiReplyStyle`, `vinax.aiVoice`, `vinax.aiSendOnEnter`, `vinax.aiAgentStart`, `vinax.aiAutoRead`, `vinax.aiSidebarCollapsed`. A visit starts on the explicit default model, else the last model used, else Balanced. Nothing about a conversation is stored on the server.
- **Music commands.** Typed or spoken commands such as pause, next, "play X" and "queue X" run on the device without an engine call.
- **Motion.** Transform and opacity only, 180 ms at most, off under reduced motion. The styles are in `styles/ai.css`, imported by the page, so they ship in the lazy AI chunk and not in first load.

Not verified against live engines: a real agentic reply. The `step` frames are tested against mocked upstream shapes only.

## Other routes that use a lane

These routes are outside the scope of this document; each keeps its key on the Worker and fails with a JSON error the client can handle.

| Route | What it does |
| --- | --- |
| `POST /api/assistant` | In-app help chat; one reply per request, nothing stored |
| `POST /api/lyrics-tools` | Romanises, translates or explains lyric lines on the `scholar` lane, preserving line count and order |
| `POST /api/tts`, `GET /api/voices` | Spoken replies and the list of speech voices the key serves; the client falls back to the device's own speech engine on any failure |
| `POST /api/image` | Text-to-image; disabled in the client |

## When every provider is down

| Surface | What the listener gets |
| --- | --- |
| Queue continuation | The on-device pipeline's order, validated in stage 10. The DJ call returns nothing, the client backs off (60 s, or the whole session after a 503), and playback never waits for it. |
| Classifier metadata | Songs are scored from catalogue metadata and title-based mood inference. Cached classifications are still used. |
| Home re-rank | The on-device order. |
| "Designed for you" shelves | While any lane is configured the Worker returns deterministic fallback shelves. With none configured, or with the Worker unreachable, the block renders nothing and the rest of Home is unchanged. |
| "Trending for you" | The on-device taste order after 4 s; the shelf reports `local`. |
| Tune this queue, Pin a mood | The intent's catalogue query, score nudge and arc shape are all on-device, so the rebuild still follows the intent. |
| Playlist from a description | An error message. No playlist is invented. |
| VinaX AI chat | `503` before the stream; the page shows "The assistant paused — please try again." Device-side music commands still work. |
| DJ voice | The device's speech engine says "Now playing … by …" instead of the DJ's segue. |

Two switches turn AI features off deliberately: the listener's settings (AI DJ, DJ builds every queue, AI-designed shelves on Home) and the owner's feature flags `aiDj` and `aiHome` (see [admin-console.md](admin-console.md)).

## Adding or replacing a model

1. Add the secret to the Worker and an entry to `AI_MODEL_REGISTRY` in `_lib/models.ts`.
2. Probe it on its own key from the owner console's AI Lab, which accepts a model override and does not fail over.
3. If it serves, pin it in `LANE_MODEL` and `LANE_ENV` (or as a `LANE_SECONDARY`) in `_lib/ai.ts` and update both `.env.example` files.
4. `backend/worker/__tests__/laneRegistry.test.ts` fails the build if a lane points at a secret the registry does not list, if a listed secret is unreachable by any lane, or if a retired name returns.

Features do not change: they name lanes.
