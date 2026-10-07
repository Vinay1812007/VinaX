# Android app

This document covers the Android build of VinaX: how a package is built and released by the two CI workflows, how to build one locally, what the patch script adds to the generated project, what the native layer does that the web app cannot (media controls, widgets, downloads, voice, push), how app styles and themes behave inside the wrapper, how installed apps update, and what cannot be verified without a physical device. Listener-facing instructions are in [user-guide/android.md](user-guide/android.md).

## How a package is built and released

Two workflows build the package. Neither is run by hand on a developer machine.

| | Build Android APK | Release APK |
| --- | --- | --- |
| File | `.github/workflows/buildapk.yml` | `.github/workflows/release.yml` |
| Trigger | Every push to `main`, or a manual dispatch | A pushed tag matching `v*` |
| `versionCode` | `1000 + run number` | `1000000 + run number` |
| `versionName` | `version` in `frontend/package.json` | The same |
| `VITE_BUILD_NUMBER` for the web bundle | The `versionCode` | The raw run number, not the `versionCode` |
| Debug package | Built and uploaded as the run artifact `vinax-debug-apk` (`vinax-debug.apk`), kept 2 days | Not built |
| Signed package | Built only when the signing keystore secret exists | Always; the run fails without the keystore |
| Published as | The latest release, tagged `v<version>-build<versionCode>` | The latest release, on the pushed tag |
| Published files | `vinax.apk` and `vinax.apk.sha256` | The same |

Both workflows run the same steps in `frontend/`:

1. Compute the `versionCode` from the run number.
2. Install dependencies on Node 22 and run `npm run build` with `VITE_BUILD_NUMBER` set.
3. Set up Java 21 and the Android SDK.
4. `npx cap add android`, then `npx cap sync android`, then `node scripts/patch-android.js`.
5. Write `versionCode` and `versionName` into `android/app/build.gradle`.
6. Build. A release build is signed by passing the decoded keystore and its passwords to the build as injected signing properties; nothing about release signing is stored in the project.
7. Copy the release package to `vinax.apk`, write its SHA-256 to `vinax.apk.sha256`, and publish both as the latest release.

To ship a new package:

