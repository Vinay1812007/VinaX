/**
 * scripts/patch-android.js run for real against a stand-in of the manifest
 * `npx cap add android` writes (MainActivity with its launcher filter):
 *  - verified App Links on www only (the apex redirects to www, so its
 *    assetlinks.json can never verify), limited to the pages people share;
 *  - Share to VinaX: a SEND text/plain filter, and MainActivity turning the
 *    shared text into the /share link the page already knows how to open;
 *  - all of it exactly once after a second run, and an APK patched by the
 *    1.13 script (one unverified filter) moved to the new filters.
 * The Java is compiled by CI only, so its contract with the page is pinned here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const frontend = resolve(__dirname, '../..');
const PKG_DIR = 'android/app/src/main/java/app/Vinax/music';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const dirs: string[] = [];

const capManifest = (extra = ''): string => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity
            android:name=".MainActivity"
            android:launchMode="singleTask"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
${extra}
        </activity>
    </application>
</manifest>
`;

/** The 1.13 script's filter, as an APK project patched before round 8 holds it. */
const OLD_FILTER = `
            <!-- vinax-links -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" />
                <data android:host="www.vinaxmusic.online" />
                <data android:host="vinaxmusic.online" />
            </intent-filter>
`;

function project(manifest: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vinax-patch-links-'));
  dirs.push(dir);
  cpSync(join(frontend, 'native-android'), join(dir, 'native-android'), { recursive: true });
  mkdirSync(join(dir, PKG_DIR), { recursive: true });
  mkdirSync(join(dir, 'android/app/src/main/res'), { recursive: true });
  writeFileSync(join(dir, MANIFEST), manifest);
  writeFileSync(join(dir, 'android/app/build.gradle'), 'android {\n    buildTypes {\n    }\n}\ndependencies {\n}\n');
  return dir;
}
const patch = (dir: string): void => {
  execFileSync(process.execPath, [join(frontend, 'scripts/patch-android.js')], { cwd: dir, stdio: 'pipe' });
};
const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8');
const count = (s: string, part: string): number => s.split(part).length - 1;

/** MainActivity's element (the services and receivers after it are other tests' business). */
const activity = (manifest: string): string => manifest.slice(manifest.indexOf('<activity'), manifest.indexOf('</activity>'));
/** The intent filters inside MainActivity, in order. */
const filters = (manifest: string): string[] => activity(manifest).match(/<intent-filter[^>]*>[\s\S]*?<\/intent-filter>/g) ?? [];

let fresh = '';
let freshOnce = '';
let upgraded = '';
let main = '';

