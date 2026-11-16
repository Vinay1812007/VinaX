/**
 * scripts/patch-android.js run for real against a stand-in of the project
 * `npx cap add android` makes: the disco lights plugin (flashlight, full
 * brightness, system bars) must land in the app's Java sources with the
 * app's package and be registered in MainActivity before super.onCreate.
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
  dir = mkdtempSync(join(tmpdir(), 'vinax-patch-disco-'));
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

describe('patch-android.js: the disco lights plugin', () => {
  it('copies DiscoPlugin.java into the app package as the VinaxDisco plugin', () => {
    const java = readFileSync(join(dir, PKG_DIR, 'DiscoPlugin.java'), 'utf8');
    expect(java.startsWith('package app.Vinax.music;')).toBe(true);
    expect(java).toContain('@CapacitorPlugin(name = "VinaxDisco")');
    for (const m of ['public void torchAvailable(PluginCall call)', 'public void torch(PluginCall call)', 'public void brightness(PluginCall call)', 'public void bars(PluginCall call)']) expect(java).toContain(m);
    expect(java).toContain('setTorchMode(');
    expect(java).toContain('BRIGHTNESS_OVERRIDE_NONE');
    // The flashlight goes off in the background and everything is put back when the bridge dies.
    expect(java).toContain('protected void handleOnPause()');
    expect(java).toContain('protected void handleOnDestroy()');
  });

  it('registers it in MainActivity before super.onCreate', () => {
    const main = readFileSync(join(dir, PKG_DIR, 'MainActivity.java'), 'utf8');
    const reg = main.indexOf('registerPlugin(DiscoPlugin.class);');
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(main.indexOf('super.onCreate(savedInstanceState);'));
  });

  it('declares the flash as optional, so phones without one still install', () => {
    const manifest = readFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('<uses-feature android:name="android.hardware.camera.flash" android:required="false" />');
  });
});
