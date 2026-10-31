/**
 * scripts/auto-release.mjs — every merge to main becomes a numbered release.
 * The pure parts are pinned here; the CLI and the workflow around it are
 * exercised by a dry run in CI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bumpVersion, cardMessage, directiveOf, directiveOfMerge, entryFromMessage, insertChangelogEntry, levelOf, updatePackageJson, updateVersionTs } from '../../scripts/auto-release.mjs';
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

  it('reads the level from the subject or a line of its own, never from prose', () => {
    expect(levelOf('Fix the queue (#160)')).toBe('patch');
    expect(levelOf('New Discover page #minor')).toBe('minor');
    expect(levelOf('Rework everything\n\nrelease: major\n')).toBe('major');
    expect(levelOf('A song called #minority report')).toBe('patch');
    expect(directiveOf('[skip release] fix a typo in the README')).toBe('skip');
    expect(directiveOf('Docs\n\nrelease: skip')).toBe('skip');
    // The first automatic release was skipped by its own pull request
    // description, which documented the markers in prose: a squash merge
    // carries that body, so only the subject and a bare "release: …" line count.
    const squash = [
      'Every merge is a release (#151)',
      '',
      '- `#minor` or `#major` in the merge message bumps more; `[skip release]` leaves the version alone.',
      '- A merge that says [skip release] is released as is.',
      'Mentioning release: major in a sentence is not a request either.',
    ].join('\n');
    expect(directiveOf(squash)).toBe('patch');
    expect(directiveOf('Add docs for `#major` releases')).toBe('patch');
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

describe('the card comes from the pull request, whatever merge method', () => {
  // What GitHub's own squash button wrote for #193: the PR title, then the branch's commits.
  const squashFromButton = [
    'A guide to VinaX AI, and clearer notes for the last two updates (#193)',
    '',
    "* VinaX AI: the console's providers card (server)",
    '',
    'GET /api/admin/ai: keys set or missing, rests and last errors per provider.',
    '',
    'Co-Authored-By: Claude <noreply@anthropic.com>',
    '',
    '* Console: VinaX AI on Health, and a form for its setting on Publish',
  ].join('\n');
  const pr = [
    'A guide to VinaX AI, and clearer notes for the last two updates',
    '',
    '- A new guide to VinaX AI explains asking, choosing a model, web search, adding files, the side panel, voice and keeping your chats.',
    '- The notes for the last two updates now say plainly what you can do.',
    '',
    'Phase 7 of VinaX AI. Checks run locally.',
    '',
    '🤖 Generated with [Claude Code](https://claude.com/claude-code)',
  ].join('\n');

  it('uses the pull request title and its listener bullets, not the commit list', () => {
    const entry = entryFromMessage(cardMessage(squashFromButton, pr));
    expect(entry.title).toBe('A guide to VinaX AI, and clearer notes for the last two updates');
    expect(entry.changes.map((c) => c.text)).toEqual([
      'A new guide to VinaX AI explains asking, choosing a model, web search, adding files, the side panel, voice and keeping your chats.',
      'The notes for the last two updates now say plainly what you can do.',
    ]);
    // Without the lookup, the commit list became the card: the bug this guards.
    expect(entryFromMessage(squashFromButton).changes[0].text).toBe("VinaX AI: the console's providers card (server).");
  });

  it('falls back to the commit message when there is no pull request', () => {
    expect(cardMessage('Fix the player\n\n- Songs resume after a call', '')).toBe('Fix the player\n\n- Songs resume after a call');
    expect(cardMessage('Fix the player', '   \n')).toBe('Fix the player');
  });

  it('a skip or a bigger bump asked in either the commit or the pull request counts; prose never does', () => {
    expect(directiveOfMerge('Notes (#194)', 'Clearer notes [skip release]\n\nNotes only.')).toBe('skip');
    expect(directiveOfMerge('Clearer notes [skip release] (#194)', 'Clearer notes')).toBe('skip');
    expect(directiveOfMerge('Voice (#192)', 'Voice #minor\n\n- Talk to VinaX AI')).toBe('minor');
    expect(directiveOfMerge('Big one #major (#9)', 'Big one #minor')).toBe('major');
    expect(directiveOfMerge('Docs (#9)', 'Docs\n\nThe title can say [skip release] to skip the release.')).toBe('patch');
    expect(directiveOfMerge('Docs (#9)', '')).toBe('patch');
  });

  it('the workflow looks the pull request up and hands it to the script', () => {
    const wf = readFileSync(resolve(__dirname, '../../../.github/workflows/auto-release.yml'), 'utf8');
    expect(wf).toMatch(/pull-requests: read/);
    expect(wf).toContain('repos/$REPO/commits/$SHA/pulls');
    expect(wf).toContain('RELEASE_PR_MESSAGE: ${{ steps.pr.outputs.message }}');
  });
});

describe('file edits', () => {
  const versionTs = readFileSync(resolve(__dirname, '../constants/version.ts'), 'utf8');
  const changelogTs = readFileSync(resolve(__dirname, '../constants/changelog.ts'), 'utf8');
  const pkg = readFileSync(resolve(__dirname, '../../package.json'), 'utf8');
  const lock = readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8');
  const next = bumpVersion(LATEST_VERSION);

  it('version.ts: LATEST_VERSION and DISPLAY_VERSION follow the bump', () => {
    const out = updateVersionTs(versionTs, '1.2.0');
    expect(out).toContain("export const LATEST_VERSION = '1.2.0';");
    expect(out).toContain("export const DISPLAY_VERSION = 'VinaX V2 1.2';");
    // A patch keeps the display name.
    expect(updateVersionTs(versionTs, '1.0.3')).toContain("export const DISPLAY_VERSION = 'VinaX V2 1.0';");
  });

  it('changelog.ts: a V2 version the classic history already used is still a new card', () => {
    // 1.1.0 shipped in 2025 on the classic line; the V2 line reaches it again.
    // A fixture, not the real file: once V2 itself ships 1.1.0 the real file
    // rightly refuses a second 1.1.0 card (that broke the 1.1.0 release run).
    const fixture = [
      'export const CHANGELOG_V2: Record<string, VersionInfo> = {',
      "  '1.0.2': {",
      "    title: 'Before',",
      '    changes: [],',
      '  },',
      '};',
      '',
      'export const CHANGELOG_CLASSIC: Record<string, VersionInfo> = {',
      "  '1.1.0': {",
      "    title: 'Classic',",
      '    changes: [],',
      '  },',
      '};',
      '',
    ].join('\n');
    const out = insertChangelogEntry(fixture, '1.1.0', { title: 'Next', changes: [{ type: 'new', text: 'x' }] });
    expect(out.indexOf("'1.1.0'")).toBeLessThan(out.indexOf("'1.0.2'"));
    expect(() => insertChangelogEntry(out, '1.1.0', { title: 'Again', changes: [] })).toThrow('changelog already has 1.1.0');
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
