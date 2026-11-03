/**
 * scripts/patch-android.js run for real against a stand-in of the project
 * `npx cap add android` makes: Live voice's loudspeaker plugin must land in
 * the app's Java sources with the app's package, and MainActivity must
 * register it before super.onCreate (local plugins are not auto-discovered;
 * without it the page sees no plugin and hides the button).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const frontend = resolve(__dirname, '../..');
const PKG_DIR = 'android/app/src/main/java/app/Vinax/music';
let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'vinax-patch-'));
  cpSync(join(frontend, 'native-android'), join(dir, 'native-android'), { recursive: true });
  mkdirSync(join(dir, PKG_DIR), { recursive: true });
  mkdirSync(join(dir, 'android/app/src/main/res'), { recursive: true });
  writeFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application>\n    </application>\n</manifest>\n');
  writeFileSync(join(dir, 'android/app/build.gradle'), 'android {\n    buildTypes {\n    }\n}\ndependencies {\n}\n');
  execFileSync(process.execPath, [join(frontend, 'scripts/patch-android.js')], { cwd: dir, stdio: 'pipe' });
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('patch-android.js: Live voice’s loudspeaker plugin', () => {
  it('copies AudioRoutePlugin.java into the app package as the VinaxAudioRoute plugin', () => {
    const java = readFileSync(join(dir, PKG_DIR, 'AudioRoutePlugin.java'), 'utf8');
    expect(java.startsWith('package app.Vinax.music;')).toBe(true);
    expect(java).toContain('@CapacitorPlugin(name = "VinaxAudioRoute")');
    for (const m of ['public void start(PluginCall call)', 'public void setSpeaker(PluginCall call)', 'public void getRoute(PluginCall call)', 'public void stop(PluginCall call)']) expect(java).toContain(m);
    // API 31+ device selection, the older speakerphone switch, and a clean-up when the bridge dies.
    expect(java).toContain('setCommunicationDevice(');
    expect(java).toContain('clearCommunicationDevice()');
    expect(java).toContain('setSpeakerphoneOn(');
    expect(java).toContain('AudioManager.MODE_IN_COMMUNICATION');
    expect(java).toContain('protected void handleOnDestroy()');
  });

  it('registers it in MainActivity before super.onCreate, next to the media plugin', () => {
    const main = readFileSync(join(dir, PKG_DIR, 'MainActivity.java'), 'utf8');
    const reg = main.indexOf('registerPlugin(AudioRoutePlugin.class);');
    expect(reg).toBeGreaterThan(-1);
    expect(main.indexOf('registerPlugin(VinaxMediaPlugin.class);')).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(main.indexOf('super.onCreate(savedInstanceState);'));
  });

  it('keeps the permissions the plugin and the page’s mic need', () => {
    const manifest = readFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android.permission.MODIFY_AUDIO_SETTINGS');
    expect(manifest).toContain('android.permission.RECORD_AUDIO');
  });
});
