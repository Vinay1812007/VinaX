/**
 * scripts/patch-android.js: the app's MainActivity must let Cloudflare's
 * sign-in check (Turnstile) work in Android's WebView. Without third-party
 * cookies, and with Capacitor sending every iframe navigation (other hosts,
 * about:blank, about:srcdoc) to an outside app, the check failed every time.
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
  dir = mkdtempSync(join(tmpdir(), 'vinax-patch-ts-'));
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

describe('patch-android.js: the sign-in security check in the app', () => {
  it('turns on third-party cookies and keeps iframe navigations in the page, after the bridge exists', () => {
    const main = readFileSync(join(dir, PKG_DIR, 'MainActivity.java'), 'utf8');
    expect(main).toContain('import android.webkit.CookieManager;');
    expect(main).toContain('setAcceptThirdPartyCookies(bridge.getWebView(), true)');
    expect(main).toContain('bridge.setWebViewClient(new BridgeWebViewClient(bridge)');
    expect(main).toMatch(/if \(!request\.isForMainFrame\(\)\) return false;\s*return super\.shouldOverrideUrlLoading\(view, request\);/);
    // After super.onCreate: the bridge and its WebView are made there.
    expect(main.indexOf('super.onCreate(savedInstanceState);')).toBeLessThan(main.indexOf('allowSignInCheck();'));
    // Not server.allowNavigation, which would hand Cloudflare's frames the native bridge.
    expect(readFileSync(join(frontend, 'capacitor.config.ts'), 'utf8')).not.toContain('allowNavigation');
  });
});
