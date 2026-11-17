import fs from 'fs';
import path from 'path';

const PKG = 'app.Vinax.music';
const PKG_PATH = PKG.replace(/\./g, '/');

const root = process.cwd();
const androidRoot = path.join(root, 'android');
const appRoot = path.join(androidRoot, 'app');
const javaRoot = path.join(appRoot, 'src/main/java', PKG_PATH);
const resRoot = path.join(appRoot, 'src/main/res');
const manifestPath = path.join(appRoot, 'src/main/AndroidManifest.xml');
const buildGradlePath = path.join(appRoot, 'build.gradle');

console.log('--- VinaX Android Patch ---');

// 1. Copy native files
const nativeSrc = path.join(root, 'native-android');
if (fs.existsSync(nativeSrc)) {
  const files = fs.readdirSync(nativeSrc);
  for (const file of files) {
    if (file.endsWith('.java')) {
      let content = fs.readFileSync(path.join(nativeSrc, file), 'utf8');
      content = content.replace(/package __PKG__;/, `package ${PKG};`);
      fs.writeFileSync(path.join(javaRoot, file), content);
      console.log(`[native] Copied and patched ${file}`);
    }
  }
} else {
  console.warn('[native] native-android directory not found');
}

// 1b-res. Widget resources: copy native-android/res/** (layout, drawable,
// xml, values) into the app's res tree so the widgets' RemoteViews, the
// provider-info files and the playback notification's icons and strings
// compile with the project. Only files are copied (one level deep); every
// VinaX file is prefixed `vinax_` so it never collides with the template's.
const nativeRes = path.join(root, 'native-android', 'res');
if (fs.existsSync(nativeRes)) {
  for (const dir of fs.readdirSync(nativeRes)) {
    const srcDir = path.join(nativeRes, dir);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const dstDir = path.join(resRoot, dir);
    fs.mkdirSync(dstDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
      console.log(`[res] Copied ${dir}/${f}`);
    }
  }
}

// 1c. Google Services config for FCM background push. Capacitor 8 already applies
// the google-services Gradle plugin when this file is present, so dropping it in
// is all that's needed. Copied only when committed, so builds without it are
// completely unaffected.
const gservicesSrc = path.join(root, 'native-android', 'google-services.json');
if (fs.existsSync(gservicesSrc)) {
  fs.copyFileSync(gservicesSrc, path.join(appRoot, 'google-services.json'));
  console.log('[fcm] Copied google-services.json into app/');
}

