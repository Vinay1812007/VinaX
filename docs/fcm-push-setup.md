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

## If devices report `FIS_AUTH_ERROR` (no Android device gets a token)

Seen in Technical Monitoring as `push-native` — `registration error: … java.io.IOException: FIS_AUTH_ERROR` (2026-10-12). The push provider's installation service refused the app's API key, so `register()` never yields a token and no Android device is ever saved; the server and the app code are not at fault. Every APK is signed with the stable CI debug keystore (`frontend/ci/debug-keystore.b64`), whose fingerprints are:

- SHA-1 `71:27:BB:E2:25:1F:9E:A4:89:61:EC:9B:76:A5:07:5F:94:DE:A2:CC`
- SHA-256 `D3:00:8F:AC:86:2B:C0:A9:82:3C:97:27:D7:B3:E5:BA:20:C0:50:B2:05:A1:1A:41:C2:8C:41:7F:44:40:0D:33`

Fix, in the push provider's console for the project in `google-services.json` (project number `296694772987`):

1. **Project settings → Your apps → Android app `app.tarang.music` → Add fingerprint**: add both fingerprints above.
2. **The cloud console's APIs & Services → Library**: make sure **Firebase Installations API** and **Firebase Cloud Messaging API** are enabled.
3. **APIs & Services → Credentials → the Android key** (the `current_key` in `google-services.json`): if it has *Application restrictions*, they must allow Android package `app.tarang.music` with the SHA-1 above; if it has *API restrictions*, they must include Firebase Installations API and Firebase Cloud Messaging API (or set "Don't restrict key").
4. Download the refreshed `google-services.json`, replace `frontend/native-android/google-services.json`, commit, and let the APK build. Changes to key restrictions can take a few minutes to apply.

Then open the new app once: Settings → Notifications → turn on. The console's "Send a message" page should count one more device, and the `push-native` rows stop.

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
