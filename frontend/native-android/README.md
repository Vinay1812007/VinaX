# native-android

Files copied into the generated `android/` project by `scripts/patch-android.js`:

- `VinaxMediaPlugin.java` — Capacitor bridge for the media session
- `VinaxMediaService.java` — foreground service driving playback + lockscreen controls
- `google-services.json` — Firebase config for FCM background push

## SECURITY: `google-services.json` API key restrictions (audit finding M-OPS-8)

The Firebase Android API key committed at `native-android/google-services.json`
is embedded in every published APK and is therefore world-readable. It is only
safe when **API key restrictions are applied in Google Cloud Console**. Without
them the key behaves as a live secret and can be used from any client to
enumerate / consume the underlying Firebase project's quota.

Required restrictions on the key `AIzaSyC6xqXsb-jeBX6EPIr1-JXrLEUg3CpLPJo`
(project `apptarangmusic`, project number `296694772987`):

1. **Application restrictions → Android apps**: allow only the package
   `app.tarang.music` bound to the SHA-1 fingerprint(s) of the release
   keystore (and the CI debug keystore checked into `ci/debug-keystore.b64`
   if you want debug APKs to talk to Firebase too).
2. **API restrictions → Restrict key**: allow only the specific Firebase /
   Google APIs this app actually uses (Firebase Installations API, FCM
   Registration API, Firebase Cloud Messaging API). Nothing else.

Verify at: <https://console.cloud.google.com/apis/credentials?project=apptarangmusic>

Do NOT rotate this key without also republishing an APK containing the new
`google-services.json`; existing installs will lose push registration until
they update.