// 1b. Register the native plugins with Capacitor. App-bundled (local) plugins
// are NOT auto-discovered, so without this MainActivity registration
// Capacitor.isPluginAvailable('VinaxMedia') is false and the playback
// notification / lockscreen bridge never connects. The same goes for
// 'VinaxAudioRoute' (AudioRoutePlugin.java: Live voice's loudspeaker /
// earpiece switch); the page hides that button when it is missing.
if (fs.existsSync(javaRoot)) {
  const mainActivity = `package ${PKG};

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    /** The longest shared text passed on (the page reads at most 100 lines). */
    private static final int SHARE_MAX = 8000;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the bridge reads the launch link from this intent.
        shareAsLink(getIntent());
        registerPlugin(VinaxMediaPlugin.class);
        // VinaX AI Live voice: loudspeaker / earpiece (native-android/AudioRoutePlugin.java).
        registerPlugin(AudioRoutePlugin.class);
        // 1.12 — push done natively (native-android/VinaxPushService.java): the
        // phone registers its token itself; the page links it to the account.
        registerPlugin(VinaxPushPlugin.class);
        // 1.16 — disco lights: the flashlight on the beat, full brightness and
        // no system bars while the lights are open (native-android/DiscoPlugin.java).
        registerPlugin(DiscoPlugin.class);
        // 1.16 — Google Cast from the app (native-android/VinaxCastPlugin.java).
        // Registering touches no Cast class: the framework loads only when the
        // page asks, and a phone without Google Play services just has no Cast.
        registerPlugin(VinaxCastPlugin.class);
        super.onCreate(savedInstanceState);
        allowSignInCheck();
        maybeOpenPlayer(getIntent());
        maybeOpenPushLink(getIntent());
    }

    /**
     * Cloudflare's sign-in security check (Turnstile) runs in an iframe from
     * challenges.cloudflare.com, which Android's WebView treats as a third
     * party. Two WebView defaults made it fail every time in the app:
     *  - third-party cookies are off (Capacitor never turns them on), so the
     *    check's own cookies were dropped;
     *  - Capacitor hands every navigation Android asks about, iframe ones
     *    included, to launchIntent, which sends any host other than ours (and
     *    about:blank / about:srcdoc, which the check uses) to an outside app
     *    and blocks it in the page.
     * So: accept third-party cookies, and let iframes navigate in place. Only
     * the top-level page still goes through Capacitor's usual rule. (Not
     * server.allowNavigation: that would also give Cloudflare's frames the
     * native bridge.)
     */
    private void allowSignInCheck() {
        try {
            final Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null) return;
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setAcceptThirdPartyCookies(bridge.getWebView(), true);
            bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (!request.isForMainFrame()) return false;
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        // Before super: the App plugin hands the page VIEW links only.
        shareAsLink(intent);
        super.onNewIntent(intent);
        // Warm start: the activity already exists (launchMode singleTask), so
        // a notification tap lands here instead of onCreate.
        maybeOpenPlayer(intent);
        maybeOpenPushLink(intent);
    }

    /**
     * Share to VinaX: text another app shares here (ACTION_SEND, text/plain)
     * becomes the in-app link /share?text=...&title=... and then goes the
     * way a VinaX link goes. @capacitor/app passes only VIEW intents to the
     * page (appUrlOpen, or getLaunchUrl on a cold start), never a SEND's
     * EXTRA_TEXT, so the intent is turned into that VIEW link in place.
     */
    private static void shareAsLink(Intent intent) {
        try {
            if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
            final CharSequence extra = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (extra == null) return;
            String text = extra.toString().trim();
            if (text.isEmpty()) return;
            if (text.length() > SHARE_MAX) {
                int end = SHARE_MAX;
                if (Character.isHighSurrogate(text.charAt(end - 1))) end -= 1;
                text = text.substring(0, end);
            }
            final StringBuilder link = new StringBuilder("https://www.vinaxmusic.online/share?text=").append(Uri.encode(text));
            final CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            if (subject != null) {
                final String title = subject.toString().trim();
                if (!title.isEmpty() && title.length() <= 200) link.append("&title=").append(Uri.encode(title));
            }
            intent.setAction(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(link.toString()));
        } catch (Exception ignored) {
        }
    }

    /** A tap on a push VinaxPushService drew: open its link inside the app. */
    private void maybeOpenPushLink(Intent intent) {
        try {
            if (intent == null) return;
            final String link = intent.getStringExtra("vinax_link");
            if (link == null || !link.startsWith("/") || link.startsWith("//")) return;
            intent.removeExtra("vinax_link");
            final Bridge bridge = getBridge();
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().post(() -> bridge.getWebView().loadUrl("https://www.vinaxmusic.online" + link));
        } catch (Exception ignored) {
        }
    }

    /** Playback-notification body tap (4.16.1): the launch intent carries
     *  EXTRA_OPEN_PLAYER — relay to JS so the app opens the full-screen
     *  player instead of wherever it was left. */
    private void maybeOpenPlayer(Intent intent) {
        try {
            if (intent != null && intent.getBooleanExtra(VinaxMediaService.EXTRA_OPEN_PLAYER, false)) {
                intent.removeExtra(VinaxMediaService.EXTRA_OPEN_PLAYER);
                VinaxMediaPlugin.openPlayerRequested();
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        keepWebViewAlive();
    }

    @Override
    public void onStop() {
        super.onStop();
        // onStop is where the activity is no longer visible at all (home
        // button, another app on top); re-assert here as well because some
        // vendor skins pause the WebView between onPause and onStop.
        keepWebViewAlive();
    }

    /**
     * Keep the WebView's JS + audio element alive while the app is in the
     * background so the notification, lock-screen and widget controls
     * (play / pause / next) act without reopening the app. Without this the
     * WebView's timers freeze and a "play" tap is only processed once the
     * app returns to the foreground. WebView.onResume() and resumeTimers()
     * are idempotent, so calling them again here and in the base class's
     * onResume (Capacitor's keepRunning default) cannot double-resume.
     * There is no onResume override on purpose.
     */
    private void keepWebViewAlive() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
            }
        } catch (Exception ignored) {
        }
    }
}
`;
  fs.writeFileSync(path.join(javaRoot, 'MainActivity.java'), mainActivity);
  console.log('[native] Wrote MainActivity.java registering VinaxMediaPlugin, AudioRoutePlugin, VinaxPushPlugin, DiscoPlugin and VinaxCastPlugin, with the sign-in check allowed');
} else {
  console.error('[native] java root missing — cannot register plugin');
}

