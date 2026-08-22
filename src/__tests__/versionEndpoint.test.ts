/**
 * The in-app-update outage (user report: "not getting in-app update").
 *
 * The number /api/version serves MUST equal the installed APK's Android
 * versionCode or checkForUpdate never fires. CI builds carry versionCode
 * BASE+run_number but the old tags said "-build<run_number>" — so the
 * manifest reported 106 to devices running 1106 and every phone looked
 * "up to date" forever. These tests pin the repaired resolution order:
 * explicit "VersionCode:" in the release body wins; tag parse is only a
 * fallback for pre-fix releases.
 */
import { describe, expect, it } from 'vitest';
import { buildFromRelease } from '../../worker/functions/api/version';

describe('buildFromRelease', () => {
  it('prefers the explicit VersionCode line CI now writes into the body', () => {
    const body = 'Automated build of VinaX.\nVersion: 4.11.0\nVersionCode: 1121\nSigned: true';
    expect(buildFromRelease('v4.11.0-build1121', body)).toBe(1121);
    // Even when the tag disagrees (a hand-made release), the body wins.
    expect(buildFromRelease('v4.11.0-build106', body)).toBe(1121);
  });

  it('falls back to the tag for pre-fix releases with no VersionCode line', () => {
    expect(buildFromRelease('v9.7-build106', 'Automated build of VinaX.\nBuild: 106')).toBe(106);
    expect(buildFromRelease('v9.7-build106', null)).toBe(106);
    expect(buildFromRelease('v9.7-build106')).toBe(106);
  });

  it('is case/format tolerant and never NaN', () => {
    expect(buildFromRelease('v1.0-build77', 'versioncode: 1077')).toBe(1077);
    expect(buildFromRelease('v1.0-build77', 'VersionCode 1077')).toBe(1077);
    expect(buildFromRelease('no-build-marker', 'no code here')).toBe(0);
    expect(Number.isNaN(buildFromRelease('', ''))).toBe(false);
  });

  it('REGRESSION: the exact outage shape — tag run_number vs APK versionCode', () => {
    // Old manifest: 106. Installed device: 1106. 106 <= 1106 → no update, ever.
    const oldManifestBuild = buildFromRelease('v9.7-build106', 'Build: 106');
    const installedVersionCode = 1106;
    expect(oldManifestBuild).toBeLessThanOrEqual(installedVersionCode); // the bug, preserved for old tags
    // New release format: the served build exceeds every 1000-range install.
    const fixed = buildFromRelease('v4.11.0-build1121', 'VersionCode: 1121');
    expect(fixed).toBeGreaterThan(installedVersionCode); // the update NOW fires
  });
});
