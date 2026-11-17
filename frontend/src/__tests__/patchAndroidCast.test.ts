/**
 * scripts/patch-android.js run for real (twice, as after every sync) against
 * a stand-in of the project `npx cap add android` makes: Google Cast must
 * land in the app — the VinaxCast plugin and its options provider in the
 * app's package, registered in MainActivity, the provider named in the
 * manifest, the Cast framework in the app module — exactly once. The Java
 * itself is compiled by CI only, so its contract with the page is pinned here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const frontend = resolve(__dirname, '../..');
const PKG_DIR = 'android/app/src/main/java/app/Vinax/music';
let dir = '';

const read = (rel: string): string => readFileSync(join(dir, rel), 'utf8');
const count = (s: string, part: string): number => s.split(part).length - 1;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vinax-patch-cast-'));
  cpSync(join(frontend, 'native-android'), join(dir, 'native-android'), { recursive: true });
  mkdirSync(join(dir, PKG_DIR), { recursive: true });
  mkdirSync(join(dir, 'android/app/src/main/res'), { recursive: true });
  writeFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n    </application>\n</manifest>\n');
  writeFileSync(join(dir, 'android/app/build.gradle'), 'android {\n    buildTypes {\n    }\n}\ndependencies {\n}\n');
  const run = () => execFileSync(process.execPath, [join(frontend, 'scripts/patch-android.js')], { cwd: dir, stdio: 'pipe' });
  run();
  run();
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('patch-android.js: Google Cast', () => {
  it('copies the plugin into the app package as VinaxCast, with every method and event the page uses', () => {
    const java = read(`${PKG_DIR}/VinaxCastPlugin.java`);
    expect(java.startsWith('package app.Vinax.music;')).toBe(true);
    expect(java).toContain('@CapacitorPlugin(name = "VinaxCast")');
    for (const m of ['init', 'showDevicePicker', 'loadMedia', 'play', 'pause', 'seek', 'setVolume', 'endSession']) {
      expect(java).toContain(`public void ${m}(PluginCall call)`);
    }
    for (const e of ['"availability"', '"session"', '"status"']) expect(java).toContain(`notifyListeners(${e}`);
    // services/cast/native.ts reads these fields.
    for (const k of ['"devices"', '"connected"', '"deviceName"', '"state"', '"position"', '"duration"', '"url"']) expect(java).toContain(k);
    // The receiver gets a music track built from the page's fields.
    expect(java).toContain('MediaMetadata.MEDIA_TYPE_MUSIC_TRACK');
    expect(java).toContain('new MediaLoadRequestData.Builder()');
    for (const k of ['"url"', '"contentType"', '"title"', '"artist"', '"image"', '"startTime"', '"autoplay"']) expect(java).toMatch(new RegExp(`call\\.get(String|Double|Boolean)\\(${k}`));
  });

  it('never loads Cast at app start, and a phone without Google Play services just has no Cast', () => {
    const java = read(`${PKG_DIR}/VinaxCastPlugin.java`);
    expect(java).not.toContain('public void load()');
    expect(java).toContain('isGooglePlayServicesAvailable');
    expect(java).toContain('CastContext.getSharedInstance(getContext(), loader)');
    expect(java).not.toMatch(/getSharedInstance\(getContext\(\)\)/);
  });

  it('uses the same receiver as the website and leaves the playback notification to VinaxMediaService', () => {
    const java = read(`${PKG_DIR}/VinaxCastOptionsProvider.java`);
    expect(java.startsWith('package app.Vinax.music;')).toBe(true);
    expect(java).toContain('implements OptionsProvider');
    expect(java).toContain('CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID');
    expect(java).toContain('.setNotificationOptions(null)');
    expect(java).toContain('.setMediaSessionEnabled(false)');
    const web = readFileSync(join(frontend, 'src/services/cast/web.ts'), 'utf8');
    expect(web).toContain('DEFAULT_MEDIA_RECEIVER_APP_ID');
  });

  it('registers the plugin in MainActivity before super.onCreate', () => {
    const main = read(`${PKG_DIR}/MainActivity.java`);
    const reg = main.indexOf('registerPlugin(VinaxCastPlugin.class);');
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(main.indexOf('super.onCreate(savedInstanceState);'));
    expect(main).toContain('extends BridgeActivity'); // AppCompat: the device list is an AppCompat dialog
  });

  it('names the options provider in the manifest once, with its full class name', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(count(manifest, 'com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME')).toBe(1);
    expect(manifest).toContain('android:value="app.Vinax.music.VinaxCastOptionsProvider"');
    expect(count(manifest, 'Google Cast settings')).toBe(1);
  });

  it('adds the Cast framework (a pinned release) to the app module once', () => {
    const gradle = read('android/app/build.gradle');
    expect(count(gradle, 'com.google.android.gms:play-services-cast-framework:')).toBe(1);
    expect(gradle).toMatch(/implementation "com\.google\.android\.gms:play-services-cast-framework:\d+\.\d+\.\d+"/);
  });
});
