# VinaX AI

This document covers VinaX AI, the chat assistant at `/vinaxai`:
- how a message travels from the page through the Worker to a model and back;
- the providers and their secrets;
- the model registry and Auto's ladders, and failover and cooldowns;
- the stream protocol;
- how conversations are stored;
- the owner's switches, the probe script, and what happens when a provider is down.

VinaX AI is the only AI in VinaX. Recommendations, Radio and Up Next stay on the listener's device ([recommendations.md](recommendations.md)). The chat is built in phases. This page describes what exists now; phases still to come are listed at the end.

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
| `GROQ_API_KEY` | Groq (OpenAI-compatible) | The fast default models (GPT-OSS, Qwen) |
| `GEMINI_API_KEY` | Google Gemini (native `streamGenerateContent?alt=sse`) | Images, PDFs and long threads (phases 3–4 add grounding and files) |
| `OPENROUTER_API_KEY` | OpenRouter (OpenAI-compatible) | `:free` code models and mirrors |
| `NVIDIA_API_KEY` | NVIDIA NIM (OpenAI-compatible) | Reasoning and vision models |
| `AI` (`[ai] binding = "AI"`) | Cloudflare Workers AI | Last resort in the default ladder |

Any one of them is enough for the chat to work. With none, `/api/ai/*` answers `503 ai_not_configured` and the page shows "VinaX AI is unavailable right now". The Gemini key travels in the `x-goog-api-key` header, never in a URL. OpenRouter calls carry `HTTP-Referer: https://www.vinaxmusic.online` and `X-Title: VinaX AI`. How to set the secrets: [../DEPLOYMENT.md](../DEPLOYMENT.md#vinax-ai).

## The registry

`backend/worker/functions/_lib/ai/models.ts` is the only place that names a model id. Each entry has:
- a registry id, `<provider>:<upstream id>`;
- a display name and a picker group (`fast`, `balanced`, `smart`, `vision`, `code`, `cloudflare`, or none for failover-only models);
- a tier (`fast` models get the compact prompt);
- flags: `vision`, `pdf`, `grounding`, `reasoning`, `artifacts`, `systemRole`, `thinkFormat`;
- `maxContextChars`, `maxOutput`;
- extra request fields in `params`, plus `highParams` for Extended thinking.

Models in the picker, in group order:

| Group | Models |
| --- | --- |
| Fast | Qwen 3.8 27B (Groq), GPT-OSS 20B (Groq) |
| Balanced | **GPT-OSS 120B** (Groq; Auto's default), Gemini 3.5 Flash, Nemotron 3.5 Lightning (NVIDIA) |
| Smart | Gemini 3.6 Flash, Nemotron 3 Ultra 550B (NVIDIA), Step 5 Preview (NVIDIA) |
| Vision | Nemotron 3.5 Super VL (NVIDIA) |
| Code | North Mini Code, Laguna S 2.1 (OpenRouter `:free`) |
| Cloudflare | Llama 3.3 70B, Llama 3.1 8B (Workers AI) |

Failover-only models:
- Gemini 3 Flash Preview, 3.5 Flash Lite, 3.1 Flash Lite and Flash Lite (latest);
- Nemotron 3 Nano Omni and GPT-OSS 20B on NVIDIA;
- the OpenRouter `:free` mirrors of Lightning, Ultra, Super VL and Nano Omni, and Laguna XS 2.1.

The Workers AI ids were taken from Cloudflare's public model list, because the build could not see the owner's account. They are marked `unconfirmed` until the probe confirms them.

Groq's free tier counts tokens per minute, so Groq models keep a short history (`maxContextChars` 30,000). A long thread goes to the long ladder instead.

### The probe

`npm run ai:probe` (in `backend/`, script `scripts/ai-probe.mjs`) is run by the owner with their own keys, never in CI.
- It reads `worker/.dev.vars`. For Workers AI over REST it also needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.
- For every registry model it sends one streamed request, plus one image request for models flagged `vision`.
- It prints time to first token, whether the reply streamed, where reasoning arrived (`field`, `tags`, `parts` or none), whether the system message was followed, whether the image was read, and the context and output limits the provider reports.
- Options: `--only <text>` limits it to ids containing the text; `--no-image` skips the image check.
- It prints nothing secret and writes nothing.

Use its table to set the registry flags. Use the owner's latency measurements to choose models.

## Auto

`pickLadder` (`_lib/ai/router.ts`) uses cheap checks, never an extra model call. It checks in this order:

| Signal | Ladder |
| --- | --- |
| The message has images (phase 4) | vision: Gemini 3.6 Flash → Gemini 3.5 Flash → Nemotron 3.5 Super VL → its OpenRouter mirror |
| A PDF (phase 4), or the thread is over 150,000 characters | long: Gemini 3.6 Flash → Gemini 3.5 Flash → Gemini 3 Flash Preview → GPT-OSS 120B |
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

**When a provider is down,** its models rest after their first failure and Auto answers from the next provider. If every model fails, the page shows "VinaX AI is busy right now. Try again in a moment." with a Retry button.

## Reasoning

`ThinkSplitter` (`_lib/ai/think.ts`) is shared by every adapter. It sends reasoning to `thinking` events whichever way it arrives:
- a `reasoning` / `reasoning_content` delta field;
- `<think>…</think>` at the start of the text, even when a tag is split across chunks;
- Gemini thought parts.

Raw `<think>` tags never reach the reply. Reasoning is capped at 20,000 characters per reply. A stream that ends inside `<think>` with no answer counts as an empty answer, so Auto fails over.

## The system prompt

`_lib/ai/prompt.ts` holds the owner's VinaX AI prompt verbatim. A snapshot test (`__tests__/aiPrompt.test.ts`) keeps it from drifting. The prompt is built in this order:
1. The full prompt, or the compact one for `fast`-tier models, with the listener's local time and time zone, first name, language setting, and the answering model and provider filled in.
2. The artifacts contract, only for models flagged `artifacts` and only once phase 5 turns artifacts on.
3. `<search_results>` and the citation rules, only when search ran (phase 3).

Nothing else is added: no taste profile and no listening history. Models flagged `systemRole: false` get the system text in front of the first user turn.

## The chat endpoint and stream

`POST /api/ai/chat` needs a session (`Authorization: Bearer`). The full body and answer contract is at the top of `functions/api/ai/chat.ts`.

**Limits:**
- Two rate limits: the per-IP limiter (`RATE_LIMIT_30` tier) and `RATE_LIMIT_30` keyed by account.
- The body is capped at 2 MB. Files travel separately by id (phase 4), so chat bodies are only text.
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

Refusals before the stream: `400 bad_request | unknown_model | attachments_unavailable`, `401 signed_out`, `404 not_found`, `409 conversation_full` (2,000 messages), `413 too_large | too_long`, `429 rate_limited`, `503 ai_not_configured | ai_disabled | unavailable`.

## Other routes

| Route | What it does |
| --- | --- |
| `GET /api/ai/models` | Public. `{ enabled, configured, groups, models: [{ id, name, provider, group, description, flags: { vision, web, thinking, code }, available, reason? }] }`. `available` is false when the provider has no key (`not_configured`) or the model is resting (`busy`). A session, when sent, only decides `enabled` for testers |
| `GET /api/ai/conversations?cursor=&q=` | The account's chats, newest first, 30 a page. `q` searches titles and message text through `ai_conversation_search` |
| `GET /api/ai/conversations/:id` | The conversation and its whole message tree, each reply labelled with its model's name and provider |
| `PATCH /api/ai/conversations/:id` | `{ title?, starred?, activeLeafId? }` |
| `DELETE /api/ai/conversations/:id` | Hides the chat at once; the hourly housekeeping removes it, with its messages, a day later |
| `GET /api/ai/export` | Every chat of the account with every message and branch, as one JSON file to download (`ai_export`; Settings → Your data → Export VinaX AI chats). It is not part of the app's backup file and is never imported: the chats already live with the account |

Every query is filtered by the session's account. Someone else's conversation, a deleted one or a malformed id answers 404. The Worker's router dispatches `PATCH` and `DELETE` to `onRequestPatch` / `onRequestDelete`.

## Storage

Schema version 4 adds `ai_conversations`, `ai_messages` (a tree through `parent_id`) and `ai_attachments`, all removed with the account through `on delete cascade`. See [database.md](database.md). `ai_conversations.active_leaf_id` is the branch a reload opens.

## The owner's switches

The `vinax-ai` setting (console → Publish → App → VinaX AI, JSON editor):

```json
{ "enabled": false, "testers": ["<account id>"], "search": true, "models": { "groq:openai/gpt-oss-20b": { "enabled": false }, "gemini:gemini-3.6-flash": { "order": 0 } } }
```

- `enabled` is the kill switch. A missing key, or anything but `true`, means off: `/api/ai/chat` answers `503 ai_disabled` and the page says "VinaX AI is taking a break."
- `testers` are account ids (Google subject ids, the `accounts.id` column; the console's listener profile carries it as `account=` in its address). Testers may use VinaX AI while it is off.
- `models` switches a model off everywhere (picker and ladders) or reorders it inside its picker group.
- `search` is read by phase 3.

The setting is memoised for a minute per isolate.

The setting key is `vinax-ai`, not the brief's dotted `ai.enabled` / `ai.models.overrides` / `ai.search.enabled`: the settings vocabulary only has kebab-case keys, each holding one JSON value.

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
- The sidebar's foot shows the account, Settings, and Back to VinaX.
- A new chat opens on a time-aware greeting, with the composer in the middle and four chips (Write, Learn, Code, Music). The chips fill in a starter and never send.
- The composer stays above an on-screen keyboard that does not resize the page (`visualViewport`).

**The composer.**
- The + menu holds Extended thinking.
- The model picker (`ModelPicker.tsx`) lists Auto, then the groups. Each model shows a one-line description and Vision / Web / Thinking / Code badges; models that cannot answer now are greyed with the reason.
- The choice and Extended thinking are kept on the device (`prefs.ts`, key `vinax.vxai.prefs.v1`). A model the owner switches off falls back to Auto.

**Messages.**
- Edit on a question sends the change as a sibling: the old version and its answers stay.
- A message with more than one version shows ‹ 2 / 3 ›. Switching follows the newest reply down that branch and saves it as the conversation's active leaf.
- Retry has a menu: Retry with Auto, or with another available model.
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
- **Precache.** The page, the highlighter, the maths chunk, their stylesheets and KaTeX's fonts are all on demand in the service worker's precache (`ON_DEMAND_PAGES` and `ON_DEMAND_ASSETS` in `vite.config.ts`). A listener who never opens the chat does not download them.

**Entry points.**
- A "VinaX AI" row in the desktop side navigation (`constants/nav.ts`).
- An item in the profile menu.
- A command in the command palette.
- The phone tab bar keeps its four tabs.

## Not built yet

These phases are still to come:

| Phase | What it adds |
| --- | --- |
| 3 | Web search with citations |
| 4 | Attachments |
| 5 | Artifacts and the sandbox |
| 6 | Voice |
| 7 | The console's providers card and Probe button |