// 2. Patch Manifest
if (fs.existsSync(manifestPath)) {
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  
  const permissions = [
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />',
    '<uses-permission android:name="android.permission.WAKE_LOCK" />',
    '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    // Voice chat / dictation / voice search (v3.3.0): the speech-recognition
    // plugin's own manifest also declares RECORD_AUDIO — this is belt and
    // braces so a plugin manifest change can never silently drop the mic.
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    // VinaX AI voice (phase 6): dictation and Live voice open the mic from the
    // page (getUserMedia). Capacitor's WebView asks for RECORD_AUDIO AND
    // MODIFY_AUDIO_SETTINGS together and refuses the page if either is not
    // declared, so this one is required for the page's mic to work at all.
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    // 1.13 — Listen Together "Scan the host's QR": the page opens the camera
    // (getUserMedia) only while the scanner sheet is up. Capacitor's WebView
    // refuses the page's request unless CAMERA is declared here; Android
    // still asks the listener the first time. The <uses-feature> lines keep
    // phones and tablets without a camera able to install the app.
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
    '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
    // 1.16 — disco lights' flashlight (DiscoPlugin.java); optional, so phones without one still install.
    '<uses-feature android:name="android.hardware.camera.flash" android:required="false" />'
  ];
  // REQUEST_INSTALL_PACKAGES is restricted by Google Play policy (only
  // installer / updater apps qualify) and would cause a Play Store listing
  // to be rejected. It's only needed for the sideload-only auto-update
  // flow. Gate on env — CI sets VINAX_PLAY_STORE_BUILD=1 for Play Console
  // uploads and leaves it unset for the sideload APK we publish on GitHub
  // Releases (audit finding H20).
  if (process.env.VINAX_PLAY_STORE_BUILD !== '1') {
    permissions.push('<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />');
  }

  for (const p of permissions) {
    if (!manifest.includes(p)) {
      manifest = manifest.replace('</manifest>', `    ${p}\n</manifest>`);
    }
  }

  // 13.7.3 — FCM's defaults for a push the system draws while the app is in
  // the background or closed: the white V (a full-colour launcher icon draws
  // as a blob), the VinaX accent, and the app's own high-importance channel
  // (created by services/push/nativePush.ts) instead of "Miscellaneous".
  const service = `
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/vinax_ic_notify" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/vinax_notify" />
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="vinax_picks" />

        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />

        <!-- 1.16: Google Cast settings (VinaxCastOptionsProvider.java). -->
        <meta-data
            android:name="com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"
            android:value="${PKG}.VinaxCastOptionsProvider" />

        <receiver android:name="androidx.media.session.MediaButtonReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </receiver>

        <!-- 1.12: push done natively (VinaxPushService.java). The higher
             priority makes Android hand MESSAGING_EVENT to this service
             rather than the Capacitor plugin's, so tokens are uploaded and
             pushes drawn with the VinaX mark without the page. -->
        <service
            android:name=".VinaxPushService"
            android:exported="false">
            <intent-filter android:priority="1">
                <action android:name="com.google.firebase.MESSAGING_EVENT" />
            </intent-filter>
        </service>

        <service
            android:name=".VinaxMediaService"
            android:enabled="true"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="android.media.browse.MediaBrowserService" />
            </intent-filter>
        </service>

        <receiver
            android:name=".VinaxQuickPlayWidget"
            android:label="@string/vinax_widget_quickplay_label"
            android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/vinax_widget_info" />
        </receiver>

        <receiver
            android:name=".VinaxPlayerWidget"
            android:label="@string/vinax_widget_player_label"
            android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/vinax_player_widget_info" />
        </receiver>
`;

  // 1.13 — website → app. VinaX links (an invite's "Open in the VinaX app"
  // button, which names this package) open in the app: MainActivity takes
  // https links to the site. The page reads the link through @capacitor/app
  // (AppLayout: appUrlOpen and getLaunchUrl) and shows that page.
  //
  // Round 8 — verified App Links: the www filter is autoVerify, checked
  // against https://www.vinaxmusic.online/.well-known/assetlinks.json (the
  // release key's SHA-256, public/.well-known/assetlinks.json), so a shared
  // song, playlist or invite opens straight in the app with no chooser.
  // Only www is verified: the apex answers every path, assetlinks.json
  // included, with a redirect to www (Cloudflare Redirect Rule "Apex to
  // www"), and Android refuses a redirected assetlinks.json. The apex keeps a
  // filter of its own WITHOUT autoVerify, so it can still be opened in the
  // app by hand. (Android 12 and later verify each host on its own; Android
  // 11 and older verify all hosts or none, so there the apex keeps the old
  // chooser behaviour until /.well-known/ on the apex is exempted from that
  // rule.) Only the pages people share open the app (APP_LINK_PATHS); Home,
  // sign-in, Get the app and the rest stay in the browser.
  //
  // Share to VinaX (round 8): the SEND filter puts VinaX in the system share
  // sheet for text; MainActivity.shareAsLink turns it into /share?text=.
  const APP_LINK_PATHS = ['/song/', '/album/', '/artist/', '/playlist/', '/video/', '/podcast/', '/lyrics/', '/p/', '/u/', '/together', '/vinaxai/share/'];
  const linkData = (host) => [
    '                <data android:scheme="https" />',
    `                <data android:host="${host}" />`,
    ...APP_LINK_PATHS.map((p) => `                <data android:pathPrefix="${p}" />`),
  ].join('\n');
  const linkFilter = `
            <!-- vinax-links -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${linkData('www.vinaxmusic.online')}
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${linkData('vinaxmusic.online')}
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <!-- /vinax-links -->`;
  // Idempotent: take out what an earlier run injected (this block, or the
  // 1.13 single filter that had no end marker) before adding it again.
  manifest = manifest.replace(/\n[ \t]*<!-- vinax-links -->[\s\S]*?<!-- \/vinax-links -->/g, '');
  manifest = manifest.replace(/\n\n?[ \t]*<!-- vinax-links -->\s*<intent-filter>[\s\S]*?<\/intent-filter>\n/g, '');
  // After the launcher filter, which only MainActivity has.
  const launcher = /(<category android:name="android\.intent\.category\.LAUNCHER"\s*\/>\s*<\/intent-filter>)/;
  if (launcher.test(manifest)) {
    manifest = manifest.replace(launcher, `$1${linkFilter}`);
    console.log('[manifest] MainActivity opens VinaX links (verified on www) and takes shared text');
  } else {
    console.warn('[manifest] launcher intent-filter not found — VinaX links and Share to VinaX will not open the app');
  }

  // WARNING (audit finding M-OPS-9): these regexes are fragile — they assume
  // the current Capacitor 8 manifest formatting (attribute order, whitespace,
  // no wrapping <application> comments). Any upstream template change can
  // silently make a replace be a no-op, which used to corrupt the manifest.
  // We now assert the </application> insertion actually happened and fail
  // loudly if it didn't, instead of writing back an unchanged file that then
  // ships without the media service.

  // Remove old service definition if it exists
  const oldServiceRegex = /<service[^>]*android:name="\.VinaxMediaService"[^>]*>.*?<\/service>|<service[^>]*android:name="\.VinaxMediaService"[^>]*\/>/gs;
  manifest = manifest.replace(/<!-- 1\.12: push done natively[\s\S]*?<\/service>\s*/g, '');
  manifest = manifest.replace(/<service[^>]*android:name="\.VinaxPushService"[^>]*>[\s\S]*?<\/service>\s*/g, '');
  manifest = manifest.replace(oldServiceRegex, '');

  // Remove old meta-data if it exists
  const oldMetaRegex = /<meta-data[^>]*android:name="com\.google\.android\.gms\.car\.application"[^>]*\/>/gs;
  manifest = manifest.replace(oldMetaRegex, '');
  const oldFcmMetaRegex = /<meta-data[^>]*android:name="com\.google\.firebase\.messaging\.default_notification_(?:icon|color|channel_id)"[^>]*\/>/gs;
  manifest = manifest.replace(oldFcmMetaRegex, '');
  manifest = manifest.replace(/<!-- 1\.16: Google Cast settings[^>]*-->\s*/g, '');
  manifest = manifest.replace(/<meta-data[^>]*android:name="com\.google\.android\.gms\.cast\.framework\.OPTIONS_PROVIDER_CLASS_NAME"[^>]*\/>/gs, '');

  const oldReceiverRegex = /<receiver[^>]*android:name="androidx\.media\.session\.MediaButtonReceiver"[^>]*>.*?<\/receiver>/gs;
  manifest = manifest.replace(oldReceiverRegex, '');

  // Remove a previously injected widget receiver so re-runs stay idempotent.
  const oldWidgetRegex = /<receiver[^>]*android:name="\.VinaxQuickPlayWidget"[^>]*>.*?<\/receiver>/gs;
  manifest = manifest.replace(oldWidgetRegex, '');
  const oldPlayerWidgetRegex = /<receiver[^>]*android:name="\.VinaxPlayerWidget"[^>]*>.*?<\/receiver>/gs;
  manifest = manifest.replace(oldPlayerWidgetRegex, '');

  if (!manifest.includes('VinaxMediaService')) {
    const before = manifest;
    manifest = manifest.replace('</application>', `${service}    </application>`);
    if (manifest === before) {
      console.error('[manifest] FATAL: could not locate </application> closing tag to inject VinaxMediaService.');
      console.error('[manifest] The manifest regex is fragile (M-OPS-9); this usually means the Capacitor template changed.');
      console.error('[manifest] Refusing to write an unpatched manifest — fix the regex above and retry.');
      process.exit(1);
    }
  }

  fs.writeFileSync(manifestPath, manifest);
  console.log('[manifest] Patched AndroidManifest.xml');
} else {
  console.error('[manifest] AndroidManifest.xml not found');
}

