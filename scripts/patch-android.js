import fs from 'fs';
import path from 'path';

const PKG = 'app.tarang.music';
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

// 1c. Google Services config for FCM background push. Capacitor 8 already applies
// the google-services Gradle plugin when this file is present, so dropping it in
// is all that's needed. Copied only when committed, so builds without it are
// completely unaffected.
const gservicesSrc = path.join(root, 'native-android', 'google-services.json');
if (fs.existsSync(gservicesSrc)) {
  fs.copyFileSync(gservicesSrc, path.join(appRoot, 'google-services.json'));
  console.log('[fcm] Copied google-services.json into app/');
}

// 1b. Register the native plugin with Capacitor. App-bundled (local) plugins
// are NOT auto-discovered, so without this MainActivity registration
// Capacitor.isPluginAvailable('VinaxMedia') is false and the playback
// notification / lockscreen bridge never connects.
if (fs.existsSync(javaRoot)) {
  const mainActivity = `package ${PKG};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VinaxMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep the WebView's JS + <audio> alive while backgrounded so the
        // notification media controls (play/pause/next) work without reopening
        // the app. Without this the WebView freezes and a "play" tap is only
        // processed once the app returns to the foreground.
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
  console.log('[native] Wrote MainActivity.java registering VinaxMediaPlugin');
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
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />'
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

  const service = `
        <meta-data
            android:name="com.google.android.gms.car.application"
            android:resource="@xml/automotive_app_desc" />

        <receiver android:name="androidx.media.session.MediaButtonReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MEDIA_BUTTON" />
            </intent-filter>
        </receiver>

        <service
            android:name=".VinaxMediaService"
            android:enabled="true"
            android:exported="true"
            android:foregroundServiceType="mediaPlayback">
            <intent-filter>
                <action android:name="android.media.browse.MediaBrowserService" />
            </intent-filter>
        </service>
`;

  // WARNING (audit finding M-OPS-9): these regexes are fragile — they assume
  // the current Capacitor 8 manifest formatting (attribute order, whitespace,
  // no wrapping <application> comments). Any upstream template change can
  // silently make a replace be a no-op, which used to corrupt the manifest.
  // We now assert the </application> insertion actually happened and fail
  // loudly if it didn't, instead of writing back an unchanged file that then
  // ships without the media service.

  // Remove old service definition if it exists
  const oldServiceRegex = /<service[^>]*android:name="\.VinaxMediaService"[^>]*>.*?<\/service>|<service[^>]*android:name="\.VinaxMediaService"[^>]*\/>/gs;
  manifest = manifest.replace(oldServiceRegex, '');

  // Remove old meta-data if it exists
  const oldMetaRegex = /<meta-data[^>]*android:name="com\.google\.android\.gms\.car\.application"[^>]*\/>/gs;
  manifest = manifest.replace(oldMetaRegex, '');

  const oldReceiverRegex = /<receiver[^>]*android:name="androidx\.media\.session\.MediaButtonReceiver"[^>]*>.*?<\/receiver>/gs;
  manifest = manifest.replace(oldReceiverRegex, '');

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

// 3. Patch build.gradle — androidx.media dependency + stable signing config.
if (fs.existsSync(buildGradlePath)) {
  let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
  let changed = false;

  if (!buildGradle.includes('androidx.media:media')) {
    buildGradle = buildGradle.replace('dependencies {', 'dependencies {\n    implementation "androidx.media:media:1.7.0"');
    changed = true;
    console.log('[gradle] Added androidx.media dependency to build.gradle');
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
