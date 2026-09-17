# Android app

This document covers the Android build of VinaX: how the native project is generated and patched, what the app shell loads, the native media service and its bridge to the web player, offline downloads, push, the in-app update flow, how the two CI workflows build and publish the package, and what cannot be verified without a physical device. Listener-facing instructions are in [user-guide/android.md](user-guide/android.md).

## Shape of the app

The Android app is a thin native shell around the web app. `frontend/capacitor.config.ts` sets:

| Setting | Value | Consequence |
| --- | --- | --- |
| `appId` | `app.tarang.music` | The package name. `scripts/patch-android.js` uses the same value |
| `webDir` | `dist` | The build output the sync step copies in |
| `server.url` | The production site | The shell loads the live web app, so web changes reach installed apps without a reinstall |
| `server.androidScheme` | `https` | Required; do not relax |
| `android.allowMixedContent` | `false` | Required; do not relax |

Because the shell loads a remote origin, two risks are documented at the top of that config file and still stand: whoever controls the origin controls the code every installed app runs, and an origin outage leaves only what the service worker has cached. The config comment records the recommended long-term fix (bundle `dist/` and use the origin only for a verified update check). It is not implemented.

Native code is limited to what a web view cannot do: the media notification and lock-screen controls, home-screen widgets, the car and watch media browser, file storage for downloads, push registration, haptics, speech recognition and installing an update.

## Generating and building the project

The `frontend/android/` folder is generated and git-ignored. It is never edited by hand; everything VinaX adds is re-applied by the patch script.

Requirements: Node 22 or later, a Java 21 JDK and the Android SDK (CI uses exactly these).

| Step | Command (run in `frontend/`) | What it does |
| --- | --- | --- |
| First time | `npm run cap:add:android` | `npx cap add android`, then `node scripts/patch-android.js` |
| After web or native changes | `npm run cap:sync` | `npm run build`, `npx cap sync android`, then the patch script |
| Debug package | `npm run android:debug` | `cap:sync`, then `./gradlew assembleDebug` in `android/` |

### What `scripts/patch-android.js` does

1. Copies every `.java` file from `frontend/native-android/` into the app's package folder, replacing the `__PKG__` placeholder.
2. Copies `native-android/res/**` (widget layouts, drawables, provider info) into the app's resources.
3. Copies `native-android/google-services.json` into `android/app/` when the file exists. The native wrapper then applies the push messaging build plugin by itself.
4. Writes `MainActivity.java`. It registers `VinaxMediaPlugin` (app-local plugins are not auto-discovered), relays a notification tap that asks for the full-screen player, and resumes the web view's timers in `onPause` so the notification's play, pause and next work while the app is in the background.
5. Patches `AndroidManifest.xml`: adds the foreground-service, media-playback foreground-service, wake-lock, notification and microphone permissions; adds `REQUEST_INSTALL_PACKAGES` unless the environment variable `VINAX_PLAY_STORE_BUILD` is `1`; declares the car-app metadata, the media-button receiver, `VinaxMediaService` (exported, type `mediaPlayback`, with the media-browser intent filter) and both widget receivers. It removes earlier copies first so re-runs are idempotent, and it exits with an error if it cannot find `</application>` rather than write a manifest without the media service.
6. Patches `app/build.gradle`: adds the `androidx.media` dependency and signs debug builds with the committed keystore decoded from `frontend/ci/debug-keystore.b64`. That keystore is public and is for debug builds only. Release signing is injected by CI.
7. Copies launcher icons and `xml/automotive_app_desc.xml` from `frontend/android-res/`.

No workflow sets `VINAX_PLAY_STORE_BUILD`. Every package CI produces today is the sideload variant with the install permission.

## Native media service

| File (`frontend/native-android/`) | Role |
| --- | --- |
| `VinaxMediaService.java` | A foreground service that owns the media session, the playback notification (media style) and lock-screen controls. It extends the media-browser service base class so car and watch clients can browse and start playback. It always calls `startForeground()`, because posting the notification any other way is dropped by several vendor skins |
| `VinaxMediaPlugin.java` | The bridge plugin, registered as `VinaxMedia` |
| `VinaxPlayerWidget.java` | Now Playing widget: artwork, title, previous, play/pause, next. Fed by the media service |
| `VinaxQuickPlayWidget.java` | A static "Play my mix" widget |

