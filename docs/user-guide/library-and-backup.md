# Library and backup

This page covers what the Library holds, how to save music for later, and how to keep everything safe: making a backup, restoring one, moving to a new device and erasing data. VinaX has no sign-up, so your library lives on your device. A backup file, or a move to a new device, is the only way to carry it somewhere else. What leaves the device, and when, is listed in [data and privacy](../data-and-privacy.md).

## What the Library holds

Open **Library**. At the top are six shortcuts: **Liked songs**, **Listen later**, **Downloads**, **History**, **Your VinaX** (your listening in numbers) and **Taste profile**. Below them are your playlists, saved artists and saved albums, then **Smart collections**, **Listen Together**, **Recently deleted** and a **Keep it with you** block with the Backup Center.

| To do this | Do this |
|---|---|
| Find something | Type in the search field. It searches liked songs, saved music and playlists. |
| Narrow the list | Use the chips: **All**, **Playlists**, **Artists**, **Albums**. Once you have playlists with tags, a tag filter appears too. |
| Sort | Choose **Recently added** or **A to Z**. You can also switch between list and grid view. |
| Make a playlist | Press **Create playlist**, or **Import from text** to start from a pasted list of songs. |
| Save a song for later | Open the song's menu and choose **Listen later**. On a touch screen you can also swipe the song row left. |
| Tidy a playlist | Open the playlist. Its menu offers **Remove duplicates** when it finds any, and **Shuffle play** plays it in random order. |
| Get a deleted playlist back | Open **Recently deleted**. A deleted playlist stays there for 7 days. |
| See only offline music | In the Android app, once you have downloads, tap the **Downloaded** chip. See [Android](android.md). |

Smart collections are saved rules that build a list from the music already on your device: your liked songs, playlists, Listen later and history.

## What a backup includes

A backup is one file. It holds these categories:

| Category | Contents |
|---|---|
| Settings & preferences | Every setting: theme, accent, your [app style](app-styles.md), playback, sound, languages, accessibility and recommendation choices |
| Library | Liked songs, playlists (with tags, pins and descriptions), Listen later, saved albums and artists, hidden songs and artists |
| Smart collections | Your saved rules |
| Listening history | Your last 150 plays |
| Taste profile | The taste summary kept on your device, and the Kid-mode profile |
| Saved & recent searches | Saved searches, pinned and recent searches, and the compact results choice |
| Song bookmarks | Moments you marked inside songs |
| Home layout | Shelf order, hidden shelves and headline |
| Name & username | Your display name and the username you chose |
| Alarm, lyrics, streak & app preferences | Wake-up alarm, lyric timing adjustments, karaoke history, listening streak, sidebar groups, saved AI prompts, and your VinaX AI preferences, including the chat style |
| VinaX AI chats | Your conversations. Attachments are never stored. |

## What a backup leaves out

| Left out | Why |
|---|---|
| Downloaded audio | The files stay on the phone that saved them |
| Device identity | It belongs to one install. **Move to a new device** carries it across. |
| Listen Together host keys | They only work for sessions hosted on this device |
| Your usage-sharing choice | It is asked again on each device. Sharing stays off after a restore until you turn it on. |
| Queue, playback position and caches | They are rebuilt the next time you open VinaX |
| Update reminders and What's New read state | They belong to this device |

Your username is confirmed again after a restore. If someone else has taken it meanwhile, you choose another.

## Make a backup

1. Open **Settings** and go to **Your data**.
2. Next to **Export a backup**, press **Export**.

The file downloads to your device. You can also open the **Backup Center** (from the same section, or from the bottom of the Library) and press **Export a backup now**.

The file is not encrypted. Keep it where you keep other personal files.

## Restore a backup

1. Open **Settings → Your data → Backup Center** and press **Open**.
2. Under **Restore from a file**, press **Choose a backup file…** and pick your file. Nothing changes yet.
3. VinaX shows each category in the file next to what is on this device. Damaged categories are listed and left out.
4. Under **How to apply**, choose **Merge** or **Replace**.
5. Untick any category you do not want.
6. If you want a way back, press **Download a safety copy first**.
7. Press the **Merge** or **Replace** button. VinaX restores and reloads.

| Mode | Result |
|---|---|
| Merge | Keeps everything on this device and adds what the file has. A song, playlist, bookmark or saved search that is already here is not added twice. Your alarm, Home layout and lyric timings stay as they are. |
| Replace | The chosen categories become exactly what the file holds. Anything in those categories that is only on this device is removed. |

A file larger than 8 MB is refused. So is a file made by a newer VinaX than the one you are running; update first.

### Undo a restore

Open the Backup Center again in the same tab and press **Undo that restore**. The previous data is kept only until you close the tab. After that, the safety copy is the way back.

### Quick restore

**Settings → Your data → Restore a backup (quick)** replaces the categories in the file without a preview. A damaged file changes nothing. On a fresh install, **Import a file** on the welcome screen restores a backup before you start.

## Move to a new device

1. On the old device, open **Settings → Your data → Move to a new device** and press **Create a transfer**.
2. VinaX shows a QR code, a 10-character code and six secret words.
3. On the new device, tap **Move from old device** on the welcome screen. Scan the QR code, or type the code and the words.

Your profile is encrypted on the old device before it is sent. The encrypted copy waits for 10 minutes at most and is destroyed as soon as the new device reads it. The import replaces what is on the new device and reloads. Unlike a backup file, a move also carries the device identity.

## Erase

**Settings → Your data** has a **Clear and reset** group:

- **Clear history** and **Clear favorites** each offer Undo right after.
- **Clear queue** empties the queue.
- **Reset app state** erases everything VinaX stores on this device and reloads.

**Clear cached metadata** is in the **Storage** group of the same section.

To start your recommendations again without losing your library, use **Settings → Recommendations → Reset taste profile**. It shows what goes and what stays, and offers a backup first. There is no undo.

Downloaded songs in the Android app are removed from **Library → Downloads**.
