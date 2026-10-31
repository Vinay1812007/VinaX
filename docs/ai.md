# VinaX AI

This document covers VinaX AI, the chat assistant at `/vinaxai`:
- how a message travels from the page through the Worker to a model and back;
- the providers and their secrets;
- the model registry and Auto's ladders, and failover and cooldowns;
- the stream protocol;
- web search, files, artifacts and the sandbox, and voice;
- how conversations are stored;
- the owner's switches, the console's providers card, the probe script, and what happens when a provider is down.

VinaX AI is the only AI in VinaX. Recommendations, Radio and Up Next stay on the listener's device ([recommendations.md](recommendations.md)). The listener's guide is [user-guide/vinax-ai.md](user-guide/vinax-ai.md).

## How a message travels

```
VinaXAIPage (lazy, full screen inside AppLayout)
  └─ features/vinaxai/store.ts ── POST /api/ai/chat (Bearer session) ──▶ Worker functions/api/ai/chat.ts
                                                                          │ session · rate limit · kill switch · body cap
                                                                          │ conversation tree from Supabase, user message saved
                                                                          │ system prompt (_lib/ai/prompt.ts)
                                                                          │ Auto ladder or the picked model (_lib/ai/router.ts)
                                                                          ▼
                                                     _lib/ai/adapters/* ── provider (Groq · Gemini · OpenRouter · NVIDIA · Workers AI)
  ◀── text/event-stream: meta · title · thinking · text · error · done ───┘
                                                                          └─ reply saved with ctx.waitUntil (also after Stop)
```

Every provider call goes through the Worker. No key, upstream host or raw upstream error ever reaches the browser, and logs carry only route, model, provider, ladder, latency, status and token counts, never message text.

## Providers and secrets

| Secret / binding | Provider | Used for |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq (OpenAI-compatible) | The fast default models (GPT-OSS, Qwen); dictation (Whisper) and Read aloud (Orpheus) |
| `GEMINI_API_KEY` | Google Gemini (native `streamGenerateContent?alt=sse`) | Images, PDFs and long threads (phases 3–4 add grounding and files); Live voice, and the dictation and Read aloud fallbacks |
| `OPENROUTER_API_KEY` | OpenRouter (OpenAI-compatible) | `:free` code models and mirrors |
| `NVIDIA_API_KEY` | NVIDIA NIM (OpenAI-compatible) | Reasoning and vision models |
| `AI` (`[ai] binding = "AI"`) | Cloudflare Workers AI | Last resort in the default ladder |
| `SEARCH_API_KEY`, `SEARCH_API_PROVIDER` (var: `tavily` default, or `serper`), `SEARCH_DAILY_LIMIT` (var: default 100, `0` = off) | Tavily or Serper | Web search for models that cannot ground (below) |

Any one of them is enough for the chat to work. With none, `/api/ai/*` answers `503 ai_not_configured` and the page shows "VinaX AI is unavailable right now". The Gemini key travels in the `x-goog-api-key` header, never in a URL. OpenRouter calls carry `HTTP-Referer: https://www.vinaxmusic.online` and `X-Title: VinaX AI`. How to set the secrets: [../DEPLOYMENT.md](../DEPLOYMENT.md#vinax-ai).

## The registry

`backend/worker/functions/_lib/ai/models.ts` is the only place that names a model id. Each entry has:
- a registry id, `<provider>:<upstream id>`;
- a display name and a picker group (`fast`, `balanced`, `smart`, `vision`, `code`, `more`, `cloudflare`, or none for the web-search-only models);
- a tier (`fast` models get the compact prompt);
- flags: `vision`, `pdf`, `grounding`, `reasoning`, `artifacts`, `systemRole`, `thinkFormat`;
- `maxContextChars`, `maxOutput`;
- extra request fields in `params`, plus `highParams` for Extended thinking;
- `firstEventMs` for a model that is slow to start (below).

Every chat model the owner's providers offer is in the picker (2026-10-31, from the owner's latency run). A model reached through a second service says so in its name, so no two picker entries share a name. In group order:

