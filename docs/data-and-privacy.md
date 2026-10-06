# Data and privacy

This document says where VinaX keeps a listener's data, what the backup file contains and how restore, merge and undo behave, and which requests leave the device and when. It is written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), the backup module (`frontend/src/features/settings/backup.ts`), the guarded storage layer (`frontend/src/services/storage/local.ts`) and the network clients under `frontend/src/services/`. The listener-facing version is [user-guide/library-and-backup.md](user-guide/library-and-backup.md).

## The short version

- There are no accounts. Library, history, settings, the taste profile and AI chats live on the device.
- Nothing personal is synced or backed up by the service. Clearing site or app data removes it, so the app offers an export.
- Some features need the network and send what they need: search words, song ids, and — for AI features — a bounded summary of taste and recent listening.
- A VinaX AI web search (10.1) sends only its search words, from the Worker, to up to three sources at once — the owner's search instance (which forwards them to public search engines), a keyed search API when configured, and a public online encyclopedia's search, which is new and always asked. See [Where a research question goes](#where-a-research-question-goes-101).
- Usage statistics and session insights are opt-in. The checkbox on the welcome sheet is unticked by default (`useState(false)` in `OnboardingSheet.tsx`); while it is off nothing is sent. The choice is stored as `vinax.analytics-consent` and can be changed at any time in **Settings → Region & Privacy → Share anonymous usage**. Turning it off stops new usage events at once (`consented()` is read on every send); session insights stop after the next reload. A device transfer carries the choice; a backup never does. Until 7.1 the box was ticked by default and no Settings control existed — listeners who set up before 7.1 keep the choice stored then, and can now change it.

## What is stored where

| Where | What | Notes |
| --- | --- | --- |
| `localStorage`, keys starting `vinax.` | Settings, library, history (last 150 plays), taste profile (and a separate Kid-mode profile), searches, bookmarks, smart collections, Home layout, name and username, alarm, lyric offsets, karaoke history, streak, output choice, update reminders, downloads index, room host keys, the install id and the service-issued signed id, the usage-sharing choice | `constants/storage-keys.ts` is the registry. Some features keep their own `vinax.*` keys next to it (for example the DJ's "already surfaced" list and AI shelf caches). |
| `localStorage`, key `vinax_ai_chats_v1` | VinaX AI conversations | Attachments are stripped before saving. |
| `localStorage`, 8.2 keys | `vinax.home.signals.v1` (how often each Home section is tapped, and whether songs started from it were finished or skipped, decayed with a 14-day half-life), `vinax.recs.outcomes.v1` (up to 60 songs the DJ queued automatically and whether each was finished, liked or skipped early; kept 60 days), `vinax.recs.seedmemo.v1` (the opening songs after up to 40 recent seed songs; kept 12 hours), `vinax.embed.model.v1` (the name of the embedding model whose vectors are cached) | Removed by "Erase everything" with every other `vinax` key. "Clear personalization profile" removes the Home signals and both recommendation memories (`resetHomeSignals`, `resetRecMemory`); the model name stays. |
| `sessionStorage` | Boot-recovery counters, the restore Undo snapshot (`vinax.backup.undo.v1`), session flags, this session's Home order (`vinax.home.order.session.v1`, 8.2), the live Listen Together session (`vinax.together.session.v1`, 10.0: only the mode, host or guest, and the room code, so a reload rejoins) | Gone when the tab closes. |
| IndexedDB | The listen-event log behind taste insights | `services/storage/idb.ts`. Cleared by "Clear personalization profile". |
| IndexedDB `vinax-embeddings` (8.2) | Song vectors from the embedding route: song id, model name, the vector and when it was stored, at most 5,000 songs | `services/ai/embeddings.ts`. "Erase everything" deletes the database (`eraseEmbeddings`). "Clear personalization profile" keeps it: the vectors describe songs, not your taste. |
| Cache storage `vinax-shell-*` | App shell and hashed build assets | Managed by the service worker. |
| Cache storage `vinax-audio-v1` | Downloaded songs | Never cleared by a service-worker update, nor by boot recovery (8.2), which only purges caches when the origin answers and always skips this one. |
| Android app storage | Downloaded audio files | Android only; paths are recorded in the downloads index. |

Every persisted store writes through the guarded layer described in [architecture.md](architecture.md#stores-and-persistence): a full device shows one warning instead of breaking playback, and writes are frozen between a restore and its reload.

## The backup file

**Settings → Your Data** exports one JSON file:

```json
{
  "format": "vinax-backup",
  "schemaVersion": 2,
  "app": "vinax",
  "appVersion": "…",
  "exportedAt": "…",
  "categories": { "<category id>": { "<storage key>": "<value>" } }
}
```

| Category id | Label in the app | Contents |
| --- | --- | --- |
| `settings` | Settings & preferences | Theme, accent, playback, sound, languages, accessibility and recommendation choices |
| `library` | Library | Favourites, playlists (tags, pins, descriptions), Listen Later, saved albums and artists, hidden songs |
| `smartCollections` | Smart collections | Saved rules that build playlists from the local library |
| `history` | Listening history | The last 150 plays with completion marks |
| `taste` | Taste profile | The on-device taste summary and the Kid-mode profile |
| `searches` | Saved & recent searches | Saved presets, pinned and recent searches, the compact-results preference |
| `bookmarks` | Song bookmarks | Moments marked inside songs |
| `homeLayout` | Home layout | Shelf order, hidden shelves and headline |
| `identity` | Name & username | Display name, chosen username, the welcome-done flag |
| `extras` | Alarm, lyrics, streak & app preferences | Alarm, lyric offsets, karaoke history, streak, sidebar groups, saved AI prompts, AI reply preferences |
| `aiChats` | VinaX AI chats | Conversation history without attachments |

A backup never contains (`BACKUP_EXCLUSIONS`):

- downloaded audio or download paths;
- the device identity or the service-issued token;
- Listen Together host keys;
- the usage-sharing choice — a restore never writes it, so each device keeps the choice made on its own welcome sheet;
- the queue, the playback position or caches;
- update reminders and the What's New read state.

### Reading a file

`parseBackup()` refuses a file larger than 8 MB, a file that is not JSON, a file that is not a VinaX backup, and a file whose `schemaVersion` is newer than this app understands. Older exports (the pre-6.1 shape with storage keys at the top level) are migrated. Every category is then sanitised: songs need an id and a title, URLs must be `http` or `https`, lists are capped, unknown sections are ignored with a warning. A category with the wrong shape is rejected on its own and reported; the others can still be restored. The stored persist-version number in a file is never trusted — values are rewritten with the version the running store expects.

### Restore, merge and undo

The **Backup Center** shows what a file holds next to what the device holds, lets the listener pick categories, and offers two modes.

| Mode | Behaviour |
| --- | --- |
| Replace | The chosen categories become exactly what the file says. Keys the file does not carry are removed, except in `identity`, where a missing value never undoes the welcome flow or drops the name the device already has. |
| Merge | Each category unions the file into the device. Library lists merge by id. The same play on both sides (same timestamp and song) is one play. For the taste profile the side that has learned from more plays is kept, per profile; the device wins a tie. Home layout keeps the device's layout when there is one. Device data is never trimmed by import caps during a merge. |

Rules that hold in both modes:

- **All or nothing.** Every write goes through `writeLocalBatch()`. If the device refuses any write (full storage, private mode), every key touched so far is put back and the app says nothing was changed.
- **The username is a claim.** A restored username is written as *pending* and re-confirmed with the service, unless this device already holds it.
- **Undo.** Before writing, the app snapshots the raw values of every key the restore will touch into `sessionStorage`. The Backup Center shows "Undo that restore" until the tab closes. Undo writes the snapshot back with the same all-or-nothing writer. If the snapshot cannot be kept, the restore still runs and the app says so; an older snapshot is removed so Undo can never roll back to the wrong point. If the restore fails, the earlier snapshot is put back.
- **Freeze, then reload.** After a successful restore or undo the app freezes store writes and reloads, so no live store can overwrite the restored keys with stale state.

"Restore a backup (quick)" on the Settings page is a replace-mode restore of everything in the file, with the same validation.

### Move to a new device

This is the one path that carries device identity. The payload is a backup plus the install id, the signed id, the confirmed username and the usage-sharing choice (`TRANSFER_KEYS`). It is encrypted on the sending device with a key derived from a six-word passphrase (`features/settings/handoff.ts`). Only the ciphertext goes to the relay (`/api/handoff`), which keeps it for at most ten minutes and deletes it on first read. The passphrase travels in the QR code's URL fragment, which browsers do not send to servers, or is typed by hand.

### Erasing

| Action | Effect |
| --- | --- |
| Clear history / Clear favourites | Clears the list and offers Undo in a toast |
| Clear personalization profile | Erases the taste profile and the event log after a confirmation; favourites stay |
| Erase everything | Clears the event log, deletes the `vinax-embeddings` database and removes every `localStorage` key that starts with `vinax` (the AI chats key included), then reloads Home (`resetAppState`) |

Because nothing personal is held by the service, a local erase is a complete erase — except anonymous usage rows sent earlier while usage sharing was on.

## What leaves the device, and when

| When | Goes to | What is sent |
| --- | --- | --- |
| Browsing, searching, opening a song, album, artist or playlist | The catalogue bases (see [architecture.md](architecture.md#catalogue-client)) | Search words, ids, language and page parameters |
| Playing a song | The audio CDN named in the song's stream URL | A normal media request |
| Showing artwork | The artwork CDN; `/img` only when a share card needs a same-origin copy | Image URLs |
| Opening lyrics | An open lyrics database, then the catalogue as fallback | Track title, artist and duration |
| The DJ orders or extends a queue (`/api/dj`) | The Worker, then an AI lane | The seed song, preferred and muted languages, a pinned mood or tune instruction, up to 12 recently played, 10 finished, 10 skipped and 15 liked song lines, top artists and languages, taste-dial lines, and up to 40 candidate songs described by title, artist, album or film, year and whether the listener knows them. No device id. |
| Home AI shelves, ranking and "Trending for you" (`/api/curate`) | The Worker, then an AI lane | A task name and the data for that task: candidate songs and a taste summary |
| AI Playlist (`/api/playlist`) | The Worker, then an AI lane | The prompt, the languages (the ones the prompt names, else the chosen ones), the taste snapshot, and titles to avoid. AI Radio uses the same route for a request its catalogue searches cannot answer. |
| Natural-language search, AI Playlist's pool and the next-song taste fit (`/api/embed`, 8.2) | The Worker, then an embedding engine on an AI lane's key | Search words, or short song descriptions: title, up to four artists, album, language, year, genres, mood, vibes and an energy band. Candidate songs, favourites and recent plays can be described this way. Sent only while `aiAssist` is on; no device id. |
| VinaX AI chat (`/api/vinaxai`) | The Worker, then an AI lane | The conversation, attachments for that message, the taste snapshot (`services/ai/taste.ts`: time of day, preferred and avoided languages, top artists, top, liked and recently played song lines), and — each only while its connector in the + menu is on — the song playing now, the listener's memory lines and the coarse place (see below) |
| A web search for VinaX AI (10.1; see [the next section](#where-a-research-question-goes-101)) | **From the Worker, not the device**, in parallel: the owner's own search instance, which passes the query on to the public search engines it is configured to use; a keyed web search API, only when the owner has set its key; and **a public online encyclopedia's own search API (new in 10.1, keyless, always asked)** | The search words and nothing else: no install id, no taste data, no place, no IP of the listener. The words are the listener's question (up to 300 characters), or, for a short follow-up, the earlier question's topic words added in front of it, or the words the model chose when it asked for a search itself |
| Switching on Web search or Research in VinaX AI (`POST /api/warm-search`, 10.1) | The Worker, which then pings the owner's search instance's health check | Nothing: an empty POST, at most once every two minutes per tab. The Worker's ping to the instance carries no search words and nothing about the listener. Sent even when the answering engine will use its own search, because the switch is flipped before the question is written |
| DJ voice and read-aloud (`/api/tts`) | The Worker, then a speech lane | The text to speak |
| Choosing a username (`/api/username`) | The Worker | The username, display name and install id |
| Sending feedback (`/api/feedback`) | The Worker | The message, and the install id when one exists |
| Turning notifications on (`/api/push/*`) | The Worker | The browser's push endpoint, or the Android push token |
| Listen Together (`/api/room`) | The Worker | Room code, display name, the playing song, up to eight upcoming songs and the playback position while the room lives. 10.0: a host pushes whenever the song, play state, queue or position jumps, and every four seconds as a keep-alive; a guest polls every two seconds and sends a heartbeat on every third poll with the device id kept under `vinax.device-id` (created by Listen Together itself when usage sharing has not already made one), and a leave beacon when the tab closes. A guest's song request carries the song's id, title and artwork plus the guest's display name; reactions carry one emoji from a fixed list. Only the host's token unlocks the member names; guests see a count |
| Move to a new device (`/api/handoff`) | The Worker | Ciphertext only |
| Region guess (`/api/geo`) | The Worker | Nothing beyond the request itself. **9.1:** the answer is a coarse country code, a region (state/province) name, the edge's **approximate** city and an IANA time zone. The visitor's IP is read by Cloudflare's edge as part of normal request handling; it is never returned to the app, never logged by the function and never stored. Answered `private, no-store`. Only asked while "Allow region inference" is on and no manual override is set, and at most once every 12 hours unless the listener taps Refresh |
| Live web discovery (`/api/discover`) | The Worker, then the owner's search instance and an AI lane | **9.1:** a region, a language and an intent — nothing else. No install id, no song, nothing the listener typed. The search instance sees only the generated query (today's date, the region, the language) |
| App config, flags, announcements, blocklist, version, update check | The Worker | Nothing personal |
| **Only with usage sharing on:** usage events (`/api/events`) | The Worker | Install id and signed id, optional display name, event type (open, play, pause, heartbeat, skip, complete, favourite, search with result count, share, download, lyric miss, error, web vitals), platform, app version and the current song's id, title, artist, language and artwork URL. The request carries an explicit consent header; the Worker rejects events without it. Location is added at the edge at city level; IP addresses are not stored. Since 7.2 a `play` is sent when the playback session counts the play — at least 5 seconds heard (or 70 % of a shorter song), once per run, so a repeat-one loop sends one — the same rule the taste profile uses (`services/playback/session.ts`). Before 7.2 it was sent the moment a new song started playing, so historical `play` rows include songs flipped past in the first seconds. |
| **Only with usage sharing on:** `rec_served` (`/api/events`) | The Worker | Once per automatic continuation (the songs the recommender appends), when it is known who picked the final order. The fields every usage event carries (install id, signed id, optional display name, platform, app version), no song, and `meta`: `alg` (pipeline and weights version), `picker` (`local`, `ai` or `reserve`), `fallback` (why the AI did not pick: `ai_timeout`, `ai_unavailable`, `ai_rejected`, `deadline`, `error`, or null), `latencyMs` (plan call to a queueable order), `n` (songs added), `discovery` (songs by artists never played), `languageViolations`, `distinctArtists`, `relaxed` (validation rules relaxed), and `exp` (experiment key → variant, only for experiments that shaped this continuation, including an applied owner tuning rollout as `rec-config`). `discovery`, `languageViolations` and `relaxed` are null when the AI's order replaced the local one. Sent by `services/analytics/recTelemetry.ts`, rate-limited on the device. |
| **Only with usage sharing on:** `rec_outcome` (`/api/events`) | The Worker | When an automatically added song stops playing. The same common fields, no song, and `meta`: `alg`, `picker`, `pos` (place in its continuation), `heardSec` and `durationSec` (whole seconds, heard time as measured by the playback session), `outcome` (`complete`, `skip`, `early_skip` or `partial`), `liked` (in favourites at that moment) and `exp` (as for the continuation it came from). Songs the listener chose, and plays that failed to load, send nothing. |
| **Only with usage sharing on:** session insights | An analytics provider | Layout, taps and scrolls. All on-screen text is masked on the device before upload. Production builds only. |

The summaries sent to AI routes contain song titles and artist names from recent listening. They contain no install id, no name and no timestamps. [ai.md](ai.md) lists each route's contract.

### Where a research question goes (10.1)

Before 10.1 a VinaX AI web search had one destination, the owner's own search instance. Since 10.1 (`backend/worker/functions/_lib/websearch.ts`, `liveSearch`) it has up to three, asked **at the same time** by the Worker:

| Source | Asked when | Who operates it | What it receives |
| --- | --- | --- | --- |
| The owner's search instance | Whenever it is configured | The VinaX owner; it is a metasearch service, so it **passes the query on to the public search engines it is set up to use** | The search words, and the owner's bearer token |
| A keyed web search API | Only when the owner has set its key (see [operations.md](operations.md#secrets)) | A commercial search provider, under the owner's account | The search words, the result count, a safe-search level and, for a "latest/today/this week" question, a freshness filter |
| **An online encyclopedia's own search API (new in 10.1)** | **Always**: it needs no key and cannot be switched off by configuration | A public encyclopedia project (its English edition) | The search words, and a user-agent naming VinaX and its website |

Who sees what:

- Every one of these requests comes **from the Worker**, not from the listener's device. None of them carries the listener's IP address, install id, name, taste, place or chat history.
- The search words are, in this order of precedence: the words the model chose when it asked for a search mid-answer (`[[FETCH: …]]`); otherwise the listener's own last message (up to 300 characters). When that message is a short or pronoun-led follow-up ("what about his new movie?"), up to six topic words from the listener's previous message are put in front of it (`searchQueryFor`), so those earlier words reach the sources too.
- A search runs when the listener has Web search or Research on, **or when the model asks for one itself**. The model may ask on any ordinary chat turn that is not a voice turn, not the Search-page expert, not carrying an image and not answered by the flagship engine with its own search. So a question can reach these sources without the listener having switched anything on; the reply then shows the search in its tool timeline and lists the pages under Sources.
- When the flagship engine answers with Web search on and its own key serves the call, none of the three sources is asked: the engine's provider runs its own live search, as before 10.1.
- Results that are not about the question are dropped before any model sees them, and what remains is handed over as fenced, untrusted data. The Worker logs counts and statuses for each source (`[websearch] …`), never the search words.
- The Search-page music expert and live web discovery (`/api/discover`) still ask only the owner's instance; neither asks the encyclopedia.

The warm-up call (`POST /api/warm-search`) is separate: the app sends it, empty, when Web search or Research is switched on, and the Worker answers at once and then requests the instance's token-free health check. It tells the instance only that someone may search soon.

### VinaX AI's own device state (9.1)

| What | Key | Leaves the device? |
| --- | --- | --- |
| Chats | `vinax_ai_chats_v1` | Only as part of a request you sent. A **temporary chat** is never written here at all, and is not part of an export |
| Projects — names, instructions, reference files | `vinax.ai.projects.v1` | A project's instructions and files travel with each message in its chats, fenced as data |
| Memory lines you wrote | `vinax.ai.memory.v1` | Only while **Let VinaX AI remember things** is on. Switching it off deletes them |
| Memory switch | `vinax.ai.memoryOn` | No |
| Place connector (10.0) | `vinax.ai.placeOn` | No. `'0'` holds the coarse place back from every chat request, on top of the app-wide region setting; absent or `'1'` leaves it to that setting |
| Now playing connector (10.0) | — (page state) | Only while it is on: the playing song's title, first artist, album or film, year, language and length, plus up to 40 lines of its lyrics, ride with each message (`songContextBlock`). Getting those lyrics asks the open lyrics database from the device, as opening lyrics does |
| Artifacts | — | Nothing stored: they are read out of the chat you already have |
| A PDF you attached | — | Nothing stored. Its TEXT is extracted on the device and travels as part of that one message; the file itself is never uploaded |

### Place context in an AI reply (9.1)

A chat request may carry a `place` object so that the date and time in answers
follow the listener's own zone instead of always assuming IST, and so searches can
be worded for their region. The rules:

- **It is only sent when the listener allowed it.**
  `services/location/assistantPlace.ts` returns nothing at all when "Allow region
  inference" is off and no manual override is set; the server then opens its
  prompt with the IST clock, exactly as every build before 9.1 did for everyone.
- **10.0: the Place connector can hold it back for VinaX AI alone.** Switching
  Place off in the composer's + menu stores `vinax.ai.placeOn = '0'`, and
  `buildChatRequest` then sends no `place` at all — not even the time zone — while
  the rest of the app keeps using the region setting.
- **Four coarse fields, and no more**: country code, region name, the edge's
  approximate city, and an IANA time zone. `_lib/place.ts` `readCoarsePlace`
  keeps only those, so an IP, coordinates or an address cannot ride along even if
  some future caller passed them.
- **A manual override never carries a city** — the listener chose a country, not a
  city.
- **The time zone travels even with inference off.** It is a device setting every
  web page can already read, and it is what makes "what time is it" answerable.
- The prompt says the value is coarse, that an approximate city is often the
  network exchange rather than the listener's town, that it is never an address or
  where they are standing, and that the listener's **language must never be
  inferred from it** — their language preferences are sent separately and win.

Nothing about place is stored on the server. On the device, the resolved value
lives under the `region` key with the time it was resolved, so Settings can show
it and the app can avoid asking the edge again for 12 hours.

## Secrets

The frontend holds no secrets. `VITE_*` variables are visible to every visitor and must never carry keys. AI lane keys, the database service key, the admin password, push keys and the cron secret are Worker secrets; their names are listed in `backend/.env.example` and handled in [operations.md](operations.md).

## Changing what is collected

`services/analytics/sessionInsights.ts` and `services/analytics/telemetry.ts` gate on the same consent. Any change to what they send must be reflected in `frontend/src/pages/PrivacyPage.tsx` and in this document before it ships.