1. Set `version` in `frontend/package.json`. It becomes the `versionName` and the version in the release tag.
2. Merge to `main`. **Build Android APK** runs by itself.
3. Open the run. The debug artifact is always there. If the signing secrets exist, the run also publishes the signed release.
4. Open `/api/version` on the production site. It is cached for 60 seconds; after that `build` must equal the new `versionCode` and `sha256` must be present. Installed apps offer the update at their next launch or resume (see [Updates](#updates)).

Rules that hold in both workflows:

- A debug-signed package is never published as a release.
- In **Build Android APK**, a push with no keystore skips the release with a notice and the run stays green. A manual dispatch, or a commit message containing `[release]`, is an explicit release request and fails without the keystore.
- The release body carries a `VersionCode:` line. `/api/version` reads the build number from it; do not remove it.
- The two `versionCode` ranges are disjoint, so the workflows cannot produce the same number. The update check compares build numbers only, so a phone that installed a tag build (above one million) is not offered a later `main` build (above one thousand). Once listeners have a tag build, later packages for them have to come from tags too.
- Debug builds are signed with the keystore committed as `frontend/ci/debug-keystore.b64`, so every debug build has the same signature. That keystore is public and must never sign a release.

The four Android signing secrets, and the Worker secrets that let it read the latest release, are listed in [operations.md](operations.md#secrets). Without the Worker secrets `/api/version` and `/api/apk` answer `503`.

No workflow sets `VINAX_PLAY_STORE_BUILD`. Every package CI produces is the sideload variant with the install permission (see step 5 of the patch script below).

## Building locally

The `frontend/android/` folder is generated and git-ignored. Never edit it by hand; everything VinaX adds is re-applied by the patch script.

Requirements: Node 22 or later, a Java 21 JDK and the Android SDK, as in CI.

| Step | Command (run in `frontend/`) | What it does |
| --- | --- | --- |
| First time | `npm run cap:add:android` | `npx cap add android`, then `node scripts/patch-android.js` |
| After web or native changes | `npm run cap:sync` | `npm run build`, `npx cap sync android`, then the patch script |
| Debug package | `npm run android:debug` | `cap:sync`, then `./gradlew assembleDebug` in `android/`. The package is `android/app/build/outputs/apk/debug/app-debug.apk` |

A local build keeps the generated project's `versionCode` of 1, because only CI writes a real one. The update check therefore offers the published build on such an install.

### What `scripts/patch-android.js` does

The script is idempotent and runs after every sync.

1. Copies every `.java` file from `frontend/native-android/` into the app's package folder, replacing the `__PKG__` placeholder with `app.tarang.music`.
2. Copies `native-android/res/**` (widget layouts, vector icons, shape drawables, provider info, and `values/vinax_widgets.xml` with the widget and notification strings and colours) into the app's resources. Every file is prefixed `vinax_`, so nothing collides with the generated project's own resources.
3. Copies `native-android/google-services.json` into `android/app/` when the file exists. The wrapper library applies the push build plugin by itself when it finds the file.
4. Writes `MainActivity.java`. It registers `VinaxMediaPlugin` (app-local plugins are not discovered automatically), relays a notification tap that asks for the full-screen player, and calls the web view's `onResume()` and `resumeTimers()` in both `onPause` and `onStop`, so the notification, lock-screen and widget controls act while the app is in the background.
5. Patches `AndroidManifest.xml`: adds the foreground-service, media-playback foreground-service, wake-lock, notification and microphone permissions; adds `REQUEST_INSTALL_PACKAGES` unless the environment variable `VINAX_PLAY_STORE_BUILD` is `1`; declares the car-app metadata, the media-button receiver, `VinaxMediaService` (exported, type `mediaPlayback`, with the media-browser intent filter) and both widget receivers. Earlier copies are removed first. If the script cannot find `</application>` it exits with an error instead of writing a manifest without the media service.
6. Patches `app/build.gradle`: adds the `androidx.media` dependency and signs debug builds with the committed debug keystore.
7. Copies the launcher icons, the launcher background colour and `xml/automotive_app_desc.xml` from `frontend/android-res/`.

The manifest patch relies on the layout of the wrapper library's manifest template. After upgrading `@capacitor/android`, run the patch once and read its log before trusting a build.

## What the native layer adds

The app is a thin native shell around the web app. `frontend/capacitor.config.ts` sets:

| Setting | Value | Consequence |
| --- | --- | --- |
| `appId` | `app.tarang.music` | The package name. The patch script uses the same value |
| `webDir` | `dist` | The build output the sync step copies in |
| `server.url` | The production site | The shell loads the live web app, so web changes reach installed apps without a reinstall |
| `server.androidScheme` | `https` | Required; do not relax |
| `android.allowMixedContent` | `false` | Required; do not relax |

Because the shell loads a remote origin, two risks are recorded at the top of that config file and still stand: whoever controls the origin controls the code every installed app runs, and an origin outage leaves only what the service worker has cached. The comment records the recommended long-term fix (bundle `dist/` and use the origin only for a verified update check). It is not implemented.

Native code is limited to what a web view cannot do: the media notification and lock-screen controls, home-screen widgets, the car and watch media browser, file storage for downloads, push registration, haptics, speech recognition and installing an update.

### Media service and bridge

| File (`frontend/native-android/`) | Role |
| --- | --- |
| `VinaxMediaService.java` | A foreground service that owns the media session, the playback notification (media style) and the lock-screen controls. It extends the media-browser service base class so car and watch clients can browse and start playback |
| `VinaxMediaPlugin.java` | The bridge plugin, registered as `VinaxMedia` |
| `VinaxPlayerWidget.java` | The Now Playing widget |
| `VinaxQuickPlayWidget.java` | The static "Play my mix" widget |

Audio is played by the web player's `<audio>` element inside the web view. The service does not decode audio; it mirrors state and sends commands back. The web side is `frontend/src/services/media-session/index.ts`:

| Direction | Call or event | Purpose |
| --- | --- | --- |
| Web → native | `setMetadata` | Title, artist, album and artwork (a 256 px JPEG data URL). The title is sent first so the notification never waits for the cover. The optional lock-screen lyric line travels in the artist field |
| Web → native | `setPlaybackState` | `playing`, `paused` or `none`. Every state flip re-sends the position so the seek bar does not jump |
| Web → native | `setPosition` | Duration, position and rate for the lock-screen seek bar. At most once a second, and always on a track's first tick and after a state flip |
| Web → native | `provideChildren` | Answers a browse request with a list of playable items |
| Web → native | `stop` | Ends the session and clears the widget |
| Native → web | `action` | Play, pause, next, previous, seek to, seek by ±10 s, open the player, and `resync` |
| Native → web | `requestChildren` | A car or watch client asked for a folder's contents |

`mediaSessionAvailable()` in `frontend/src/services/native/index.ts` reports whether the plugin is compiled in. For on-device diagnosis the module keeps the last 12 bridge calls in memory (`getMediaSessionLog()`), and `runNotificationSelfTest()` posts a test notification. In a browser the same module uses the browser's own media session.

Android 13 and later hide the media notification without the notification permission. The app asks once at launch (`requestNotificationPermissionOnce`, called from `AppLayout`), checks again when playback first starts (`checkNotificationOnFirstPlay`, called from the player store), and tells the listener once how to fix a denial.

Also in `AppLayout`: playback resumes by itself after a phone call or another forced interruption, and the wheel rescue described in [design-system.md](design-system.md) is switched off in the app.

### Background playback, and where it ends

Background play means the activity is paused or stopped (home button, screen off, another app on top) while the web view keeps running. What keeps it working:

1. The web view is never paused. `MainActivity` re-asserts `onResume()` and `resumeTimers()` in `onPause` and `onStop`, for vendor skins that pause the view themselves. Both calls are idempotent.
2. `VinaxMediaService` enters the foreground synchronously in `onStartCommand`, before the intent is handled, on every path. A service started as a foreground service that does not enter the foreground within five seconds is killed. The call passes the `mediaPlayback` type, which Android 14 requires both in the manifest and at run time.
3. The service stays in the foreground while paused. It leaves only on an explicit stop, when the task is swiped away, and on destroy. Android 12 and later refuse to bring a service into the foreground while the app is in the background, but always allow updating one that is already there. The player store fills the notification with the restored queue right after launch, while the activity is visible, so the service is normally in the foreground for the whole session.
4. Once the service is running, the plugin calls it directly. A position tick is a method call, not a service start.
5. If a start is refused anyway (the service was stopped, the app is in the background and a song starts by itself), the plugin catches the exception, rejects the bridge call with `fgs-start-not-allowed` (visible in `getMediaSessionLog()`), posts a plain notification when it can, and asks the web view for a `resync` when the activity next resumes. The web side answers by replaying the cached metadata, state and position. The audio keeps playing throughout; only the controls are late.
6. Unplugging headphones or losing a wireless output (`ACTION_AUDIO_BECOMING_NOISY`) pauses at once. The receiver is registered as not exported, as Android 14 requires.
7. The notification channel is `IMPORTANCE_LOW`: no sound, no vibration. The notification has category `transport`, is ongoing while playing, uses a monochrome status-bar glyph and VinaX's own vector icons, and asks for immediate display (Android 12 may otherwise hold a new foreground notification back for ten seconds).
8. Media buttons (headset, car, watch) reach the session through the exported media-button receiver.

What this design cannot do:

- **Playback does not survive the process.** The audio element lives in the web view. When the listener swipes the app away, or the system kills the process, the audio stops and the service tears itself down (`onTaskRemoved`) so no dead notification or widget remains. The Now Playing widget's play button then opens the app with `?widget=play`, which starts the listener's mix: one tap, but a relaunch, not a resume.
- **Nothing can start playback while the process is dead.** A media button or a car client connecting after the process died reaches nothing.
- **Audio focus is not managed natively.** The web view ducks and pauses for other apps as it sees fit; the service does not request focus.
- **A stopped service in a backgrounded app cannot show controls until the app resumes** (item 5). The music plays; the notification arrives late.

### Home-screen widgets

Both widgets are plain remote views fed by pushes, so they never poll (`updatePeriodMillis="0"`). Both declare a `previewLayout` and a description for the Android 12+ picker. There is no rendered preview image, so pickers below Android 12 show the app icon.

| Widget | Provider info | Layouts | Behaviour |
| --- | --- | --- | --- |
| Now Playing (`VinaxPlayerWidget`) | `res/xml/vinax_player_widget_info.xml`: 4×1 by default, resizable both ways | `vinax_widget_player.xml` (row) and `vinax_widget_player_tall.xml` (card), same ids | The service pushes title, artist, artwork and the playing flag on every change and clears them on stop, task removal and destroy. Artwork is rounded in Java. From about two rows of height the widget switches to the card. Artwork, title and the card open the full-screen player |
| Quick play (`VinaxQuickPlayWidget`) | `res/xml/vinax_widget_info.xml`: 4×1, resizable horizontally | `vinax_widget_quickplay.xml` | One tap opens the app with `?widget=play`. `AppLayout` relays the URL (a cold start works too) and `HomePage` starts the mix once its first songs arrive |

Taps on the Now Playing buttons go to the widget's own receiver, which decides at tap time. With the app process alive they become previous, toggle and next intents for the service; the service resolves toggle from its own state. With the process gone, play opens the app with `?widget=play`, and previous and next open the app on the player.

The widgets' look is fixed in `native-android/res/`: a dark translucent rounded surface, white title, muted artist line and a violet (`#A78BFA`) play disc. It does not follow the app style, the theme or a festival skin.

### App styles, themes and the system bars

The six app styles and the festival skins are web CSS. Inside the wrapper they are the same code as in a browser, and they arrive with the live site. Nothing under `native-android/`, nothing in the patch script and no build step varies by style.

What the web code does to the page chrome:

| Case | `<html>` background | `<meta name="theme-color">` |
| --- | --- | --- |
| Any style, dark or light | The style's canvas from `TEMPLATE_CANVAS` in `frontend/src/utils/theme.ts` | The same colour |
| Black theme | `#000000` in every style | `#000000` |
| Festival skin on | The skin's tinted canvas (`frontend/src/styles/festivals.css` overrides the background) | Unchanged: it keeps the style's canvas |

The inline script in `frontend/index.html` sets both before first paint, and `applyThemeClasses` keeps them current when the theme or style changes.

What happens natively:

- No code in this repository sets the native status-bar or navigation-bar colour. There is no status-bar plugin in `frontend/package.json`, no such call in `frontend/src/` or `native-android/`, and the patch script does not touch the generated project's theme.
- The `theme-color` tag is read by browsers and by the installed web app. Nothing passes it to the native window.
- `capacitor.config.ts` has no system-bar settings, so the wrapper library's built-in handling runs with its defaults. At the installed version (`@capacitor/android` 8.4.1) that default picks light or dark bar icons from the device's dark-mode setting, not from the theme chosen in VinaX.
- The page reserves room for the bars itself: the viewport is declared `viewport-fit=cover` and the shell pads with `env(safe-area-inset-*)`.

How the bars look for each style, in the Black theme and under a festival skin, has not been checked on a device; see the last section.

### Downloads

Downloads exist only in the Android app. `frontend/src/services/downloads/index.ts`:

- Audio is fetched with native HTTP, so there are no cross-origin limits. The catalogue lists a URL for every bitrate whether or not the file exists, so a download walks the listed variants from the highest bitrate down (`downloadUrls`). A variant that is missing, or answers with less than 10 KB, moves to the next. A dead network, a stall or a full disk stops the walk, since every variant would fail the same way.
- The `vinax-downloads/` folder is created before each attempt, because the native downloader does not create it. Sending the file through the JavaScript bridge is the fallback only for a native layer that cannot download, never for an HTTP, network or storage error.
- Each attempt has a 15 s connect timeout, a 30 s timeout per read and a 5-minute cap, so a stalled transfer cannot hold up **Download all**.
- Files go to the app's internal data directory, which needs no storage permission, with device storage as the fallback. Each item remembers its directory, so files saved to device storage by older versions keep playing.
- A download counts as saved once the file is on disk. The copy into the audio cache runs afterwards in the background, one song at a time, in 3 MB slices, capped at two minutes per song. On every launch the same queue rebuilds a missing cache entry from the file.
- A failure carries a reason (`classifyDownloadError`) that the song menu, collection pages and Favorites show: `offline`, `unavailable` (no variant could be downloaded), `storage` (no space or no access), `timeout` or `unknown`. A bulk download stops once a failure is `offline`.
- A saved song has three offline sources, tried in order before any streaming URL: a `blob:` URL built from the audio cache, the service worker route `/offline-audio/<id>` (served with range support from the `vinax-audio-v1` cache by `frontend/public/sw.js`), and the native file URL.
- Entry points: **Download** and **Remove download** in the song menu, bulk download on collection pages and Favorites, and the Downloads screen at `/offline`.
- When the app opens without a network and at least one song is saved, the router starts on `/offline` instead of Home (`frontend/src/router/index.tsx`).

Boot recovery in `frontend/index.html` never deletes downloads. The recovery that unregisters service workers and purges caches runs only after a request to the origin succeeds, and it skips the `vinax-audio-v1` cache. Offline, the boot screen says "You're offline — VinaX will finish loading when you reconnect." and reloads when the connection returns.

Downloaded files are not part of the backup file; see [data-and-privacy.md](data-and-privacy.md).

### Voice

Dictation, voice search and live voice use the system speech recogniser through the `@capacitor-community/speech-recognition` plugin (`frontend/src/features/voice/stt.ts`). The web view exposes a speech-recognition constructor with no service behind it, and starting it closes the renderer, so in the app that constructor is never created. The microphone permission is declared by the patch script as well as by the plugin.

### Push

`frontend/src/services/push/nativePush.ts` registers the device for background push and routes notification taps into the app. It does nothing unless the build contains `google-services.json` and the Worker has its push secret. Setup, status and a delivery test are in [fcm-push-setup.md](fcm-push-setup.md).

The key inside `google-services.json` ships in every package, so it is public. `frontend/native-android/README.md` lists the restrictions that must be applied to it, and warns that rotating the key cuts push for installed apps until they update.

## Updates

Web changes arrive by themselves because the shell loads the live site. The native package updates through a sideload flow in `frontend/src/services/update.ts`.

1. `AppLayout` calls `checkForUpdate()` at launch and again on every app resume.
2. The check reads the installed `versionCode` from the native package and fetches `/api/version` with native HTTP. It compares build numbers, never version names.
3. `/api/version` (`backend/worker/functions/api/version.ts`) reads the latest published release with a server-side token and answers `{ build, version, apkUrl, sha256, minBuild }`. `build` comes from the `VersionCode:` line in the release body, with the tag's `-build<n>` suffix as the fallback. `sha256` comes from the published `.sha256` file. `apkUrl` is the Worker's own `/api/apk`, which streams the package so the release host and its token are never exposed. `/apk` redirects to `/api/apk`.
4. A newer build opens `UpdateDialog` with **Update now** and **Update later**. Later snoozes that build for 24 hours (`UPDATE_SNOOZE_MS`). Escape and the back button count as later. A still newer build shows the dialog again, the manual check in Settings ignores the snooze, and the Home banner keeps the reminder visible.
5. `minBuild` is the console's **Minimum App Version** setting (`min-version`). When the installed build is below it, the update is mandatory and there is no Later. A resume check that fails (offline, request error) never clears a known update (`mergeResumeCheck`), so a mandatory gate cannot be dismissed by backgrounding the app in flight mode.
6. **Update now** runs `downloadAndInstall()`: it downloads the package with native HTTP and computes its SHA-256 before anything is written. A missing or malformed hash in the manifest, or a mismatch, aborts. Only then is the file written to the app cache and handed to the system installer, which shows its own consent the first time.
7. The system installer reports nothing back. The app records the attempt (`markUpdateAttempt`); if the dialog returns for the same build more than 10 minutes later, `installLikelyBlocked()` switches it to one-time reinstall guidance. That covers a copy signed with a different key, which the system refuses to upgrade.

## What cannot be verified without a device

The unit tests cover the pure parts: update attempt tracking (`frontend/src/__tests__/updateAttempt.test.ts`), download de-duplication, retry and the storage fallback (`frontend/src/services/downloads/index.test.ts`), the web side of the media session including the resync replay and the position gate (`frontend/src/services/media-session/index.test.ts`), and the release-to-build parsing in the Worker (`backend/worker/__tests__/versionEndpoint.test.ts`). The Java under `native-android/` is never compiled by the test toolchain; `frontend/src/__tests__/nativeMediaService.test.ts` only pins its contracts at the string level. The browser end-to-end suite runs the web build only. CI compiles the generated project, but nothing runs it.

None of the following can be confirmed from this repository or from CI. Each needs a real phone; the manual script is [qa-device-script.md](qa-device-script.md).

- That the package installs on a given Android version and that the patched manifest is accepted by that version's installer.
- The playback notification and lock-screen controls: that they appear, stay while paused, show artwork, and that play, pause, next, previous and the seek bar act on the web player while the app is in the background.
- On Android 12 to 15: that no foreground-service start is refused in normal use, that the notification shows immediately, that a song started from the background after a stop plays with late controls and a resync on resume instead of crashing, and that the status-bar glyph renders as a monochrome silhouette.
- Vendor battery and background policies. The `onPause` / `onStop` workaround and the foreground service behave differently across vendor skins.
- That unplugging headphones or dropping a wireless output pauses at once and flips the notification and widget to the paused face.
- Resume after a phone call, headset and wireless buttons, and audio focus with other apps.
- The car and watch media browser: browsing, starting playback and artwork.
- Both home-screen widgets: rendering on light and dark wallpapers, the rounded artwork, live updates, the switch to the tall card, button taps with the app alive, and with the app swiped away, that play relaunches into the mix and previous and next open the player.
- The system bars for each app style, in light, dark and the Black theme, and under a festival skin: what colour sits behind the status and navigation bars, and whether the bar icons stay legible when the theme chosen in VinaX differs from the device's dark-mode setting.
- Downloads: writing to storage, playback from each of the three offline sources, the offline launch redirect, and behaviour when storage is full or the app's folder is cleared.
- The update flow end to end: native download, hash check, the system installer's consent, install over an existing copy, the different-signature reinstall path and the mandatory gate.
- Background push delivery with the app closed, and that a tap opens the right screen.
- The microphone permission prompt and the system speech recogniser.
- Haptics, the hardware back button on sheets and dialogs, safe-area insets on notched screens, and the offline first launch after a fresh install.
