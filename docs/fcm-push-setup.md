# Android background push — setup

This is an operations document. It covers what is already wired for push notifications that reach the Android app while it is fully closed, the one secret the owner has to set, and how to test delivery. Browser push is separate and needs only the `VAPID_*` secrets listed in [operations.md](operations.md#secrets).

## What is wired in the repository

| Part | Where |
| --- | --- |
| Push client configuration | `frontend/native-android/google-services.json`. `frontend/scripts/patch-android.js` copies it into the generated `android/app/` on every build; the Android build applies the matching Gradle plugin when the file is present, so no manual Gradle edits are needed. |
| App side | `frontend/src/services/push/nativePush.ts` registers the device on launch, posts the token to `/api/push/fcm-register` and routes notification taps into the app. Native builds only. |
| Server side | `backend/worker/functions/api/push/fcm-register.ts` stores tokens in the `vinax_fcm_tokens` table. `backend/worker/functions/_lib/fcm.ts` signs and sends messages. The console's "send push" fans out to stored tokens. |
| Dependency | `@capacitor/push-notifications` |
| Package | **Build Android APK** includes the configuration file in every build. |

The key inside `google-services.json` ships inside every package and is therefore public. It is safe only while the restrictions in `frontend/native-android/README.md` are applied to it (package name plus signing certificate, and only the push-related APIs).

The token store is anonymous: it holds the opaque push token and nothing about the listener.

## The one remaining step

The Worker needs the push project's **service-account private key** to sign send requests. It is a secret, so the owner sets it; it is never committed.

1. In the push provider's console for the project named in `google-services.json`, open Project settings → Service accounts and generate a new private key. A JSON file downloads.
2. Set the whole file as the Worker secret `FCM_SERVICE_ACCOUNT`:

   ```sh
   cd backend
   npx wrangler secret put FCM_SERVICE_ACCOUNT --config worker/wrangler.toml
   ```

   Paste the entire JSON when prompted. No app rebuild is needed.

Until the secret is set the push path does nothing: the app runs normally and tokens are stored, but no message is sent (`fcmConfigured()` in `_lib/fcm.ts`).

## Test delivery

1. Install the newest package from the repository's releases and open it once. Grant the notification permission.
2. Swipe the app fully closed.
3. In the owner console's Notifications section, send a push. It should arrive, and tapping it should open the app at the target.

A device is required; see [android.md](android.md#what-cannot-be-verified-without-a-device).
