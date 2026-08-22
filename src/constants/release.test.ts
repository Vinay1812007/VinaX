import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_VERSION } from './version';
import { CHANGELOG_V2 } from './changelog';
import { KEYS } from './storage-keys';

/** Release hygiene: version, changelog and package.json move in lock-step. */
describe('release consistency', () => {
  it('LATEST_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(LATEST_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe(LATEST_VERSION);
  });

  it('the changelog leads with the current version', () => {
    const top = Object.keys(CHANGELOG_V2)[0];
    expect(top).toBe(LATEST_VERSION);
    const entry = CHANGELOG_V2[top];
    expect(entry?.title?.length ?? 0).toBeGreaterThan(0);
    expect(entry?.changes?.length ?? 0).toBeGreaterThan(0);
  });

  it('storage keys are unique', () => {
    const values = Object.values(KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});
