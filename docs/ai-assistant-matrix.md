# VinaX AI — feature matrix

What the assistant surface does in 11.0, checked against the code rather than against intent. VinaX AI is VinaX's own assistant; where a general-purpose assistant has something it does not, this file says so plainly. Developer detail is in [ai.md](ai.md); the listener's guide is [user-guide/vinax-ai.md](user-guide/vinax-ai.md). Frontend paths are relative to `frontend/src/`, backend paths to `backend/worker/functions/`.

Status words:

- **done** — implemented, and covered by a test or verifiable by reading the code.
- **partial** — works, with a stated limit.
- **missing** — not implemented.
- **provider-dependent** — the app side is done; whether it works depends on the keys the owner has set and what the providers offer for free that day.
- **out of scope** — deliberately not pursued, with the reason.

## Shell, history and navigation

| Feature | Status | Where / note |
| --- | --- | --- |
| Collapsible desktop sidebar, slide-over on phones | done | `features/ai/chat/Sidebar.tsx`; the collapsed state is remembered (`sidebarCollapsed` in `storage.ts`) |
| History grouped by recency, pinned first; search over titles and message text | done | `storage.ts` `groupChats` |
| Rename, pin, delete a chat | done | `Sidebar.tsx` |
| Export one chat; export every chat as JSON; import, validated field by field | done | `storage.ts` `exportChat`, `exportAllChats`, `importChats` |
| Chats kept on the device | partial | `vinax_ai_chats_v1`, at most `MAX_STORED_CHATS`; images are stripped before saving |
| Temporary chat, never written to the device | done | dropped in `persistChats` |
| Projects with instructions and reference files | partial | `features/ai/projects.ts`, `chat/ProjectSheet.tsx`; 10 files per project, 20,000 characters each |
| **Chat styles** — the chat restyles itself to the model's maker family (11.0) | done | `chat/chatStyle.ts`, `ChatStyleScope.tsx`, `styles/ai-styles.css`; nine styles; `chatStyle.test.ts` |
| **Chat style setting** — Match the model / Always VinaX / one fixed style (11.0) | done | chat settings → General; `vinax.ai.chatStyle`; restored by `features/settings/backup.ts` |

## The conversation

| Feature | Status | Where / note |
| --- | --- | --- |
| Streamed replies, Stop mid-stream | done | `streamClient.ts`, `streamReducer.ts`; the Worker stops reading the provider when the listener disconnects |
| One automatic re-ask on a passing failure | done | `runChatStream`: `busy` after 2.5 s, `unavailable` after 1.2 s |
| **Failure kinds, each with its own line** (11.0) | done | `StreamFailure`: `offline`, `busy`, `unavailable`, `disabled`, `over_budget`, `bad_model`, `too_large`, `rejected`; `streamClient.test.ts` |
| **Edit message instead of Retry where a retry cannot succeed** (11.0) | done | `needsEdit()` — `too_large` and `rejected`; `Message.tsx` |
| **A withdrawn model switches the chat to Auto** (11.0) | done | `unknown_model` → `bad_model` |
| **A reply interrupted by a reload** shows "No reply — try again" (11.0) | done | `storage.ts` |
| Regenerate with a different approach; rewrite; continue a cut-short reply | done | `REGENERATE_RULE` in `buildChatRequest.ts`; `rewriteLast`, `continueReply` in `pages/VinaXAIPage.tsx` |
| Edit and resend, keeping the earlier version as a `· before edit` chat | done | `pages/VinaXAIPage.tsx` |
| Branch a conversation from a message | done | `branchFrom` |
| Follow-up suggestions | provider-dependent | `features/ai/followups.ts`; the model is asked for them and may not supply any |
| Long conversations | partial | client: `chat/longThread.ts` sends recent turns verbatim and lists earlier questions; server: `trimHistory` drops the oldest turns beyond 120,000 characters |
| Model-written conversation summary | out of scope | it needs an extra model call per long turn |
| Reasoning is never shown as an answer | done | the Worker's `<think>` gate; unclosed reasoning ends as a cut-short reply (`aiAuditSweep.test.ts`, `aiChatAudit.test.ts`) |

## Rendering

