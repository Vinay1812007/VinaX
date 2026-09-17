# Data and privacy

This document says where VinaX keeps a listener's data, what the backup file contains and how restore, merge and undo behave, and which requests leave the device and when. It is written from the code: the storage registry (`frontend/src/constants/storage-keys.ts`), the backup module (`frontend/src/features/settings/backup.ts`), the guarded storage layer (`frontend/src/services/storage/local.ts`) and the network clients under `frontend/src/services/`. The listener-facing version is [user-guide/library-and-backup.md](user-guide/library-and-backup.md).

## The short version

- There are no accounts. Library, history, settings, the taste profile and AI chats live on the device.
- Nothing personal is synced or backed up by the service. Clearing site or app data removes it, so the app offers an export.
- Some features need the network and send what they need: search words, song ids, and — for AI features — a bounded summary of taste and recent listening.
- Usage statistics and session insights are opt-in. The checkbox on the welcome sheet is unticked by default (`useState(false)` in `OnboardingSheet.tsx`); while it is off nothing is sent. The choice is stored as `vinax.analytics-consent` and can be changed at any time in **Settings → Region & Privacy → Share anonymous usage**. Turning it off stops new usage events at once (`consented()` is read on every send); session insights stop after the next reload. A device transfer carries the choice; a backup never does. Until 7.1 the box was ticked by default and no Settings control existed — listeners who set up before 7.1 keep the choice stored then, and can now change it.

## What is stored where

| Where | What | Notes |
| --- | --- | --- |
| `localStorage`, keys starting `vinax.` | Settings, library, history (last 150 plays), taste profile (and a separate Kid-mode profile), searches, bookmarks, smart collections, Home layout, name and username, alarm, lyric offsets, karaoke history, streak, output choice, update reminders, downloads index, room host keys, the install id and the service-issued signed id, the usage-sharing choice | `constants/storage-keys.ts` is the registry. Some features keep their own `vinax.*` keys next to it (for example the DJ's "already surfaced" list and AI shelf caches). |
| `localStorage`, key `vinax_ai_chats_v1` | VinaX AI conversations | Attachments are stripped before saving. |
| `sessionStorage` | Boot-recovery counters, the restore Undo snapshot (`vinax.backup.undo.v1`), session flags | Gone when the tab closes. |
| IndexedDB | The listen-event log behind taste insights | `services/storage/idb.ts`. Cleared by "Clear personalization profile". |
| Cache storage `vinax-shell-*` | App shell and hashed build assets | Managed by the service worker. |
| Cache storage `vinax-audio-v1` | Downloaded songs | Never cleared by a service-worker update. |
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
| Erase everything | Clears the event log and removes every `localStorage` key that starts with `vinax` (the AI chats key included), then reloads Home (`resetAppState`) |

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
| AI Playlist (`/api/playlist`) | The Worker, then an AI lane | The prompt, chosen languages, the taste snapshot, and titles to avoid |
| VinaX AI chat (`/api/vinaxai`) | The Worker, then an AI lane; a web-search provider when the model asks for a search | The conversation, attachments for that message, and the taste snapshot (`services/ai/taste.ts`): time of day, preferred and avoided languages, top artists, top, liked and recently played song lines |
| DJ voice and read-aloud (`/api/tts`) | The Worker, then a speech lane | The text to speak |
| Choosing a username (`/api/username`) | The Worker | The username, display name and install id |
| Sending feedback (`/api/feedback`) | The Worker | The message, and the install id when one exists |
| Turning notifications on (`/api/push/*`) | The Worker | The browser's push endpoint, or the Android push token |
| Listen Together (`/api/room`) | The Worker | Room code, first name, shared queue and playback position while the room lives |
| Move to a new device (`/api/handoff`) | The Worker | Ciphertext only |
| Region guess (`/api/geo`) | The Worker | Nothing beyond the request itself; the answer is a coarse country and region label |
| App config, flags, announcements, blocklist, version, update check | The Worker | Nothing personal |
| **Only with usage sharing on:** usage events (`/api/events`) | The Worker | Install id and signed id, optional display name, event type (open, play, pause, heartbeat, skip, complete, favourite, search with result count, share, download, lyric miss, error, web vitals), platform, app version and the current song's id, title, artist, language and artwork URL. The request carries an explicit consent header; the Worker rejects events without it. Location is added at the edge at city level; IP addresses are not stored. |
| **Only with usage sharing on:** session insights | An analytics provider | Layout, taps and scrolls. All on-screen text is masked on the device before upload. Production builds only. |

The summaries sent to AI routes contain song titles and artist names from recent listening. They contain no install id, no name and no timestamps. [ai.md](ai.md) lists each route's contract.

## Secrets

The frontend holds no secrets. `VITE_*` variables are visible to every visitor and must never carry keys. AI lane keys, the database service key, the admin password, push keys and the cron secret are Worker secrets; their names are listed in `backend/.env.example` and handled in [operations.md](operations.md).

## Changing what is collected

`services/analytics/sessionInsights.ts` and `services/analytics/telemetry.ts` gate on the same consent. Any change to what they send must be reflected in `frontend/src/pages/PrivacyPage.tsx` and in this document before it ships.