Audio itself is played by the web player's `<audio>` element inside the web view. The service does not decode audio; it mirrors state and sends commands back.

The web side is `frontend/src/services/media-session/index.ts`:

| Direction | Call or event | Purpose |
| --- | --- | --- |
| Web → native | `setMetadata` | Title, artist, album, artwork |
| Web → native | `setPlaybackState` | `playing`, `paused` or `none` |
| Web → native | `setPosition` | Duration, position, rate, for the lock-screen seek bar |
| Web → native | `provideChildren` | Answers a browse request with a list of playable items |
| Web → native | `stop` | Ends the session |
| Native → web | `action` | Play, pause, next, previous, seek to, seek by ±10 s, open the player |
| Native → web | `requestChildren` | A car or watch client asked for a folder's contents |

`mediaSessionAvailable()` in `frontend/src/services/native/index.ts` reports whether the plugin is compiled in. The module keeps the last 12 bridge calls in memory (`getMediaSessionLog()`), and `runNotificationSelfTest()` posts a test notification; both exist for on-device diagnosis. On the web the same module falls back to the browser's media session API. The optional lock-screen lyric line is sent through the metadata call.

Android 13 and later hide the media notification without the notification permission. The app asks once at launch (`requestNotificationPermissionOnce`), re-checks when playback first starts, and tells the listener once how to fix a denial.

Related web-side behaviour in `AppLayout`: after a phone call or another forced interruption, playback resumes by itself; the wheel rescue described in [design-system.md](design-system.md) is disabled in the app.

## Downloads

Downloads exist only in the Android app. `frontend/src/services/downloads/index.ts`:

- Audio is fetched with native HTTP, so there are no cross-origin limits, choosing the highest bitrate the catalogue lists. A response too small to be audio is rejected.
- Files are written to the app's own folder on device storage, with the internal data directory as the fallback. Each item remembers which directory it was saved under, so older downloads keep playing.
- A saved song has three offline sources, tried in order before any streaming URL: a `blob:` URL built from the audio cache, the service worker route `/offline-audio/<id>` (served with range support from the `vinax-audio-v1` cache by `frontend/public/sw.js`), and the native file-bridge URL. The second and third are derived synchronously, so a download is playable from the first frame of an offline launch.
- Entry points: **Download** / **Remove download** in the song menu, bulk download on collection pages and Favorites, and the Downloads screen at `/offline`, which shows an estimated size (duration × the high-quality bitrate; the catalogue does not report file sizes).
- Offline launch: when the app opens without a network and at least one song is saved, the router starts on `/offline` instead of Home (`frontend/src/router/index.tsx`).

Downloaded files are not part of the backup file; see [data-and-privacy.md](data-and-privacy.md).

## Push and voice

- Push: `frontend/src/services/push/nativePush.ts` registers the device for background push, posts the token to `/api/push/fcm-register` and routes notification taps into the app. It does nothing unless the build contains `google-services.json` and the Worker has its push service-account secret. Setup and status: [fcm-push-setup.md](fcm-push-setup.md). The key inside `google-services.json` ships in every package; `frontend/native-android/README.md` lists the restrictions that must be applied to it.
- Voice: in the app, speech-to-text uses the system speech recognizer through a native plugin (`frontend/src/features/voice/stt.ts`), because the web view has no web speech API. The microphone permission is declared by the patch script.

## Update flow

Web changes arrive by themselves because the shell loads the live site. The native package updates through a sideload flow in `frontend/src/services/update.ts`.

