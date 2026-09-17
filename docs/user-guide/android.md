# Android

This page covers what the Android app adds to VinaX for a listener: background playback, the media notification, offline downloads, push notifications and in-app updates. Everything else works as in the web app, and the other guides apply unchanged. The engineering description is in [android](../android.md).

## Getting the app

Open the **Get the app** card on Home, or go to `/download` in the web app. The Android app is installed from a file, so Android asks you to allow the install.

Your data does not follow you automatically, because there is no account. Use **Settings → Your Data → Move to a new device** on the web app, or export a backup and import it in the Android app. See [Library and backup](library-and-backup.md).

## What the app adds

| Feature | Notes |
|---|---|
| Background playback | Music keeps playing with the screen off or another app open |
| Media notification | Play, pause and skip from the notification and the lock screen. The app asks for the notification permission at the end of the welcome flow. |
| Calls | Android pauses audio during a call; VinaX resumes when the call ends |
| Downloads | Song menu → **Download**. Downloaded songs play with no network. **Library → Downloaded only** filters to them; **Downloads** lists and removes them. |
| Push notifications | **Settings → Notifications → Push notifications**. Off means nothing is sent to this device. |
| Haptics | Light feedback on navigation and skips |

Downloaded audio stays on the phone that downloaded it. It is never part of a backup.

Keyboard shortcuts are not active in the Android app.

## Updates

The app checks for a newer build when it opens and when it returns to the foreground. When one exists you can **Update now** or **Update later**; later snoozes the reminder for that build. **Settings → Check for updates** always shows what is available. The update downloads inside the app and Android then asks you to confirm the install; the first time, Android also asks you to allow installs from VinaX.

If a build is no longer supported, the app says so and asks you to update before you continue.