beforeAll(() => {
  const a = project(capManifest());
  patch(a);
  freshOnce = read(a, MANIFEST);
  patch(a);
  fresh = read(a, MANIFEST);
  main = read(a, `${PKG_DIR}/MainActivity.java`);
  const b = project(capManifest(OLD_FILTER));
  patch(b);
  upgraded = read(b, MANIFEST);
});

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('patch-android.js: verified App Links', () => {
  it('verifies www only, for the shared pages, and keeps the apex unverified', () => {
    const [launcher, www, apex, send] = filters(fresh);
    expect(launcher).toContain('android.intent.category.LAUNCHER');
    expect(www).toContain('android:autoVerify="true"');
    expect(www).toContain('<data android:host="www.vinaxmusic.online" />');
    expect(www).not.toContain('<data android:host="vinaxmusic.online" />');
    expect(apex).not.toContain('autoVerify');
    expect(apex).toContain('<data android:host="vinaxmusic.online" />');
    expect(apex).not.toContain('www.');
    for (const f of [www, apex]) {
      expect(f).toContain('<action android:name="android.intent.action.VIEW" />');
      expect(f).toContain('<category android:name="android.intent.category.BROWSABLE" />');
      expect(f).toContain('<data android:scheme="https" />');
      expect(f).not.toContain('android:scheme="http"');
      // The invite button's intent:// link (features/together/invite.ts) and shared pages.
      for (const p of ['/together', '/p/', '/song/', '/album/', '/artist/', '/playlist/', '/flow', '/video/']) expect(f).toContain(`<data android:pathPrefix="${p}" />`);
      // Home and the sign-in pages stay in the browser.
      expect(f).not.toMatch(/android:(path|pathPrefix)="\/"/);
      expect(f).not.toContain('/login');
    }
    expect(send).toContain('<action android:name="android.intent.action.SEND" />');
  });

  it('autoVerify is on exactly one filter, and a second run adds nothing', () => {
    expect(count(fresh, 'android:autoVerify="true"')).toBe(1);
    expect(count(fresh, '<!-- vinax-links -->')).toBe(1);
    expect(count(fresh, '<!-- /vinax-links -->')).toBe(1);
    expect(activity(fresh)).toBe(activity(freshOnce));
    expect(activity(fresh)).toContain('</intent-filter>\n            <!-- vinax-links -->');
  });

  it('replaces the 1.13 unverified filter instead of adding a second set', () => {
    expect(count(upgraded, '<!-- vinax-links -->')).toBe(1);
    expect(count(upgraded, '<data android:host="www.vinaxmusic.online" />')).toBe(1);
    expect(filters(upgraded)).toHaveLength(4);
    expect(filters(upgraded)).toEqual(filters(fresh));
    expect(upgraded).not.toMatch(/<intent-filter>\s*<action android:name="android\.intent\.action\.VIEW" \/>[\s\S]{0,300}<data android:host="www\.vinaxmusic\.online" \/>\s*<data android:host="vinaxmusic\.online" \/>/);
  });

  it('publishes assetlinks.json for the package with the release key, served as JSON', () => {
    const links = JSON.parse(readFileSync(join(frontend, 'public/.well-known/assetlinks.json'), 'utf8')) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    expect(links).toHaveLength(1);
    expect(links[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(links[0].target.namespace).toBe('android_app');
    const config = readFileSync(join(frontend, 'capacitor.config.ts'), 'utf8');
    expect(config).toContain(`appId: '${links[0].target.package_name}'`);
    // The release key (README, Android push setup), never the public debug keystore.
    expect(links[0].target.sha256_cert_fingerprints).toEqual(['8C:AF:24:E7:AA:83:B7:EA:12:E1:2C:E3:FF:C1:14:DD:8C:EB:57:38:25:AB:EB:82:3E:FE:AE:E4:F2:6B:7C:CE']);
    const headers = readFileSync(join(frontend, 'public/_headers'), 'utf8');
    expect(headers).toMatch(/^\/\.well-known\/assetlinks\.json\n {2}Content-Type: application\/json$/m);
    // Not sent to Functions, and no redirect rule touches it.
    expect(readFileSync(join(frontend, 'public/_routes.json'), 'utf8')).toContain('"/.well-known/*"');
    expect(readFileSync(join(frontend, 'public/_redirects'), 'utf8')).not.toMatch(/^\/\.well-known/m);
  });
});

describe('patch-android.js: Share to VinaX', () => {
  it('puts the app in the share sheet for plain text', () => {
    const send = filters(fresh)[3];
    expect(send).not.toContain('autoVerify');
    expect(send).toContain('<category android:name="android.intent.category.DEFAULT" />');
    expect(send).toContain('<data android:mimeType="text/plain" />');
  });

  it('turns the shared text into a /share VIEW link before Capacitor reads the intent', () => {
    expect(main).toContain('import android.net.Uri;');
    expect(main).toContain('private static void shareAsLink(Intent intent)');
    expect(main).toContain('Intent.ACTION_SEND.equals(intent.getAction())');
    expect(main).toContain('intent.getCharSequenceExtra(Intent.EXTRA_TEXT)');
    expect(main).toContain('intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT)');
    // The page's origin (capacitor.config.ts server.url), so deepLinkPath accepts it.
    expect(main).toContain('"https://www.vinaxmusic.online/share?text="');
    expect(main).toContain('.append("&title=")');
    expect(main).toContain('Uri.encode(text)');
    expect(main).toContain('intent.setAction(Intent.ACTION_VIEW);');
    expect(main).toContain('intent.setData(Uri.parse(link.toString()));');
    // Cold start: before super.onCreate (the bridge keeps the launch link).
    const create = main.slice(main.indexOf('public void onCreate('), main.indexOf('super.onCreate(savedInstanceState);'));
    expect(create).toContain('shareAsLink(getIntent());');
    // Warm start: before super.onNewIntent (the App plugin fires appUrlOpen there).
    const onNew = main.slice(main.indexOf('public void onNewIntent('), main.indexOf('super.onNewIntent(intent);'));
    expect(onNew).toContain('shareAsLink(intent);');
    // Guarded: a broken share never stops the app opening.
    const body = main.slice(main.indexOf('private static void shareAsLink'), main.indexOf('/** A tap on a push'));
    expect(body).toContain('catch (Exception ignored)');
    expect(body).toContain('SHARE_MAX');
  });
});
