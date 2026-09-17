# Real-device QA script

This is the checklist for the things automated tests cannot prove: first run, playback controls outside the app, notifications, downloads, updates and shared listening, on real hardware. Run it before tagging an Android release and after any change to the audio engine, the media session, the native files or the service worker. Every step names behaviour that exists in the code today; the reasons a device is needed are in [android.md](android.md#what-cannot-be-verified-without-a-device).

Run each section on the devices it names: **A** the Android app (newest package), **B** a phone browser on the production site, **C** a desktop browser, **D** a TV browser. Mark each step pass or fail. For a fail, write the device, the step and exactly what you saw.

## 1. First run and boot (A, B — fresh install or private window)

1. Open the app. The welcome sheet appears. It asks for a name and languages, offers **Move from old device** and **Import a file**, and asks once about sharing anonymous usage.
2. Finish the welcome. Home paints with artwork on the first visit.
3. Close and reopen three times. No freeze on the splash, no crash.
4. A only: turn on airplane mode with at least one download saved and open the app. It opens on Downloads.

## 2. The player and the queue (A, B, C)

1. Tap any song. It plays, and Up Next fills with five songs in that song's language.
2. Open the full-screen player → Up Next. Tap a mood under **Pin a mood**. Up Next rebuilds at once. Tap the same mood again to unpin.
3. Open the Queue page and tap an option under **Tune this queue**. Up Next rebuilds; songs that already played and the current song stay.
4. Add a song to the queue by hand from a song's ⋮ menu. It sits ahead of the automatic picks, and stays there after another Tune.
5. In the full-screen player, double-tap the left and right edges of the artwork. Playback jumps back and forward 10 seconds.
6. Let a queue run towards its end with "DJ builds every queue" on. More songs arrive before the last one ends; playback does not stop.

## 3. Controls outside the app (A, B)

1. Lock the phone while a song plays. The lock screen shows artwork, title and artist, with play/pause, next, previous and a seek bar.
2. Use headset or car buttons: play/pause, next, previous.
3. Take a phone call during a song, then hang up. Note whether playback resumes by itself.
4. Switch the output (wired ↔ wireless) during a song. Playback continues from the same position.
5. A only: add the player widget to the home screen. It shows the current song and its buttons work.

## 4. Downloads and offline (A)

1. Download three songs. They appear under Downloads.
2. Airplane mode on. Play each download, seek inside one, and let one run into the next.
3. Open Library, Settings and Help while offline. Each page opens; none reloads in a loop.

## 5. Notifications (A, B, C)

1. B, C: on Home, use the notification card's **Turn on** button. The browser asks for permission. Accept.
2. In the owner console, send a test notification that targets a song. It arrives; tapping it opens that song.
3. A: with the app swiped closed, send another. It arrives (needs the setup in [fcm-push-setup.md](fcm-push-setup.md)).

## 6. Updates (A)

1. With an older package installed, open the app. The update dialog appears.
2. Choose **Update later**. The dialog stays away for that build. A manual check in Settings still finds it.
3. Install the update. The app reopens on the new version; library, history and settings are intact.

## 7. Backup and restore (A, B)

1. Settings → Your Data → export a backup.
2. Change something visible (remove a favourite). Open the Backup Center, pick the file, preview, restore with **Merge**, then again with **Replace**. After each reload the data matches the preview.
3. Use **Undo that restore** in the Backup Center. The earlier state returns.
4. Pick a damaged or unrelated file. The app reports the problem and changes nothing.

## 8. VinaX AI (A, B, C)

1. Ask a question. The reply streams in.
2. Ask it to play a song. The reply contains a player card whose play/pause, skip and seek controls work.
3. Dictate a message with the microphone button where the device offers one. In the Android app dictation uses the system speech recognizer.
4. Switch the model and send one line. It answers, or says plainly that the engine is unavailable.

## 9. Listen Together (two devices)

1. Start a room on one device and join with the code or link on the other. Both hear the same moment of the song.
2. The guest adds a song. It appears in both queues.
3. The host pauses and skips. The guest follows within about a second. Ending the room ends it for both.

## 10. Search and TV (B, C, D)

1. Search with a misspelt artist name. Relevant results still appear.
2. With the search field empty, trending searches appear; tapping one runs it.
3. D: with the remote's direction keys, reach every control on Home, Search and the player.

## 11. Maintenance switch (owner, last)

1. In the owner console, switch the site to maintenance with a message.
2. Within about a minute the site and the app show the maintenance screen with that message. The console still works.
3. Switch back to live. Within about a minute everything returns without a manual refresh.
