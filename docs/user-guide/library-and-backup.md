# Library and backup

This page covers what the Library holds, how playlists and Listen Later work, and how to keep all of it safe: exporting a backup, restoring with Merge or Replace, undoing a restore, moving to a new device and erasing data. VinaX has no login, so everything here lives on your device. The technical description is in [data and privacy](../data-and-privacy.md).

## What the Library holds

The Library page opens with shortcuts to **Favorites**, **Listen Later**, **Downloads**, **History**, **Your VinaX** (stats) and **Taste Profile**. Below them are your playlists, saved albums and artists, smart collections and **Listen Together**.

| Tool | How |
|---|---|
| Search and sort | The search field filters favourites, saved music and playlists; sort by recently added or A–Z |
| Listen Later | **Listen later** in any song menu, or swipe a song row left on a touch screen |
| Playlists | Pin, tag and filter by tag, sort, shuffle-play, remove duplicates |
| Import from text | Paste one song per line as “Title — Artist”. You review every match before anything is saved. |
| Smart collections | Rules over the music already on this device, for example favourites in one language played this month |
| Recently deleted | A deleted playlist can be restored for seven days |
| Downloaded only | In the Android app, filters the Library to songs that play offline |

## What a backup includes

A backup is one JSON file named `vinax-backup-<date>.json` (format `vinax-backup`, schema 2).

| Category | Contents |
|---|---|
| Settings & preferences | Theme, accent, playback, sound, languages, accessibility and recommendation choices |
| Library | Favourites, playlists (with tags, pins and descriptions), Listen Later, saved albums and artists, hidden songs |
| Smart collections | Your saved rules |
| Listening history | Your last 150 plays, with completion marks |
| Taste profile | The on-device taste summary and the Kid-mode profile |
| Saved & recent searches | Saved search presets, pinned and recent searches |
| Song bookmarks | Moments you marked inside songs |
| Home layout | Shelf order, hidden shelves and headline from Home Studio |
| Name & username | Your display name and the username you chose |
| Alarm, lyrics, streak & app preferences | Wake-up alarm, lyric sync offsets, karaoke history, streak, saved AI prompts, AI reply preferences |
| VinaX AI chats | Conversation history; attachments are never stored |

## What it leaves out, and why

| Left out | Why |
|---|---|
| Downloaded audio and download paths | Files stay on the device that saved them |
| Device identity and the service-issued token | Identity is per install; **Move to a new device** carries it across |
| Listen Together host keys | Credentials for rooms you host on this device |
| Usage-sharing choice | Made per device on the welcome screen; a restore does not change it |
| Queue, playback position and caches | Rebuilt on the next open |
| Update reminders and What's New read state | Device-specific |

The username in a backup is a claim. After a restore VinaX confirms it with the service again; if it has been taken, you are asked to choose another.

## Export

**Settings → Your Data → Export a backup**, or **Backup Center → Export a backup now**. The file is not encrypted; keep it where you keep other personal files. Files larger than 8 MB are refused on restore.

## Restore, with a preview

1. **Settings → Your Data → Backup Center → Choose a backup file…**
2. VinaX reads the file and shows each category next to what is on this device. Damaged categories are listed and left out. Older export formats are migrated. Nothing has changed yet.
3. Choose how to apply it:

| Mode | Result |
|---|---|
| Merge | Keeps everything on this device and adds what the file has. A song, playlist, bookmark or saved search already here is never added twice. Your alarm, Home layout and lyric timings stay as they are, the taste profile that has learned more is kept, and settings from the file win. |
| Replace | The chosen categories become exactly what the file holds. Anything in those categories that is only on this device is removed. |

4. Untick any category you do not want. **Download a safety copy first** saves the current state to a file.
5. Restore. The app reloads.

### Undo

Open the Backup Center again **in the same tab** and use **Undo that restore**. The previous data is kept in the tab until you close it; after that, the safety copy is the way back.

### Quick restore

**Settings → Your Data → Restore a backup (quick)** replaces the categories in the file without a preview. A damaged file changes nothing. **Import a file** on the welcome screen does the same for a fresh install.

## Move to a new device

**Settings → Your Data → Move to a new device** creates a one-time handoff, shown as a QR and a 10-character code. On the new device, tap **Move from old device** on the welcome screen and scan the QR or type the code. Your profile is encrypted on the old device before it is sent; the relay only holds the encrypted copy, for at most 10 minutes, and deletes it on first read. Unlike a backup file it also carries the device identity, so the new device continues as the old one.

## Erase

**Settings → Your Data** has separate rows to clear history, favourites, the queue, cached metadata and the personalization profile. Clearing history or favourites offers Undo. **Reset app state** erases everything VinaX stores on this device and reloads. Downloaded audio in the Android app is managed from Downloads.
