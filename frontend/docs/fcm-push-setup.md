# Native Android background push (FCM) — setup & status

Notifications reach the Android app **even when it is fully closed** (not just while
open) via Firebase Cloud Messaging. This tracks what's wired and the one step left.

## Done — wired in the repo
- **Firebase project** `apptarangmusic`, Android app `app.tarang.music`.
- **`google-services.json`** committed at `native-android/google-services.json`;
  `scripts/patch-android.js` copies it into the generated `android/app/` on every
  build. Capacitor 8 then applies the `com.google.gms.google-services` Gradle plugin
  automatically (its `app/build.gradle` runs `if (servicesJSON.text) apply plugin …`),
  and ships the root classpath — so no manual Gradle edits are needed. (This file is
  client config; the API key is restricted to the app's package + signing cert, and
  Firebase treats it as safe to commit.)
- **`vinax_fcm_tokens`** table created in Supabase (RLS on; server-only via the service role).
- **Client**: `src/services/push/nativePush.ts` registers the device with FCM on launch,
  POSTs the token to `/api/push/fcm-register`, and routes notification taps into the app.
  Wired into `AnnouncementBridge` (native only).
- **Server**: `functions/api/push/fcm-register.ts` stores tokens; `functions/_lib/fcm.ts`
  sends FCM HTTP v1 (OAuth2 via Web Crypto); admin "send push" fans out to FCM tokens.
- **Dependency**: `@capacitor/push-notifications@8`.
- **APK**: the *Build Android APK* CI workflow rebuilds and publishes a GitHub Release
  (`vinax.apk`) on every push to `main`, now including `google-services.json`.

## Remaining — one step, yours
The server needs the Firebase **service-account private key** to sign FCM requests. That
key is a secret, so it must be set by you (never committed, never entered by an agent):

1. Firebase → **Project settings → Service accounts → Generate new private key** (downloads a JSON).
2. Cloudflare → **Pages → your project → Settings → Environment variables (Production)** →
   add **`FCM_SERVICE_ACCOUNT`** = the entire contents of that JSON → mark **Encrypt** →
   **Save** → redeploy (or wait for the next deploy).

Then install the latest **`vinax.apk`** from GitHub Releases, open the app once (grant the
notification permission), swipe it fully closed, and send a push from the admin
Notifications tab — it should arrive.

## Notes
- Until `FCM_SERVICE_ACCOUNT` is set, the push path is a no-op: the app runs normally and
  tokens are stored, but nothing is sent. Setting the secret flips it on — no app rebuild needed.
- iOS would additionally need an APNs key in Firebase — not relevant for the Android-only app.
- The token store is anonymous (opaque FCM token only), consistent with the no-login,
  privacy-first design.
