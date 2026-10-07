# Real-device QA script

This is the checklist for what automated tests cannot prove: first run, the six app styles on a real screen, playback controls outside the app, notifications, downloads, updates and shared listening. Part 1 is a 30-minute pass on one phone, to run before every release. Part 2 is the longer pass to run before tagging an Android release and after any change to the audio engine, the media session, the native files or the service worker. Why a device is needed is in [android.md](android.md#what-cannot-be-verified-without-a-device).

Devices: **A** the Android app (newest package), **B** a phone browser on the production site, **C** a desktop browser, **D** a TV browser. Mark each step pass or fail. For a fail, write the device, the app style, the theme, the step and exactly what you saw.

## Part 1 — the 30-minute pass (A or B)

Use the narrowest phone available. If none is about 360 px wide, run the steps marked **360** in a desktop browser's device mode at 360 px as well.

### 1. Welcome (5 minutes; fresh install or private window)

- [ ] The welcome sheet opens and shows "Step n of N". **Back** works on every step after the first; optional steps offer **Skip**.
- [ ] Step 1 takes a name and username and offers **Move from old device** and **Import a file**.
- [ ] The languages step shows the usage-sharing choice, unticked.
- [ ] **Pick your look** shows the six app styles. Tapping one changes the app behind the sheet at once. Pick a style other than the default.
- [ ] Tap a few songs you like, pass the short slides, finish. Home paints with artwork, in the style you picked.
- [ ] **360**: no step scrolls sideways and no button is clipped.
- [ ] Close and reopen the app. The welcome does not return; the style is kept.

### 2. The six app styles (10 minutes)

Start a song first so the mini player is showing. Then, in **Settings → Appearance → App style**, for each of Aura, Pulse, Sangam, Nocturne, Marquee and Vibe:

- [ ] The tab bar is fully visible, every tab label is readable and the current tab is marked.
- [ ] The mini player sits clear of the tab bar; its play button and progress work.
- [ ] Open Now Playing. Artwork, title, seek bar and controls fit the screen; **Open queue** is reachable (**360**: it does not run off the edge).
- [ ] Scroll a long page (Home, then Settings). Page text does not show through the top bar.

Then, in any two styles of your choice:

- [ ] Switch the theme to light. Text, icons and the play button are readable; nothing is dark-on-dark or light-on-light.
- [ ] Switch to the Black theme. The canvas is true black and the top bar still has a fill when scrolled.
- [ ] A, B: look at the system status bar. Note whether its icons are readable against the top of the app, especially when the app theme differs from the phone's own light/dark setting. Nothing in the code sets the native bar colour ([android.md](android.md)), so write down the phone, style and theme of any mismatch.
- [ ] Change the accent away from **Style colour** and back. The style's own accent returns.

### 3. A festival preview (3 minutes)

- [ ] **Settings → Appearance → Preview a festival** → pick one. The colours change, a ribbon and backdrop appear, and the layout of the current style stays.
- [ ] The greeting card shows the emblem, a greeting, **Play … songs** and **Continue**. **Play … songs** opens search for that festival.
- [ ] Home shows the festival strip; dismissing it removes it.
- [ ] Reload. The preview is gone (it lasts for the session only).

### 4. Reduced motion (3 minutes)

- [ ] Turn on **Reduce motion** in Settings (then repeat once with the system's own reduce-motion setting instead).
- [ ] Changing the app style switches at once, with no cross-fade.
- [ ] A festival preview shows no moving particles.
- [ ] Opening Now Playing and the queue does not slide or spring.
- [ ] Turn on **Data saver** with a festival preview on: no particles.

### 5. VinaX AI with two models (5 minutes)

- [ ] Ask a question on Auto. The reply streams in and the view stays at the bottom when it finishes.
- [ ] Open the model menu and pick a model from one maker. The chat's look changes to that maker's style; send one line and get an answer, or a plain statement that the engine is unavailable or busy.
- [ ] Pick a model from a different maker. The look changes again.
- [ ] VinaX AI settings → General → **Chat style** → **Always VinaX**. The look stops following the model. Set it back to **Match the model**.
- [ ] Attach a PDF with selectable text and ask what it says. The answer uses the file's content; the file shows as a chip with **Show contents**.
- [ ] Ask it to play a song. The reply contains a player card whose controls work.
- [ ] **360**: the composer, the model chip and the starters fit without sideways scrolling.

### 6. Playback outside the app (4 minutes)

- [ ] Lock the phone while a song plays. The lock screen shows artwork, title and artist with play/pause, next, previous and a seek bar.
- [ ] Headset buttons: play/pause, next, previous.
- [ ] Switch the output (wired ↔ wireless) during a song. Playback continues from the same position.

## Part 2 — the full pass

### 7. Boot and offline (A)

1. Close and reopen three times. No freeze on the splash, no crash.
2. Download three songs. They appear under Downloads.
3. Airplane mode on. Open the app: it opens on Downloads. Play each download, seek inside one, and let one run into the next.
4. Open Library, Settings and Help while offline. Each opens; none reloads in a loop.
5. Still offline, try to download a new song. The message says there is no internet connection.
6. Back online, use **Download all** on a playlist of twenty songs or more. It finishes, and any failure names its reason.
7. Airplane mode on, swipe the app closed and open it again twice. It opens both times and every download still plays.

### 8. The player and the queue (A, B, C)

1. Tap any song. It plays, and Up Next fills with songs in that song's language.
2. Full-screen player → Up Next → tap a mood under **Pin a mood**. Up Next rebuilds at once. Tap the mood again to unpin.
3. Queue page → an option under **Tune this queue**. Up Next rebuilds; played songs and the current song stay.
4. Add a song to the queue from a song's ⋮ menu. It sits ahead of the automatic picks and stays there after another Tune.
5. Double-tap the left and right edges of the artwork in the full-screen player. Playback jumps back and forward 10 seconds.
6. Let a queue run towards its end with "DJ builds every queue" on. More songs arrive before the last one ends.
7. Take a phone call during a song, then hang up. Note whether playback resumes by itself.
8. A only: add the player widget to the home screen. It shows the current song and its buttons work.

### 9. Notifications (A, B, C)

1. B, C: on Home, use the notification card's **Turn on** button and accept the browser's prompt.
2. In the owner console, send a test notification that targets a song. It arrives; tapping it opens that song.
3. A: with the app swiped closed, send another. It arrives (needs the setup in [fcm-push-setup.md](fcm-push-setup.md)).

### 10. Updates (A)

1. With an older package installed, open the app. The update dialog appears.
2. Choose **Update later**. The dialog stays away for that build. A manual check in Settings still finds it.
3. Install the update. The app reopens on the new version; library, history, settings and the chosen app style are intact.

### 11. Backup and restore (A, B)

1. Settings → Your Data → export a backup.
2. Remove a favourite and switch to a different app style. Open the Backup Center, pick the file, preview, restore with **Merge**, then again with **Replace**. After each reload the data matches the preview; after **Replace** the app style from the backup is back.
3. Use **Undo that restore**. The earlier state returns.
4. Pick a damaged or unrelated file. The app reports the problem and changes nothing.

### 12. Listen Together (two devices)

1. Start a room on one device and join with the code or link on the other. Both hear the same moment of the song.
2. The guest adds a song. It appears in both queues.
3. The host pauses and skips. The guest follows within about a second. Ending the room ends it for both.
4. **360**: on the Listen Together page both cards fit the screen and the Start button is not clipped.

### 13. Search and TV (B, C, D)

1. Search with a misspelt artist name. Relevant results still appear.
2. With the search field empty, trending searches appear; tapping one runs it.
3. D: with the remote's direction keys, reach every control on Home, Search and the player.

### 14. Maintenance switch (owner, last)

1. In the owner console, switch the site to maintenance with a message.
2. Within about a minute the site and the app show the maintenance screen with that message. The console still works.
3. Switch back to live. Within about a minute everything returns without a manual refresh.