| Feature | Status | Where / note |
| --- | --- | --- |
| Markdown, tables, lists, checklists, code blocks, copy | done | `components/ai/tokenize.ts`, `RichContent.tsx`; the 11.0 parser cannot stall on any input (`tokenize.test.ts`) |
| Math and diagrams | done | loaded on demand (`RICH_RENDER_ROOT` in `frontend/vite.config.ts`); diagrams follow the theme |
| Charts | done | `components/ai/ChartBlock.tsx`, `chartSpec.ts` |
| Artifact panel for documents and code in replies | done | `features/ai/artifacts/` |
| Authoring an artifact in a canvas | out of scope | VinaX AI writes replies, not documents |
| Read a reply aloud | provider-dependent | `features/ai/readAloud.ts`; server speech needs a provider with a free speech model, else the device voice |
| Dictation into the composer | done | `useDictation.ts` (device), `useServerDictation.ts` (server); merges with the typed draft |
| Live voice conversation | provider-dependent | `useLiveVoice.ts`, `LiveVoiceHost.tsx` |

## Attachments

| Feature | Status | Where / note |
| --- | --- | --- |
| Images, up to 6 per message | partial | `attachments.ts`: 4 MB each, 5.5 MB together |
| Several images read in one turn | provider-dependent | the two NVIDIA vision seats take one image (the newest); Gemini and vision-flagged catalogue models take all (`visionLadder`, `singleImageFor` in `api/vinaxai.ts`) |
| Text and code files; folder and drag-and-drop | done | 2 MB each, 24 files per message; `droppedFiles` |
| **PDF text reaches the model** (11.0) | partial | `features/ai/pdfText.ts`: text layer only, 8 MB, 120,000 characters; scans, encrypted and unreadable files get their own message |
| **File chips with Show contents** (11.0) | done | `Message.tsx` |
| **Send waits for files still being read** (11.0) | done | `prepareAttachments` |
| Word-processor, spreadsheet, slide and e-book formats | missing | each is a different container format |
| Explicit truncation, named in the message | done | `TEXT_BUDGET`; a shortened file is marked `(excerpt)` |

## Tools and models

| Feature | Status | Where / note |
| --- | --- | --- |
| Model menu from the live catalogue of four providers | provider-dependent | `GET /api/aimodels`; `chat/ModelMenu.tsx`, `useModelCatalog.ts` |
| Auto with failover and cooldowns | done | `pickAutoMode`, `laneAttempts`, the cooldown table in `_lib/ai.ts` |
| Auto on an OpenRouter-only setup (11.0) | done | the `router` attempt is spliced into the chat ladder in `api/vinaxai.ts` |
| Connectors list in the + menu | done | `features/ai/connectors.ts`, `chat/Connectors.tsx` |
| Run code | provider-dependent | runs in the provider's sandbox, on models that list the tool; a model that cannot says so on the chip |
| Create image | provider-dependent | `POST /api/image`; `chat/CreateBar.tsx`, `MediaCard.tsx` |
| Create music clip | provider-dependent | `POST /api/music`; hidden while no provider lists a free music model |
| Saved prompts, slash commands | done | `features/ai/savedPrompts.ts`, `slashCommands.ts` |
| Music commands without a model call | done | `chat/musicCommands.ts` |
| Web search | provider-dependent | 11.0: Gemini's free search grounding on the 2.5 Flash family only (your pick, or Auto for a time-sensitive question); sources and the provider's search suggestions show under the reply. No third-party search engine, no URL fetching. |
| Research mode, agent mode | out of scope | removed on purpose in 10.2; not re-added |
| Per-model capability sheet | partial | the menu marks vision and code-capable models; context length is reported but not shown as a sheet |

## Personalisation, safety and privacy

| Feature | Status | Where / note |
| --- | --- | --- |
| Local date and time, coarse place | done | `_lib/place.ts`; sent only when the listener's setting allows |
| Taste snapshot for music questions; the playing song by choice | done | titles and artists only; the Now playing connector is off by default |
| "Already recommended" memory within a thread | done | `threadMemory` in `buildChatRequest.ts` |
| Opt-in memory the listener writes, edits and removes | done | `features/ai/memory.ts`, `chat/MemorySection.tsx` |
| Memory the model writes for itself | out of scope | the assistant does not decide what to remember about someone |
| Chats, projects and memory stay on the device | done | no account exists; see [data-and-privacy.md](data-and-privacy.md) |
| Model output validated before it can act | done | song suggestions are resolved against the catalogue |
| Untrusted content fenced, never followed | done | profile text, project files, memory lines |
| No third-party product names in generated Home text | done | `BANNED` in `services/ai/home.ts` |