// 3. Patch build.gradle — androidx.media, Firebase Messaging and Google Cast dependencies + stable signing config.
if (fs.existsSync(buildGradlePath)) {
  let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
  let changed = false;

  if (!buildGradle.includes('androidx.media:media')) {
    buildGradle = buildGradle.replace('dependencies {', 'dependencies {\n    implementation "androidx.media:media:1.7.0"');
    changed = true;
    console.log('[gradle] Added androidx.media dependency to build.gradle');
  }
  // 1.12 — VinaxPushService / VinaxPushPlugin use Firebase Messaging directly
  // (the same version the Capacitor push plugin pins, so one copy is resolved).
  if (!buildGradle.includes('com.google.firebase:firebase-messaging')) {
    buildGradle = buildGradle.replace('dependencies {', 'dependencies {\n    implementation "com.google.firebase:firebase-messaging:25.0.1"');
    changed = true;
    console.log('[gradle] Added firebase-messaging dependency to build.gradle');
  }
  // 1.16 — Google Cast (VinaxCastPlugin / VinaxCastOptionsProvider). Brings
  // androidx.mediarouter (the device list) with it. 22.3.1 needs minSdk 23.
  if (!buildGradle.includes('com.google.android.gms:play-services-cast-framework')) {
    buildGradle = buildGradle.replace('dependencies {', 'dependencies {\n    implementation "com.google.android.gms:play-services-cast-framework:22.3.1"');
    changed = true;
    console.log('[gradle] Added play-services-cast-framework dependency to build.gradle');
  }

  // Sign every DEBUG build with one committed keystore. The default debug
  // keystore is regenerated per machine/CI run, so each build had a different
  // signature ("App not installed as package conflicts with an existing
  // package"). Defining the debug signingConfig explicitly removes all
  // reliance on Gradle's default debug-keystore location.
  //
  // WARNING: this keystore is public (checked into ci/debug-keystore.b64).
  // It must never be injected into the RELEASE build type — anyone could
  // then produce update-compatible APKs and impersonate an update (audit
  // finding H19). Release APKs get their signing config from
  // android.injected.signing.* Gradle properties passed by CI when the
  // ANDROID_KEYSTORE_BASE64 secret is set. If those props are missing,
  // assembleRelease will fail loudly instead of shipping debug-signed.
  const keystoreB64 = path.join(root, 'ci', 'debug-keystore.b64');
  if (fs.existsSync(keystoreB64) && !buildGradle.includes('signingConfigs')) {
    fs.writeFileSync(
      path.join(appRoot, 'vinax.keystore'),
      Buffer.from(fs.readFileSync(keystoreB64, 'utf8'), 'base64'),
    );
    buildGradle = buildGradle.replace(/android\s*\{/, `android {
    signingConfigs {
        vinax {
            storeFile file('vinax.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`);
    buildGradle = buildGradle.replace(/buildTypes\s*\{/, `buildTypes {
        debug {
            signingConfig signingConfigs.vinax
        }`);
    // NB: intentionally leave `release {}` untouched — see WARNING above.
    changed = true;
    console.log('[signing] Wrote app/vinax.keystore and signed debug with it (release left to CI-injected keystore)');
  }

  if (changed) fs.writeFileSync(buildGradlePath, buildGradle);
} else {
  console.error('[gradle] build.gradle not found');
}

// 4. Copy resources
const resSrc = path.join(root, 'android-res');
if (fs.existsSync(resSrc)) {
    const copyRecursive = (src, dest) => {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
            const s = path.join(src, file);
            const d = path.join(dest, file);
            if (fs.lstatSync(s).isDirectory()) {
                copyRecursive(s, d);
            } else {
                fs.copyFileSync(s, d);
            }
        }
    };
    copyRecursive(resSrc, resRoot);
    console.log('[res] Copied resources from android-res');
} else {
  console.warn('[res] android-res directory not found');
}

console.log('--- Patch Complete ---');