1. `AppLayout` calls `checkForUpdate()` at launch and again on every app resume.
2. The check reads the installed `versionCode` from the native package and fetches `/api/version` with native HTTP. It compares build numbers, never version names.
3. `/api/version` (`backend/worker/functions/api/version.ts`) reads the latest published release with a server-side token and answers `{ build, version, apkUrl, sha256, minBuild }`. `build` comes from the `VersionCode:` line CI writes into the release body, with the tag's `-build<n>` suffix as the fallback. `apkUrl` is the Worker's own `/api/apk`, which streams the package so the release host and its token are never exposed. `/apk` redirects to `/api/apk`.
4. A newer build opens `UpdateDialog` with **Update now** and **Update later**. Later snoozes that build for 24 hours (`UPDATE_SNOOZE_MS`); Escape and the back button count as later; a still newer build shows the dialog again; the manual check in Settings ignores the snooze; the Home banner keeps the reminder visible.
5. When the installed build is below the console's Minimum App Version, the update is mandatory and there is no Later. A resume check that fails (offline, request error) never clears a known update, so a mandatory gate cannot be dismissed by backgrounding the app in flight mode.
6. **Update now** runs `downloadAndInstall()`: native HTTP download to the app cache, then a SHA-256 check against the manifest. A missing or malformed hash, or a mismatch, aborts the install. Then the file is handed to the system installer, which shows its own consent the first time.
7. The system installer reports nothing back. The app records the attempt (`markUpdateAttempt`); if the dialog returns for the same build more than 10 minutes later, `installLikelyBlocked()` switches it to one-time reinstall guidance. That covers installs signed with the old debug key, which the system refuses to upgrade across signatures.

## CI builds

| Workflow | Trigger | versionCode | Output |
| --- | --- | --- | --- |
| `.github/workflows/buildapk.yml` | Every push to `main`, or manual dispatch | `1000 + run number` | A debug package as a 2-day build artifact. When the four `ANDROID_KEYSTORE_*` secrets exist, also a signed release package and its `.sha256`, published as the latest release tagged `v<version>-build<versionCode>` |
| `.github/workflows/release.yml` | A pushed tag matching `v*` | `1000000 + run number` | A signed release package. It fails if the keystore secret is missing |

Both workflows build the web bundle with `VITE_BUILD_NUMBER` set to the versionCode, add the platform, sync, run the patch script, then write `versionCode` and `versionName` (from `frontend/package.json`) into `app/build.gradle`. The two versionCode ranges are disjoint so the workflows can never collide or regress.

Signing rules in `buildapk.yml`: a debug-signed package is never published as a release. With no keystore, an ordinary push skips the release step with a notice and stays green; a manual dispatch or a commit message containing `[release]` fails instead. The release body carries the `VersionCode:` line that `/api/version` depends on; do not remove it.

The Worker needs `GITHUB_TOKEN` (and optionally `GITHUB_REPO`) to serve `/api/version` and `/api/apk`; without them both answer `503`. See [operations.md](operations.md).

## What cannot be verified without a device

The unit tests cover the pure parts: update attempt tracking (`frontend/src/__tests__/updateAttempt.test.ts`), download de-duplication, retry and the storage fallback (`frontend/src/services/downloads/index.test.ts`), and the release-to-build parsing in the Worker (`backend/worker/__tests__/versionEndpoint.test.ts`). The Java under `native-android/` is never compiled by this toolchain; `frontend/src/__tests__/nativeMediaService.test.ts` only pins its contracts at the string level. The browser end-to-end suite runs the web build only. None of the following can be confirmed from this repository or from CI, and each needs a real phone (the manual script is [qa-device-script.md](qa-device-script.md)):

- That the generated project builds and installs on a given Android version, and that the patched manifest is accepted by that version's installer.
- The playback notification and lock-screen controls: that they appear, stay while paused, show artwork, and that play, pause, next, previous and the seek bar act on the web player while the app is in the background.
- Vendor battery and background policies. The `onPause` timer workaround and `startForeground()` behave differently across vendor skins.
- Resume after a phone call, headset and Bluetooth buttons, and audio focus with other apps.
- The car and watch media browser: browsing, starting playback and artwork.
- Both home-screen widgets: rendering, live updates and button taps.
- Downloads: writing to device storage, playback from each of the three offline sources, the offline launch redirect, and behaviour when storage is full or the app's folder is cleared.
- The update flow end to end: native download, hash check, the system installer's consent, install over an existing copy, the signature-mismatch reinstall path and the mandatory gate.
- Background push delivery with the app closed, and that a tap opens the right screen.
- The microphone permission prompt and the system speech recognizer.
- Haptics, the hardware back button on sheets and dialogs, safe-area insets on notched screens, and the offline first launch after a fresh install.