| Group | Models |
| --- | --- |
| Fast | Qwen 3.8 27B (Groq), GPT-OSS 20B (Groq), Gemini 3.5 Flash Lite, Gemini 3.1 Flash Lite, Gemini 3.1 Flash Lite Preview, Gemini Flash Lite (latest), LFM 2.5 2.6B (OpenRouter `:free`) |
| Balanced | **GPT-OSS 120B** (Groq; Auto's default), Gemini 3.5 Flash, Gemini 3 Flash Preview, Nemotron 3.5 Lightning (NVIDIA), Nemotron 3.5 Lightning (OpenRouter), GPT-OSS 20B (NVIDIA) |
| Smart | Gemini 3.6 Flash, Nemotron 3 Ultra 550B (NVIDIA), Nemotron 3 Ultra 550B (OpenRouter), Step 5 Preview (NVIDIA) |
| Vision | Nemotron 3.5 Super VL (NVIDIA), Nemotron 3.5 Super VL (OpenRouter), Nemotron 3 Nano Omni (NVIDIA), Nemotron 3 Nano Omni (OpenRouter), Llama 3.2 90B Vision (NVIDIA, slow) |
| Code | North Mini Code, Laguna S 2.1, Laguna XS 2.1 (OpenRouter `:free`), Laguna XS 2.1 (NVIDIA) |
| More models | Dots 3 Note Preview (OpenRouter `:free`), ALLaM 2 7B (Groq; Arabic and English), Riva Translate 4B (NVIDIA; a translator), Ising Calibration 1.5 31B (NVIDIA), Gemini Robotics ER 2 Preview, Muse Glimmer 30B (NVIDIA, slow), Nemotron 3.5 Bolt (NVIDIA, slow) |
| Cloudflare | Llama 3.3 70B, Llama 3.1 8B (Workers AI) |

Not in the picker:
- Gemini 2.5 Flash and 2.5 Flash-Lite answer only when a reply searches the web ([Web search](#web-search)): their free grounding is a shared daily allowance.
- `UTILITY_MODELS` in the same file lists the models that cannot hold a conversation: the safety and prompt guards (Llama Guard 4 12B, Nemotron Safety Guard 8B v3, Llama Prompt Guard 2 22M and 86M, GPT-OSS Safeguard 20B), the embeddings (Gemini Embedding 001, 2 and 2 Preview; Nemotron 3 / 3.5 Embed 1B, 3.5 Embed 8B, Llama Nemotron Embed VL 1B v2), the document parsers (Nemotron Parse and Parse 2.0) and Gemini AQA. They are never in the picker or a ladder; the console's Health → VinaX AI lists them read-only. Voice models are in `voice.ts` ([Voice](#voice)).

**Slow to start.** Llama 3.2 90B Vision, Muse Glimmer 30B and Nemotron 3.5 Bolt took 30–45 seconds to start in the owner's run. They carry `firstEventMs: 60000`: picked, or probed from the console, they get a minute for their first event instead of 25 seconds. They are never in an Auto ladder. The picker's description says "slow to start".

With 35 models the picker has a search box (name, provider or description). Enter picks the first match.

The Workers AI ids were taken from Cloudflare's public model list, because the build could not see the owner's account. They are marked `unconfirmed` until the probe confirms them.

Groq's free tier counts tokens per minute, so Groq models keep a short history (`maxContextChars` 30,000). A long thread goes to the long ladder instead.

### The probe

`npm run ai:probe` (in `backend/`, script `scripts/ai-probe.mjs`) is run by the owner with their own keys, never in CI.
- It reads `worker/.dev.vars`. For Workers AI over REST it also needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- For every registry model it sends one streamed request, plus one image request for models flagged `vision`.
- It prints time to first token, whether the reply streamed, where reasoning arrived (`field`, `tags`, `parts` or none), whether the system message was followed, whether the image was read, and the context and output limits the provider reports.
- It then checks voice: each Whisper and Gemini transcription model on a one-second test tone, each Orpheus and Gemini TTS model (with which voice field Gemini accepts and the audio type it returns), which Live token body Google accepts, and a real Live handshake (setup, then `setupComplete`) on each Live model.
- Options: `--only <text>` limits it to ids containing the text; `--no-image` skips the image check; `--voice-only` runs only the voice checks; `--no-voice` skips them.
- It prints nothing secret and writes nothing.

Use its table to set the registry flags. Use the owner's latency measurements to choose models.

## Auto

`pickLadder` (`_lib/ai/router.ts`) uses cheap checks, never an extra model call. It checks in this order:

| Signal | Ladder |
| --- | --- |
| One of the last three questions has an image | vision: Gemini 3.6 Flash → Gemini 3.5 Flash → Nemotron 3.5 Super VL → its OpenRouter mirror |
| The thread has a PDF, or is over 150,000 characters (files' text counted) | long: Gemini 3.6 Flash → Gemini 3.5 Flash → Gemini 3 Flash Preview → GPT-OSS 120B |
| Extended thinking is on | deep: Gemini 3.6 Flash → Nemotron 3 Ultra → its OpenRouter mirror → GPT-OSS 120B, all with high reasoning |
| Code cues (a fence, a stack trace, "function", "bug", a file extension…) | code: GPT-OSS 120B → Gemini 3.6 Flash → North Mini Code → Laguna S 2.1 |
| Short small talk (under six words, no question, starts like a greeting or thanks) | fast: Qwen 3.8 27B → GPT-OSS 20B → Gemini 3.5 Flash Lite |
| Anything else | default: GPT-OSS 120B → Gemini 3.5 Flash → Nemotron 3.5 Lightning → its OpenRouter mirror → GPT-OSS 20B (NVIDIA) → Llama 3.3 70B (Workers AI) |

Models whose provider has no key are left out. If a ladder ends up empty, the default ladder is used, then any configured picker model.

## Failover and cooldowns

- **When to move on.** Auto tries the next model when the current one fails before the first answer-text token reaches the page. Failures that count:
  - no first event within 12 s (25 s for the deep ladder or a picked model);
  - a network error;
  - 429, 5xx, 404/410, 401/402/403, or another 4xx;
  - an empty stream, or one that holds only reasoning.

  Each model also has a whole-reply budget: 120 s, or 240 s for slow models.
- **After the first token, no failover.** A failure ends the reply with an `error` event and `stopReason: 'error'`, and the partial text is kept.
- **A picked model is never swapped.** Its failure is reported with up to two `alternatives`: picker models that are configured and not resting.
- **The model label is honest.** When a failover changes the model, `meta` is sent again. The page clears any reasoning it was showing, and the label under the reply names the model that actually answered.

Cooldowns (`_lib/ai/cooldown.ts`) live in each isolate's memory. A resting model is skipped without a request. If every model is resting, they are all tried anyway. A new rest never shortens a longer one.

| Failure | Rest |
| --- | --- |
| 429 | the provider's `retry-after` / `retryDelay`, 1 minute if none, at most 10 minutes |
| 429 saying a daily or free allowance is spent | until the reset the provider gave, else 6 hours (at most 24) |
| Workers AI 4006 (daily neuron pool spent) | every Workers AI model, until 00:00 UTC |
| 404/410; Workers AI 5007 | 1 hour; 24 hours |
| 401/402 | the whole provider, 10 minutes |
| 403 | that model, 10 minutes |
| 5xx | 30 seconds |
| timeout, network error, other 4xx, empty answer | no rest |

**When a provider is down,** its models rest after their first failure and Auto answers from the next provider. If every model fails, the page shows "VinaX AI is busy right now. Try again in a moment." with a Retry button. The console's providers card ([below](#the-consoles-providers-card)) shows what is resting and why.

**One answer, not a stream.** `_lib/ai/complete.ts` runs the same ladder and failover without streaming: `completeText` collects the answer of the first model that answers, and `completeJson` parses it as JSON (reasoning tags and code fences stripped, the first balanced value taken), validates it with a caller's type guard, and asks the same model once more with the broken answer quoted when it does not fit. The personal engine's composer and playlist builder ([personalisation.md](personalisation.md)) use it with the `default` and `fast` ladders; every failure is a null, and the caller has a deterministic answer ready.

## Reasoning

`ThinkSplitter` (`_lib/ai/think.ts`) is shared by every adapter. It sends reasoning to `thinking` events whichever way it arrives:
- a `reasoning` / `reasoning_content` delta field;
- `<think>…</think>` at the start of the text, even when a tag is split across chunks;
- Gemini thought parts.

Raw `<think>` tags never reach the reply. Reasoning is capped at 20,000 characters per reply. A stream that ends inside `<think>` with no answer counts as an empty answer, so Auto fails over.

## Web search

`_lib/ai/search.ts`, wired in `functions/api/ai/chat.ts`. At most one search per turn, never for a Continue, and never when the owner's `vinax-ai.search` is `false`.

**When it runs.** The composer's + menu has Web search: Auto, On or Off (kept on the device).
- On searches for every message; Off never searches.
- Auto searches when the latest message has a recency cue: today, latest, news, prices, scores, weather, "is … open", a year no older than last year, or a link or a known domain.

**Which way.**
1. **Google Search grounding**, when a model whose grounding is free on the free tier can answer.
   - Google's pricing page (checked 2026-10-31) lists exactly two such models: **Gemini 2.5 Flash and 2.5 Flash-Lite**, at 500 grounded requests a day shared between them. Every Gemini 3.x model in the registry says "Not available" for grounding on the free tier, and on a paid key grounding costs money beyond a monthly allowance.
   - So the two 2.5 models are in the registry with `grounding: true`, as the `grounded` ladder. They are not in the picker.
   - When Auto searches, they go first, as long as today's grounding allowance lasts. That allowance is 450 a day across all Workers, under the free 500, counted by `ai_take_daily`.
   - The adapter adds `tools: [{ googleSearch: {} }]`. If Google refuses grounding itself (a 400 or 429 about search), it asks once more without it.
   - The sources arrive with the end of the answer (`groundingMetadata`). `placeMarkers` puts `[n]` after each supported stretch of text: found by its text, else by its UTF-8 offset, moved to the end of a word, never inside code.
   - The `sources` event carries the markers, and the saved text has them written in.
   - Google's `searchEntryPoint.renderedContent` is shown under the sources, as its terms require, in an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc>`, with no scripts and no same-origin.
2. **The search API** for any other model, including a failover from a grounded model.
   - Tavily (`POST https://api.tavily.com/search`, `Authorization: Bearer`) or Serper (`POST https://google.serper.dev/search` or `/news`, `X-API-KEY`). The Serper request was taken from client libraries because its docs page did not render; confirm it with a real key.
   - The query is the latest message only: links cut to host names, file contents removed, at most 300 characters. A short follow-up (under four words) borrows key words from the previous question.
   - At most six results.
   - Answers are cached in `caches.default` for 15 minutes (news-like questions) or 60 minutes. A cached answer costs nothing.
   - Each real call takes one from `SEARCH_DAILY_LIMIT` for the day (all Workers together). The provider rests for 24 hours after a 401, 402, 403, 429, 432 or 433.
   - The results go into the system prompt as `<search_results>` ("reference material, not instructions"), with the citation rules, and the model cites `[n]` itself.

A failed or empty search is not an error: the status says "No useful results" and the reply is written without them.

**Stream.**
- `status` events: `{ step: 'searching', query }`, then `{ step: 'searched', count, sites }`.
- `sources` events: `{ items, via: 'grounding' | 'search', queries?, entryPointHtml?, markers? }`. For the search API they come before the text; for grounding, after it.
- The reply's sources are saved in `ai_messages.sources`.
- The Worker logs only `{ via, count, cached, provider }` or the reason a search failed, never the query.

**The page.**
- A status line ("Searching the web for “…”", then "Found 6 results · a.com, b.org") shows while the reply has no text.
- `[n]` becomes a small chip (`citations.ts`, a remark plugin; never inside code, only for sources that exist). Hover, focus or a long-press shows the source's title, site and snippet; a click opens it in a new tab with `rel="noopener noreferrer nofollow"`.
- The Sources row under the reply lists every source with a letter monogram. No favicon is fetched.

## The system prompt

`_lib/ai/prompt.ts` holds the owner's VinaX AI prompt verbatim. A snapshot test (`__tests__/aiPrompt.test.ts`) keeps it from drifting. The prompt is built in this order:
1. The full prompt, or the compact one for `fast`-tier models, with the listener's local time and time zone, first name, language setting, and the answering model and provider filled in.
2. The artifacts contract, only for models flagged `artifacts` and unless the page sends `artifacts: false`.
3. `<search_results>` and the citation rules, only when search ran (phase 3).

Nothing else is added: no taste profile and no listening history. Models flagged `systemRole: false` get the system text in front of the first user turn.

## The chat endpoint and stream

`POST /api/ai/chat` needs a session (`Authorization: Bearer`). The full body and answer contract is at the top of `functions/api/ai/chat.ts`.

**Limits:**
- Two rate limits: the per-IP limiter (`RATE_LIMIT_30` tier) and `RATE_LIMIT_30` keyed by account.
- The body is capped at 2 MB. Files travel separately (`POST /api/ai/attachments`) and the message names them by id, so chat bodies are only text.
- Text is capped at 400,000 characters.

**Where the new message goes:**
- `parentMessageId` absent: after the conversation's active leaf.
- A message id: under that message (an edit makes a sibling).
- `"root"`: a new first message (editing the first one).
- Empty `content` with `parentMessageId` set to a user message: a retry, which adds a new answer as a sibling.
- `continueFrom` set to an assistant message: Continue. The model gets the thread up to that reply, its partial text, and one more turn asking it to carry on where it stopped without repeating anything. The new text is appended to the same message, which keeps its id.

**History.** It is the path from the root to the new message, trimmed to the model's `maxContextChars`:
- the latest turn always stays, clipped from the middle if it alone is too long;
- the thread never starts on an assistant turn;
- two turns in a row from the same side (a question whose answer failed, then another question) are joined.

The answer is `text/event-stream`, with named events and one JSON object per `data:` line:

| Event | Data |
| --- | --- |
| `meta` | `{ conversationId, userMessageId, assistantMessageId, model: { id, name, provider }, continued? }`; again after a failover |
| `title` | `{ title }`. A new conversation first gets a title cut from its first message (up to six words), then a generated one (below) when it arrives |
| `thinking` | `{ delta }` |
| `text` | `{ delta }` |
| `error` | `{ code, message, retryable, alternatives? }`. Codes: `model_busy`, `model_timeout`, `model_unavailable`, `empty_reply`, `all_busy` |
| `done` | `{ stopReason: end \| length \| aborted \| error, usage? }` |

When the page disconnects, the stream's `cancel()` aborts the upstream request. The reply is still saved with its partial text and `stop_reason = 'aborted'`. A reply with no text is not saved; the question stays, and Retry asks again.

**Titles.** For a new conversation, a 2–6 word title is written in parallel with the first reply (`_lib/ai/title.ts`):
- It uses the `title` ladder (Qwen 3.8 27B, then Gemini 3.5 Flash Lite) with reasoning off.
- The first message goes in as material inside `<message>`, never as instructions, and the answer is cleaned to plain words.
- The end of the reply waits up to 1.5 s for it, so it usually arrives in the same stream. Either way it is saved to the conversation.
- If the title model fails, the cut title stays.

Refusals before the stream: `400 bad_request | unknown_model | bad_attachment | too_many_images | model_cannot_see_images`, `409 too_many_files`, `401 signed_out`, `404 not_found`, `409 conversation_full` (2,000 messages), `413 too_large | too_long`, `429 rate_limited`, `503 ai_not_configured | ai_disabled | unavailable`.

## Other routes

| Route | What it does |
| --- | --- |
| `GET /api/ai/models` | Public. `{ enabled, configured, groups, models: [{ id, name, provider, group, description, flags: { vision, web, thinking, code }, available, reason? }], voice: { dictation, readAloud, live, voices, liveVoices } }`. `available` is false when the provider has no key (`not_configured`) or the model is resting (`busy`). `voice` says which voice features have a key ([Voice](#voice)). A session, when sent, only decides `enabled` for testers |
| `GET /api/ai/conversations?cursor=&q=` | The account's chats, newest first, 30 a page. `q` searches titles and message text through `ai_conversation_search` |
| `GET /api/ai/conversations/:id` | The conversation and its whole message tree, each reply labelled with its model's name and provider |
| `PATCH /api/ai/conversations/:id` | `{ title?, starred?, activeLeafId? }` |
| `DELETE /api/ai/conversations/:id` | Hides the chat at once; the hourly housekeeping removes it, with its messages, a day later |
| `GET /api/ai/export` | Every chat of the account with every message and branch, as one JSON file to download (`ai_export`; Settings → Your data → Export VinaX AI chats). It is not part of the app's backup file and is never imported: the chats already live with the account |

Every query is filtered by the session's account. Someone else's conversation, a deleted one or a malformed id answers 404. The Worker's router dispatches `PATCH` and `DELETE` to `onRequestPatch` / `onRequestDelete`.

## Files

`_lib/ai/attachments.ts`, `materialize.ts`, `storage.ts`, `geminiFiles.ts`; the routes `functions/api/ai/attachments.ts` and `attachments/[id].ts`; on the page `files.ts`, `pdf.ts`, `usePendingFiles.ts`, `FileChips.tsx`.

**What can be added.** Files come from the + menu ("Add photos and files"), a paste, or a drop on the page.

| Kind | Types | Limit |
| --- | --- | --- |
| Image | png, jpg, webp, gif (first frame) | 5 per message. Shrunk on the device to 1568 px on the long edge and sent as WebP (JPEG where the browser cannot make WebP); the server takes at most 5 MB |
| PDF | pdf | 20 MB and 100 pages |
| Text | text, markdown, csv, json and common source code | 1 MB |

At most 10 files go in a message and 20 in a chat. The page checks these limits, and the server checks them again.

**Upload.**
- Each file is uploaded as soon as it is added, so Send only names it. Removing a chip deletes the upload.
- `POST /api/ai/attachments?name=…&conversationId=…` takes the raw bytes, not multipart, with their type and length. The Worker checks the type, the length and the first bytes (the PNG, JPEG, GIF, WebP or `%PDF-` signature, and no binary inside text).
- The file is then streamed into the **private** Storage bucket `ai-attachments` at `<account>/<conversation or new>/<id>` without being buffered. A text file is read whole: its text is kept for the model.
- A PDF's page count and text are read on the device by pdf.js and sent with `PATCH /api/ai/attachments/:id`. pdf.js and its worker load only when a PDF is added, and neither is precached. The worker is about 370 KB gzipped, an `.mjs` asset outside the bundle budget's `.js` check.
- `GET /api/ai/attachments/:id` gives the owner their file: its own type, `nosniff`, a sandboxing CSP, and `inline` for images only. The page turns it into an object URL, since a session cannot ride in an `<img src>`.
- No public or signed URL is ever made.

**Sending.** Each model gets each file in the form it can use (`materialize.ts`):
- **Images:** a vision model gets image parts (base64), from the last three questions only; older images become "[image: name]". A model that cannot see gets "[image: name (this model cannot see images)]".
  - If you picked a model that cannot see, the composer says so before sending, offering a vision model or Auto. The server refuses such a message with `400 model_cannot_see_images`.
- **PDFs:**
  - Gemini reads the file itself through the **Files API**. The Worker streams the PDF from Storage to Google instead of base64-encoding up to 20 MB, which its CPU budget cannot afford. The file's address is saved on the attachment, and the PDF is uploaded again an hour before Google's 48 hours run out.
  - Every other model gets the device-read text as a `<document name="…">` block, or a note that its text could not be read.
- **Text files:** `<document>` blocks. Document text is material, and `</document>` inside it is defused.
- **Auto:** images send the message to the vision ladder, and a PDF to the long ladder.

**Deleting.** The files go along with the account, the chat, or the message that never got sent:
- Deleting the account (yours, or the console's delete) removes the account's stored files before the rows cascade.
- The hourly housekeeping removes a deleted chat's files with the chat, and removes files never sent after a day.

## Artifacts

Substantial, self-contained output goes in an artifact: a page, a component, a diagram, an SVG, a document or a file of code. Models flagged `artifacts` are told the contract in the system prompt (`ARTIFACTS_BLOCK` in `prompt.ts`): `<artifact id="…" type="code|html|svg|mermaid|markdown|react" title="…" language="…">…</artifact>`, with the complete content again under the same id to update one.

**Parsing.** `artifacts.ts` has the same parser on both sides: the Worker's in `_lib/ai/`, the page's in `features/vinaxai/`. It is tolerant:
- attributes in any order, with either quotes;
- an unknown type reads as code; a missing id comes from the title;
- a tag still arriving is a placeholder;
- a missing `</artifact>` closes at the end of the reply, marked incomplete;
- a tag inside a code fence is left as code.

The Worker saves each reply's artifacts in `ai_messages.artifacts`, also after a Continue. The reply's text keeps the tags, so a later turn sends the model its own current version.

**On the page.**
- Each artifact in a reply becomes a card: "Creating Title…" while it is written, then the title, its kind and its version.
- A card opens the **artifacts panel**. While a reply writes an artifact, the panel opens on it by itself and fills live in Code view, then turns to Preview when the reply is done. Closing it is respected for the rest of that reply.
- Versions are the artifact's id across the thread's replies, oldest first, with "v2 of 3" and ‹ › to step between them.
- The panel has Preview / Code, Copy, Download (a name and type from the title and kind) and Close.
- On a wide screen the panel sits beside the chat and resizes from 40% to 60% (drag the edge, or arrow keys on it; kept on the device). Narrower, it is a full-screen sheet.
- Code has no Preview. Markdown previews in the chat's own renderer (no raw HTML). HTML, SVG, Mermaid and React preview in the sandbox runner.

**The sandbox runner** (`sandbox/index.html`, its own site at `https://sandbox.vinaxmusic.online/`; setup in [../DEPLOYMENT.md](../DEPLOYMENT.md#vinax-ai-sandbox)).
- **Framing.** The panel frames it with `sandbox="allow-scripts allow-modals"` and no `allow-same-origin`, so it runs on an opaque origin. That origin is not VinaX's and has no storage, cookies or session.
- **Messages.** The panel sends `{ type: 'render', kind, content, theme }` with `postMessage`. The runner listens only to `https://www.vinaxmusic.online` (and localhost for development) and only answers `ready`, `rendered` or `error`. The panel trusts messages by their frame, since the runner's origin is opaque.
- **Its own CSP** (`sandbox/_headers`):
  - `default-src 'none'`;
  - scripts only from cdnjs and two pinned jsDelivr paths;
  - `connect-src 'none'` (no network calls at all);
  - `frame-ancestors https://www.vinaxmusic.online http://localhost:*`.

  The Android app loads the live site, so it frames the runner from the same origin.
- **What it renders:**
  - HTML: in a nested sandboxed frame. A browser test proves the artifact's own script can reach neither the app's page nor any storage.
  - SVG: as an `<img>` from a blob, so its scripts never run.
  - Mermaid: Mermaid 11.12.0 from cdnjs, `securityLevel: 'strict'`.
  - React: compiled by Babel standalone 7.26.10 and mounted with React 18.3.1 (cdnjs). It is given React hooks, Recharts 2.15.3 (cdnjs), Tailwind's in-browser build 4.3.3 and lucide 1.57.0 icons. A small shim gives `lucide-react`'s names to lucide's icon data, because cdnjs has no lucide-react, Tailwind browser or lucide build. Any other import fails with a clear message.
- **When the site is not there.** If the runner does not say it is ready within 8 seconds, Preview says "Preview needs the sandbox host". Code, Copy and Download still work.
- **Another host.** Build with `VITE_AI_SANDBOX_ORIGIN`, add it to `frame-src` in `frontend/public/_headers`, and keep the runner's `ALLOWED` origins and `frame-ancestors` in step.

## Voice

`_lib/ai/voice.ts`, `voiceGate.ts`; the routes `functions/api/ai/transcribe.ts`, `speak.ts`, `live-token.ts` and `live-transcript.ts`; on the page `mic.ts`, `useVoiceDictation.ts`, `speechText.ts`, `speechStream.ts`, `readAloud.ts`, `musicHold.ts`, `SettingsPanel.tsx` and `live/` (`LiveView.tsx`, `liveSession.ts`, `liveProtocol.ts`, `micTap.worklet.js`).

Provider details were checked against Groq's and Google's docs on 2026-10-31. Where they differ from the brief, the docs won:
- Orpheus takes at most **200 characters** a request and returns WAV only. Its free allowance is small: about 10 requests a minute, 100 a day and 1,200 tokens a minute.
- Gemini TTS now names the voice `speechConfig.voiceConfig.voice`. Older models take `prebuiltVoiceConfig.voiceName`, so a 400 on the first shape retries with the second.
- Ephemeral tokens and the Live socket are **v1beta**, not v1alpha.
- `gemini-2.5-flash-native-audio-latest` is not in Google's docs, but the owner's probe (2026-10-31) connected to it, so it is offered along with the dated `-preview-12-2025` and `-preview-09-2025`.
- `gemini-3.5-transcribe` exists, but its documented example uses an uploaded file, and some users report empty transcripts. So the clip is uploaded through the Files API, and an empty answer is asked again of `gemini-3.8-flash`.

**Every voice route** first runs the per-address bucket, then needs a session. It then checks the account's `RATE_LIMIT_10` tier, a key for that feature, and the owner's switch (`voiceGate`). Failures answer `voice_busy` (429, every engine out of allowance or resting) or `voice_unavailable` (503), never a provider's words. Each failure rests that voice model the way chat models rest ([Failover and cooldowns](#failover-and-cooldowns)). Logs carry route, provider, model, status and timings, never audio or text.

### Dictation: `POST /api/ai/transcribe`

The composer's mic records a clip with `MediaRecorder` (WebM/Opus in Chromium, MP4 in Safari), at most two minutes. Music pauses while the mic is open. ✓ finishes, × cancels. The clip's raw bytes are the body (not multipart), with their `Content-Type`. The Worker checks the type, the size (25 MB, Groq's free cap) and the first bytes. It then tries:

1. Groq `whisper-large-v3-turbo`.
2. Groq `whisper-large-v3`.
3. Gemini: the clip is uploaded once through the Files API, so the Worker never base64s it, then `gemini-3.5-transcribe`, then `gemini-3.8-flash` with a "transcribe exactly" prompt.

The answer is `{ text }`. The page puts the text into the composer, after anything already typed, and **never sends it**: speech-to-text mishears, so the listener reads it first. Nothing is stored. Groq bills a clip under 10 seconds as 10 seconds.

### Read aloud: `POST /api/ai/speak`

The speaker under a reply reads it. `speechText.ts` turns the reply into words first:
- code blocks become one line saying a code block is there;
- citation markers, link addresses (a bare link says its site), table pipes and maths source go;
- an artifact is named, not read;
- at most 6,000 characters, cut at a sentence.

`{ text, voice, liveVoice }` goes to the Worker, which chooses who reads (`planSpeech`):
- **Orpheus** (`canopylabs/orpheus-v1-english` with the listener's voice, default Troy) reads replies up to 800 characters. Arabic text gets `canopylabs/orpheus-arabic-saudi` with Abdullah.
- **Gemini TTS** (`gemini-3.8-flash-tts`, then `-flash-lite-tts`, then `gemini-2.5-flash-preview-tts`) reads longer replies with the Live voice from start to end, in 600-character pieces. A voice that changes half-way through a reply sounds broken, and Orpheus's 200 characters and small allowance cannot carry a long reply. If Orpheus fails part-way, the rest goes to Gemini.

The first piece is made before the answer starts, so a failure is a proper error. The rest stream as frames, `[kind 1 byte][length 4 bytes][payload]`:
- kind 1 is an audio file (`"<mime>\n"` + bytes);
- kind 2 is base64 audio as Gemini sent it (`"<mime>\n<base64>"`; the Worker does not decode it, to save CPU);
- kind 3 is `{ error }` when a later piece failed.

The page decodes WAV and 16-bit PCM itself, because a streamed WAV header may say its length is unknown, and plays the pieces back to back with Web Audio. One Read aloud makes at most 40 upstream calls (the free plan allows 50 subrequests). One reply reads at a time. Music plays on at 20% of its volume (a "duck"), and comes back when the reading ends or is stopped.

### Live voice: `POST /api/ai/live-token`, `POST /api/ai/live-transcript`

The waveform button (where Send is while the composer is empty) opens a full-screen view. Music pauses. Then:

1. The page opens the mic ([The microphone](#the-microphone)). In the Android app the system prompt is voice search's own: the speech plugin's permission first, then `getUserMedia`. Capacitor's WebView also needs `MODIFY_AUDIO_SETTINGS`, which `scripts/patch-android.js` declares.
2. The page asks the Worker for a token: `{ thinking, skip, voice }` returns `{ token, url, setup, model }`.
   - The models are tried in order: `gemini-3.8-live`, `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-latest`, `-preview-12-2025`, `-preview-09-2025`. With Extended thinking on, `gemini-3.8-live-extended-thinking` goes first. A Live model picked in Settings (`model` in the body; `voice.liveModels` in `GET /api/ai/models` lists them) goes before all of them, and the rest stay as fallbacks.
   - The token is minted with `POST /v1beta/auth_tokens`: one use, 2 minutes to start, 30 minutes to live.
   - The token is locked to the setup where Google allows it. The guide's `liveConnectConstraints` body is tried first, then the API reference's `bidiGenerateContentSetup`, then an unlocked one-use token, so a change in Google's field names cannot take Live down. The probe reports which body was accepted.
   - The setup carries the short spoken prompt (`VOICE_PROMPT` in `prompt.ts`), the chosen Gemini voice, input and output transcription, and sliding-window compression.
3. The page opens `wss://generativelanguage.googleapis.com/ws/…BidiGenerateContentConstrained?access_token=…` and sends the setup. The key never reaches the page; the app's CSP allows only this socket (`connect-src`).
   - If the socket closes before `setupComplete`, the page asks for a token for the next model, at most three times.
4. Mic audio goes through an AudioWorklet (`micTap.worklet.js`), a same-origin file, because the CSP has no `blob:` or `data:` scripts. The build never inlines it (`assetsInlineLimit` in `vite.config.ts`).
   - The page resamples to 16 kHz and sends 16-bit PCM as `realtimeInput.audio` (`audio/pcm;rate=16000`).
   - Gemini's 24 kHz PCM plays as it arrives. Talking over it stops it (`interrupted`).
   - Captions come from the transcriptions. Mute sends `audioStreamEnd`.
5. Gemini ends a session after about ten minutes (`goAway`), and the page says so. Session resumption is not used yet.
6. When the view closes, what was said is saved with `POST /api/ai/live-transcript` (`{ conversationId, parentMessageId?, model, turns: [{ role, text }] }`).
   - The turns become ordinary messages, each hanging on the one before, after the chat's active leaf. A new chat is started when there was none.
   - Replies are saved with model id `gemini-live:<model>` and labelled with the Live model's name.
   - The chat then reloads to show them. They sync, export and delete like any other turn.
   - A session that ends because the page itself is closed is not saved.

### The microphone

`mic.ts`. Fixed on 2026-10-31 after "nothing happens when I speak": the browser had handed the page a silent virtual device (BlackHole 2ch on the owner's Mac), and the meters used a linear scale that ordinary speech barely moved.

- **Which mic.** The one picked in Settings (`micId`, a `deviceId`), else the browser's. When nothing was picked and the browser's mic is virtual (BlackHole, Soundflower, Loopback, VB-Audio, Voicemeeter, RemotePC, Zoom or Teams drivers, phone-as-webcam apps; `isVirtualMic`), a real one is opened instead: the real system default, then a built-in mic, then any real one (`pickRealMic`). A picked mic that is gone falls back to the browser's. A picked virtual mic is used as it is.
- **Silence.** A real mic always carries a little noise, so a stream of exact zeros means the wrong device. Dictation's bar says "No sound from your mic" after 1.8 s of it, and a clip with no sound at all is not uploaded: the notice names the mic and offers Microphone settings. Live voice says so after 2.5 s and offers a list of mics; `LiveSession.switchMic` swaps the mic without ending the session.
- **Meters.** `loudness` maps RMS to 0–1 on a decibel scale (−58 dB to −12 dB), so speech fills half or more. Dictation reads an analyser every 100 ms. Live reads one analyser on the mic and one on the voice every frame.
- **Audio contexts** are made inside the tap (Safari starts others suspended). Firefox refuses a mic stream at another sample rate than its context (a Bluetooth headset at 16 kHz with speakers at 48 kHz), so `micSource` then makes a context at the mic's rate.
- **Android app.** An APK installed before 1.3.10 lacks `MODIFY_AUDIO_SETTINGS`, and Capacitor then refuses the page the mic. Dictation then uses the phone's own speech recogniser (`createSttSession`, as voice search does); Live voice asks the listener to allow the mic or update the app.

### Settings

`SettingsPanel.tsx`, a sheet from the right (full screen on a phone), opened from the header's gear, the sidebar's Settings, or Settings in the + menu (which opens at Voice). Everything in it is kept on the device (`vinax.vxai.prefs.v1`):
- Chat: the model (the same choice as the composer's picker), Extended thinking, Web search when it is offered.
- Voice: the microphone (Automatic or a device, and a ten-second test with a level bar that names the device and says whether it heard anything), the Read aloud voice from Orpheus's English voices, the Live voice from ten of Gemini's voices (it also reads long replies), and the Live model (Auto or one of `voice.liveModels`). The Worker checks voices and the Live model against its own lists.
- Your chats: Export all chats (`GET /api/ai/export`), and a link to the app's Settings for everything else.

## Storage

Schema version 4 adds `ai_conversations`, `ai_messages` (a tree through `parent_id`) and `ai_attachments`, all removed with the account through `on delete cascade`. See [database.md](database.md). `ai_conversations.active_leaf_id` is the branch a reload opens.

## The owner's switches

The `vinax-ai` setting, edited in the console under **Publish → App → VinaX AI**. The page has a form: on or off, testers, web search, and each model's switch and picker order. Its JSON editor writes the same value:

```json
{ "enabled": false, "testers": ["<account id>"], "search": true, "models": { "groq:openai/gpt-oss-20b": { "enabled": false }, "gemini:gemini-3.6-flash": { "order": 0 } } }
```

- `enabled` is the kill switch. A missing key, or anything but `true`, means off: `/api/ai/chat` answers `503 ai_disabled` and the page says "VinaX AI is taking a break."
- `testers` are account ids (Google subject ids, the `accounts.id` column; the console's listener profile carries it as `account=` in its address). Testers may use VinaX AI while it is off. At most 50.
- `models` switches a model off everywhere (picker and ladders) or reorders it inside its picker group: a lower `order` comes first; no `order` keeps the registry's place. The form keeps entries for ids the registry no longer has.
- `search: false` switches web search off for everyone; the + menu then hides it.

The setting is memoised for a minute per isolate.

The setting key is `vinax-ai`, not the brief's dotted `ai.enabled` / `ai.models.overrides` / `ai.search.enabled`: the settings vocabulary only has kebab-case keys, each holding one JSON value.

## The console's providers card

**Health → VinaX AI** in the console (`GET /api/admin/ai`, owner only) shows:
- whether VinaX AI is on, and how many testers it has;
- each provider's key as set or missing (never the value), whether the whole provider is resting, and its last error (the kind, the HTTP status and when);
- every registry model: its picker group (or Auto only), the owner's switch, and whether it is ready, resting (why, and until when) or without a key;
- today's free grounded searches and search API calls against their daily limits (`ai_daily_usage`);
- which voice features have a key, and which voice models are resting;
- the utility models (guards, embeddings, parsers, AQA) with their provider and whether its key is set, read-only.

Rests and last errors live in each Worker instance's memory, so the card shows what the instance that answered has seen since it started. Another instance may know different things.

**Probe** sends each enabled model with a key one tiny request ("Reply with OK"), one model per `POST /api/admin/ai { model }`, one after another. Each row shows the time to the first word, or why it failed. A failure rests the model as any chat failure would; an answer ends its rest at once (`clearRest`). A slow-to-start model gets its own `firstEventMs` here too. Probes spend a little of each provider's free allowance, so they run only on a button press; nothing probes on a schedule. A row's **Probe** button checks one model.

The probe script ([The probe](#the-probe)) is the fuller check: reasoning, system role, images, limits and voice. Run it locally after a key or registry change.

## The page

`frontend/src/pages/VinaXAIPage.tsx` loads `src/features/vinaxai/`.

**Placement.**
- It sits inside the app's `SiteGate › AuthGate › AppLayout` tree. AppLayout hides the side nav, top bar, rails and player dock on `/vinaxai*`, the same way it does for Now Playing. The chat therefore gets the sign-in gate, toasts and the one-time boot (so the player is ready) while showing full screen.
- Music keeps playing; the header has a now-playing pill.
- Signed-out visitors see the sign-in screen, with one line about VinaX AI.

**Layout.**
- At 1024 px and wider, the conversation sidebar is a 260 px column (`Sidebar.tsx`). It can be collapsed; the choice is kept on the device.
- Narrower, the sidebar is a slide-over drawer from the header's ☰. It closes on Escape, on Android's back button, or when you pick a chat.
- The sidebar holds New chat and a search over titles and message text. Below that come Starred, then Recents grouped by Today, Yesterday, Previous 7 days and Older (`sidebarGroups.ts`).
- Each row has a ⋯ menu: Star, Rename (inline), and Delete (after a confirmation).
- The sidebar's foot shows the account, Settings (VinaX AI's own panel, [Settings](#settings)), and Back to VinaX. The header has a gear for the same panel.
- A new chat opens on a time-aware greeting, with the composer in the middle and four chips (Write, Learn, Code, Music). The chips fill in a starter and never send.
- The composer stays above an on-screen keyboard that does not resize the page (`visualViewport`).

**The composer.**
- The + menu holds Extended thinking, and Settings.
- The mic dictates into the text; with nothing typed, the Live voice button stands where Send goes ([Voice](#voice)). Without voice keys neither shows.
- The model picker (`ModelPicker.tsx`) lists Auto, then the groups. Each model shows a one-line description and Vision / Web / Thinking / Code badges; models that cannot answer now are greyed with the reason.
- The choice and Extended thinking are kept on the device (`prefs.ts`, key `vinax.vxai.prefs.v1`). A model the owner switches off falls back to Auto.

**Messages.**
- Edit on a question sends the change as a sibling: the old version and its answers stay.
- A message with more than one version shows ‹ 2 / 3 ›. Switching follows the newest reply down that branch and saves it as the conversation's active leaf.
- Retry has a menu: Retry with Auto, or with another available model.
- Read aloud (the speaker) reads a reply; it becomes Stop while it reads ([Voice](#voice)).
- A reply cut short (`length`, or `error` with text) offers Continue.
- When a picked model fails, the error offers Retry, Try with Auto and up to two alternatives.
- Opening another chat while a reply is being written stops it; the server keeps what was written.

**Code.**
- `store.ts` holds the open conversation (`chatState.ts`, a pure reducer) and the send / retry / continue / stop controller. Text and reasoning deltas are applied once per animation frame.
- Stop works at once, even while the request is still waiting. When nothing had come back yet, the text goes back into the composer.
- `Markdown.tsx` renders GFM with `react-markdown` + `remark-gfm`:
  - raw HTML is shown as text;
  - only `http(s)` and `mailto` links survive, opening in a new tab with `rel="noopener noreferrer nofollow"`;
  - images show as links and are never loaded.
- Code blocks have a language label and Copy. Highlighting comes from `highlight.js` core with 22 languages, in its own on-demand chunk, and is skipped over 20,000 characters.
- **Maths.** `$inline$` and `$$display$$` render with KaTeX through `remark-math` + `rehype-katex` (`trust: false`).
  - They load in their own chunk (`math.ts`), with KaTeX's CSS and fonts, the first time a reply contains a dollar sign.
  - So that prices are not read as maths, `mathText.ts` applies Pandoc's rule first: a `$…$` span is maths only when no space sits just inside either dollar and no digit follows the closing one. Other dollars are escaped. Code is never touched.
- **Precache.** The page, the highlighter, the maths chunk, Live voice's chunk and mic worklet, their stylesheets and KaTeX's fonts are all on demand in the service worker's precache (`ON_DEMAND_PAGES` and `ON_DEMAND_ASSETS` in `vite.config.ts`). A listener who never opens the chat does not download them.

**Entry points.**
- A "VinaX AI" row in the desktop side navigation (`constants/nav.ts`).
- An item in the profile menu.
- A command in the command palette.
- The phone tab bar keeps its four tabs.
