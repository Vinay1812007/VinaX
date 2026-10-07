# Android

This page covers what the Android app adds to VinaX: playback in the background, controls in the notification and on the lock screen, home-screen widgets, offline downloads, push notifications and in-app updates. Everything else works as it does in the browser, so the other guides apply unchanged. Looks are the same too: see [app styles](app-styles.md) and [festival themes](festival-themes.md).

## Get the app

1. Open VinaX in your phone's browser.
2. On Home, tap **Get the VinaX app** or the **Take VinaX anywhere** card.
3. On the **VinaX for Android** page, press **Download APK**.
4. Open the downloaded file. Android asks you to allow the install.

Your library does not follow you by itself, because there is no sign-up. To bring it across, use **Move to a new device**, or export a backup in the browser and restore it in the app. Both are described in [Library and backup](library-and-backup.md).

## What the app adds

| Feature | What it does |
|---|---|
| Background playback | Music keeps playing with the screen off or with another app open |
| Media notification | Play, pause, previous, next and seek from the notification and the lock screen |
| Home-screen widgets | A Now Playing widget with artwork, title, artist and previous, play/pause and next. A quick-play widget that opens the app and starts your mix with one tap. |
| Offline downloads | Save songs to the phone and play them with no connection |
| Lock screen lyrics | A setting that shows the current synced lyric line on the lock screen and media controls |
| Push notifications | New song picks sent to this phone, if you turn them on |
| Haptics | A setting for a subtle vibration on key actions |

The app asks for permission to show notifications at the end of the welcome steps.

If a phone call or another app pauses the music, VinaX resumes when you come back to the app, as long as that is within half an hour.

Keyboard shortcuts are not active in the Android app.

## Download songs

- **One song:** open the song's **⋯** menu and choose **Download**. When it finishes you see "Saved for offline".
- **An album or playlist:** open it and press **Download**. The button counts the songs as they finish.
- **Remove a download:** open the song's menu and choose **Remove download**, or remove it in **Library → Downloads**.

To find your offline music:

- **Library → Downloads** lists every downloaded song, with **Play all** and **Shuffle play**.
- In the Library, the **Downloaded** chip appears once you have downloads. It shows only what plays offline.
- On an album or playlist page, **Downloaded only** does the same for that page.

A song is saved in the highest quality available for it. When the top quality does not exist, the next one down is used. A download that stalls gives up, so it does not hold up the rest.

When a download fails, VinaX says why:

| Message | What to do |
|---|---|
| No internet connection | Connect and try again |
| This song isn't available to download | Try another version of the song |
| Couldn't save to your phone | Free up some space and try again |
| The download stalled | Check your connection and try again |
| Download failed | Try again |

Downloaded audio stays on the phone that downloaded it. It is never part of a backup.

## Push notifications

To turn them on or off, open **Settings → Notifications** and use the **Push notifications** switch. They can be turned off at any time.

## Updates

The app checks for a newer version when it opens and when you return to it. When there is one, an **Update available** sheet appears:

- **Update now** downloads the update inside the app and opens the installer. Android asks you to confirm.
- **Update later** closes the sheet and stops reminding you about that version.

To check yourself, open **Settings → Help & about**, find **App version** and press **Check for updates**.

If your version is no longer supported, the sheet says so and asks you to update before you continue.

Occasionally an update cannot be installed over the old app. The sheet then says **One-time reinstall needed** and walks you through it:

1. Press the button that saves your data file. This saves a backup to your phone.
2. Uninstall VinaX, then run the installer.
3. In the new app, open **Settings → Your data → Restore a backup (quick)** and choose that file.
