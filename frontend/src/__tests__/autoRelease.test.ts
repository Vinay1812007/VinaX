/**
 * scripts/auto-release.mjs — every merge to main becomes a numbered release.
 * The pure parts are pinned here; the CLI and the workflow around it are
 * exercised by a dry run in CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bumpVersion, entryFromMessage, insertChangelogEntry, levelOf, updatePackageJson, updateVersionTs } from '../../scripts/auto-release.mjs';
import { CHANGELOG_V2 } from '../constants/changelog';
import { LATEST_VERSION } from '../constants/version';

describe('bumpVersion / levelOf', () => {
  it('bumps patch by default, minor and major on request', () => {
    expect(bumpVersion('14.0.1')).toBe('14.0.2');
    expect(bumpVersion('14.0.9', 'patch')).toBe('14.0.10');
    expect(bumpVersion('14.0.1', 'minor')).toBe('14.1.0');
    expect(bumpVersion('14.3.7', 'major')).toBe('15.0.0');
    expect(() => bumpVersion('v14')).toThrow();
  });

  it('reads the level from the commit message', () => {
    expect(levelOf('Fix the queue (#160)')).toBe('patch');
    expect(levelOf('New Discover page #minor')).toBe('minor');
    expect(levelOf('Rework everything\n\nrelease: major\n')).toBe('major');
    expect(levelOf('A song called #minority report')).toBe('patch');
  });
});

describe('entryFromMessage', () => {
  it('uses the subject as the title and the body bullets as the changes', () => {
    const e = entryFromMessage([
      'fix(player): Crossfade no longer cuts the last second (#161)',
      '',
      'Some intro prose about the change.',
      '',
      '- The **crossfade** now waits for the `ended` event, so the last second plays.',
      '- Adds a Settings switch to turn it off.',
      '- Lyrics scroll smoother on long songs',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'https://claude.ai/code/session_x',
    ].join('\n'));
    expect(e.title).toBe('Crossfade no longer cuts the last second');
    expect(e.changes).toEqual([
      { type: 'fixed', text: 'The crossfade now waits for the ended event, so the last second plays.' },
      { type: 'new', text: 'Adds a Settings switch to turn it off.' },
      // A line under a `fix:` subject reads as a fix unless it says "new".
      { type: 'fixed', text: 'Lyrics scroll smoother on long songs.' },
    ]);
    expect(entryFromMessage('Discover: a Moods row\n\n- Lyrics scroll smoother on long songs').changes[0].type).toBe('improved');
  });

  it('falls back to the first prose line, then to the title', () => {
    expect(entryFromMessage('QA: full Playwright sweep (#149)\n\nA full pass over the app with every suite green.\n')).toEqual({
      title: 'Full Playwright sweep',
      changes: [{ type: 'improved', text: 'A full pass over the app with every suite green.' }],
    });
    expect(entryFromMessage('Tidy the queue')).toEqual({ title: 'Tidy the queue', changes: [{ type: 'improved', text: 'Tidy the queue.' }] });
  });

  it('caps the card at four changes and keeps lines readable', () => {
    const msg = 'Big change\n\n' + Array.from({ length: 7 }, (_, i) => `- Change number ${i} with some words`).join('\n');
    expect(entryFromMessage(msg).changes).toHaveLength(4);
    const long = entryFromMessage(`Title\n\n- ${'word '.repeat(80)}`).changes[0].text;
    expect(long.length).toBeLessThanOrEqual(240);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('file edits', () => {
  const versionTs = readFileSync(resolve(__dirname, '../constants/version.ts'), 'utf8');
  const changelogTs = readFileSync(resolve(__dirname, '../constants/changelog.ts'), 'utf8');
  const pkg = readFileSync(resolve(__dirname, '../../package.json'), 'utf8');
  const lock = readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8');
  const next = bumpVersion(LATEST_VERSION);

  it('version.ts: LATEST_VERSION and DISPLAY_VERSION follow the bump', () => {
    const out = updateVersionTs(versionTs, '15.2.0');
    expect(out).toContain("export const LATEST_VERSION = '15.2.0';");
    expect(out).toContain("export const DISPLAY_VERSION = 'VinaX 15';");
  });

  it('changelog.ts: the new card leads and quotes are escaped', () => {
    const out = insertChangelogEntry(changelogTs, next, { title: "It's here", changes: [{ type: 'new', text: "Listeners' picks" }] });
    const top = /CHANGELOG_V2: Record<string, VersionInfo> = \{\n {2}'([^']+)'/.exec(out)?.[1];
    expect(top).toBe(next);
    expect(out).toContain("title: 'It\\'s here',");
    expect(out).toContain("{ type: 'new', text: 'Listeners\\' picks' },");
    expect(() => insertChangelogEntry(out, next, { title: 'x', changes: [] })).toThrow(/already/);
    // The current top card is still the second one.
    const keys = [...out.matchAll(/\n {2}'(\d+\.\d+\.\d+)': \{/g)].map((m) => m[1]);
    expect(keys.slice(0, 2)).toEqual([next, Object.keys(CHANGELOG_V2)[0]]);
  });

  it('package.json and package-lock.json: the root version, both places in the lock', () => {
    expect(JSON.parse(updatePackageJson(pkg, '15.0.0')).version).toBe('15.0.0');
    const l = JSON.parse(updatePackageJson(lock, '15.0.0')) as { version: string; packages: Record<string, { version: string }> };
    expect(l.version).toBe('15.0.0');
    expect(l.packages[''].version).toBe('15.0.0');
    // No dependency's version moved.
    expect(Object.entries(l.packages).filter(([k]) => k !== '').map(([, v]) => v.version)).toEqual(
      Object.entries((JSON.parse(lock) as typeof l).packages).filter(([k]) => k !== '').map(([, v]) => v.version),
    );
  });
});
