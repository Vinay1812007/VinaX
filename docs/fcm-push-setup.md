# Android background push — setup

This is an operations document. It covers the one secret the owner has to set so that notifications reach the Android app while it is fully closed, what is already wired in the repository, what the server stores for each device, and how to test delivery. Browser push is separate and needs only the `VAPID_*` secrets listed in [operations.md](operations.md#secrets).

## The one step

The Worker needs the push project's **service-account private key** to sign send requests. It is a secret, so the owner sets it; it is never committed.

1. In the push provider's console, open the project named in `frontend/native-android/google-services.json`, then Project settings → Service accounts, and generate a new private key. A JSON file downloads.
2. Set the whole file as the Worker secret `FCM_SERVICE_ACCOUNT`:

   ```sh
   cd backend
   npx wrangler secret put FCM_SERVICE_ACCOUNT --config worker/wrangler.toml
   ```

   Paste the entire JSON when prompted. No app rebuild is needed.

Until the secret is set the push path does nothing: the app runs normally and tokens are stored, but no message is sent (`fcmConfigured()` in `backend/worker/functions/_lib/fcm.ts`).

## The project (12.2)

Since 12.2 the app is `app.Vinax.music` in the push project **VinaX Music** (`vinax-music`, project number `152181244509`, free plan). `frontend/native-android/google-services.json` is that project's file, with the Android app registered under the CI signing key's SHA-1 `71:27:BB:E2:25:1F:9E:A4:89:61:EC:9B:76:A5:07:5F:94:DE:A2:CC`. The same project runs the optional Google sign-in.

**The published APKs are signed with the release key, not the CI key.** Its fingerprints (read from release v13.7.2, build 1427) are:

- SHA-1 `D9:55:85:C3:D4:4F:52:92:47:39:7C:95:A0:E5:F9:D1:11:BA:62:BE`
- SHA-256 `8C:AF:24:E7:AA:83:B7:EA:12:E1:2C:E3:FF:C1:14:DD:8C:EB:57:38:25:AB:EB:82:3E:FE:AE:E4:F2:6B:7C:CE`

Both must be added to the Android app in Firebase (Project settings → Your apps → `app.Vinax.music` → Add fingerprint), and the SHA-1 to an Android OAuth client for `app.Vinax.music` in Google Cloud (APIs & Services → Credentials). If the Firebase API key is restricted to Android apps, the release SHA-1 must be on that restriction too. Without them, installed apps cannot get a push token or sign in with Google. Afterwards download the new `google-services.json` and replace `frontend/native-android/google-services.json`. To read the fingerprint of any APK: `apksigner verify --print-certs vinax.apk`.

**How a push looks (13.7.3).** Every message goes to the `vinax_picks` channel ("Song picks & news", high importance), created by the app at start-up, with the white V small icon `vinax_ic_notify` and the accent `#FFA42E`. The manifest names the same three as FCM's defaults, so a push the system draws while the app is closed looks the same. A push that arrives while the app is open is shown too (`presentationOptions` in `capacitor.config.ts`). These are compiled into the APK: they apply from the first APK built after 13.7.3.

The old project (`apptarangmusic`, app `app.tarang.music`) is retired: its devices reported `FIS_AUTH_ERROR` (the installation service refused the app), so no Android device ever got a token. Once `FCM_SERVICE_ACCOUNT` holds the new project's key (above), delete the old project's keys, or the whole old project, in its console.

Because the package changed, the 12.2 APK installs beside the old app instead of replacing it. Listeners move their library with Settings → Your data → Move to a new device, then remove the old app. Push sign-ups from the old app do not carry over.

## What is wired in the repository

| Part | Where |
| --- | --- |
| Push client configuration | `frontend/native-android/google-services.json`. `frontend/scripts/patch-android.js` copies it into the generated `android/app/` on every build, and the Android build applies the matching Gradle plugin when the file is present. No manual Gradle edits. |
| App side | `frontend/src/services/push/nativePush.ts` registers the device on launch, posts the token to `/api/push/fcm-register` and routes notification taps into the app. Native builds only. |
| Server side | `backend/worker/functions/api/push/fcm-register.ts` stores tokens in the `vinax_fcm_tokens` table. `backend/worker/functions/_lib/fcm.ts` signs and sends messages. The console's push send (`/api/admin/push`) fans out to stored tokens. |
| Dependency | `@capacitor/push-notifications` |

The key inside `google-services.json` ships inside every package and is therefore public. It is safe only while the restrictions in `frontend/native-android/README.md` are applied to it (package name plus signing certificate, and only the push-related APIs).

## What the server stores for a device

One row per push token: the token, the platform, the app language, the time-zone offset, and the coarse location the edge reports for the request (country, region, city). There is no name, username or install id in the row, and no address. The listener-facing account of this is in [data-and-privacy.md](data-and-privacy.md).

## Test delivery

1. Install the newest package from the repository's releases, open it once and grant the notification permission.
2. Swipe the app fully closed.
3. In the owner console's Notifications section, send a push. It should arrive, and tapping it should open the app at the target.

A device is required; see [android.md](android.md#what-cannot-be-verified-without-a-device).
