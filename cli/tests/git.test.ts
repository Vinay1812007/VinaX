/**
 * Git, end to end, against real repositories in temporary directories.
 *
 * The push tests use a local bare repository as the remote, so the whole
 * commit-and-push path is exercised with no network and no credentials — and
 * the developer's own repository is never touched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  gitAddTool, gitBranchTool, gitCommitTool, gitDiffTool, gitLogTool,
  gitPushTool, gitShowTool, gitStatusTool, commitArgs, pushArgs,
} from '../src/tools/git/git.js';
import { classifyArgv } from '../src/security/risk.js';
import { cleanup, gitEnv, gitRun, hasGit, initRepo, tempDir, testContext, writeFiles, type TestContext } from './helpers.js';

const git = hasGit();
const args = (o: Record<string, unknown>): Record<string, unknown> => o;

let base = '';
let repo = '';
let remote = '';
let ctx: TestContext;

beforeEach(async () => {
  if (!git) return;
  base = await tempDir('vinax-git-');
  repo = join(base, 'work');
  remote = join(base, 'remote.git');
  await mkdir(repo, { recursive: true });
  await initRepo(repo);
  await writeFiles(repo, {
    'README.md': '# Demo\n',
    'src/app.ts': 'export const app = "v1";\n',
  });
  gitRun(repo, ['add', '.']);
  gitRun(repo, ['commit', '-m', 'initial commit']);
  ctx = await testContext({ root: repo });
});
afterEach(async () => { if (base) await cleanup(base); });

describe.runIf(git)('reading git state', () => {
  it('reports the branch and a clean tree', async () => {
    const r = await gitStatusTool({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('branch: main');
    expect(r.content).toContain('working tree clean');
    expect(r.content).toContain('upstream: none');
  });

  it('reports modifications', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    const r = await gitStatusTool({}, ctx);
    expect(r.content).toContain('src/app.ts');
  });

  it('shows a unified diff of the working tree', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    const r = await gitDiffTool({}, ctx);
    expect(r.content).toContain('-export const app = "v1";');
    expect(r.content).toContain('+export const app = "v2";');
  });

  it('says plainly when there is nothing to diff', async () => {
    expect((await gitDiffTool({}, ctx)).content).toContain('no unstaged changes');
    expect((await gitDiffTool(args({ staged: true }), ctx)).content).toContain('Nothing is staged');
  });

  it('lists commits and shows one', async () => {
    expect((await gitLogTool(args({ limit: 5 }), ctx)).content).toContain('initial commit');
    expect((await gitShowTool(args({ ref: 'HEAD' }), ctx)).content).toContain('initial commit');
  });

  it('refuses a commit reference that is really an option', async () => {
    const r = await gitShowTool(args({ ref: '--upload-pack=touch /tmp/pwned' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('not a valid commit reference');
  });

  it('reads git state without asking permission — inspection is free', async () => {
    await gitStatusTool({}, ctx);
    await gitDiffTool({}, ctx);
    await gitLogTool({}, ctx);
    expect(ctx.asked).toHaveLength(0);
  });
});

describe.runIf(git)('staging and committing', () => {
  it('stages only the paths it was given', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    await writeFile(join(repo, 'unrelated.txt'), 'the user was working on this\n', 'utf8');
    const r = await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    expect(r.ok).toBe(true);
    const staged = gitRun(repo, ['diff', '--cached', '--name-only']).stdout;
    expect(staged).toContain('src/app.ts');
    expect(staged).not.toContain('unrelated.txt');
  });

  it('REFUSES to stage everything, so the user\'s work in progress is safe', async () => {
    for (const sweep of ['.', '-A', '--all', '*']) {
      const r = await gitAddTool(args({ paths: [sweep] }), ctx);
      expect(r.ok, sweep).toBe(false);
      expect(r.content).toContain('explicit file paths');
    }
  });

  it('commits and reports the REAL hash', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    const r = await gitCommitTool(args({ message: 'fix: bump app version' }), ctx);
    expect(r.ok).toBe(true);
    const real = gitRun(repo, ['rev-parse', 'HEAD']).stdout.trim();
    expect(real.startsWith(String(r.meta?.hash))).toBe(true);
    expect(ctx.ledger.commits[0].hash).toBe(r.meta?.hash);
  });

  it('shows the message and the staged diff before committing', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'fix: bump app version' }), ctx);
    const prompt = ctx.asked.at(-1)!;
    expect(prompt.title).toBe('Commit these changes?');
    expect(prompt.detail.join('\n')).toContain('fix: bump app version');
    expect(prompt.detail.join('\n')).toContain('src/app.ts');
  });

  it('refuses to commit nothing', async () => {
    const r = await gitCommitTool(args({ message: 'empty' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('Nothing is staged');
  });

  it('does NOT commit when the user rejects', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'v2\n', 'utf8');
    const strict = await testContext({ root: repo, answer: (r) => (r.kind === 'git-write' && r.title.startsWith('Commit') ? 'reject' : 'once') });
    await gitAddTool(args({ paths: ['src/app.ts'] }), strict);
    const r = await gitCommitTool(args({ message: 'nope' }), strict);
    expect(r.ok).toBe(false);
    expect(gitRun(repo, ['log', '--oneline']).stdout.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('reports a hook rejection honestly instead of claiming success', async () => {
    await mkdir(join(repo, '.git', 'hooks'), { recursive: true });
    const hook = join(repo, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\necho "hook says no" >&2\nexit 1\n', { mode: 0o755 });
    await writeFile(join(repo, 'src/app.ts'), 'v2\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    const r = await gitCommitTool(args({ message: 'should be blocked' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('did NOT happen');
    expect(gitRun(repo, ['log', '--oneline']).stdout.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('never passes --no-verify: the argv it builds simply does not contain it', () => {
    expect(commitArgs('fix: something')).toEqual(['commit', '-m', 'fix: something']);
    expect(commitArgs('x').join(' ')).not.toContain('--no-verify');
  });

  it('creates and switches branches', async () => {
    const r = await gitBranchTool(args({ create: 'feat/vinax-cli' }), ctx);
    expect(r.ok).toBe(true);
    expect(gitRun(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/vinax-cli');
  });

  it('refuses a branch name that is not one', async () => {
    expect((await gitBranchTool(args({ create: '--upload-pack=evil' }), ctx)).ok).toBe(false);
    expect((await gitBranchTool(args({ create: 'a/../../b' }), ctx)).ok).toBe(false);
  });
});

describe.runIf(git)('pushing to a real remote', () => {
  beforeEach(() => {
    spawnSync('git', ['init', '--bare', '--initial-branch=main', remote], { encoding: 'utf8', env: gitEnv() });
    gitRun(repo, ['remote', 'add', 'origin', remote]);
  });

  it('pushes a commit and the remote really has it', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'export const app = "v2";\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'fix: bump version' }), ctx);
    const r = await gitPushTool(args({ setUpstream: true }), ctx);
    expect(r.ok).toBe(true);

    const remoteLog = spawnSync('git', ['--git-dir', remote, 'log', '--oneline', 'main'], { encoding: 'utf8', env: gitEnv() });
    expect(remoteLog.stdout).toContain('fix: bump version');
    expect(ctx.ledger.pushes[0]).toMatchObject({ remote: 'origin', branch: 'main', ok: true });
  });

  it('shows the remote, the branch and the commits BEFORE pushing', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'v2\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'fix: something' }), ctx);
    await gitPushTool({}, ctx);
    const prompt = ctx.asked.at(-1)!;
    expect(prompt.kind).toBe('remote-write');
    expect(prompt.title).toBe('Push changes?');
    const detail = prompt.detail.join('\n');
    expect(detail).toContain('Remote:  origin');
    expect(detail).toContain('Branch:  main');
    expect(detail).toContain('fix: something');
    expect(detail).toContain('This changes the remote repository.');
  });

  it('does NOT push when the user rejects', async () => {
    await writeFile(join(repo, 'src/app.ts'), 'v2\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'fix: something' }), ctx);
    const strict = await testContext({ root: repo, answer: (r) => (r.kind === 'remote-write' ? 'reject' : 'once') });
    const r = await gitPushTool({}, strict);
    expect(r.ok).toBe(false);
    expect(r.permissionDenied).toBe(true);
    const remoteLog = spawnSync('git', ['--git-dir', remote, 'log', '--oneline'], { encoding: 'utf8', env: gitEnv() });
    expect(remoteLog.stdout).not.toContain('fix: something');
  });

  it('reports a REJECTED push honestly and never forces it', async () => {
    // Put a commit on the remote that the local branch does not have.
    const other = join(base, 'other');
    spawnSync('git', ['clone', remote, other], { encoding: 'utf8', env: gitEnv() });
    await writeFile(join(other, 'from-elsewhere.txt'), 'someone else pushed this\n', 'utf8');
    gitRun(other, ['add', '.']);
    gitRun(other, ['commit', '-m', 'from elsewhere']);
    gitRun(other, ['push', 'origin', 'HEAD:main']);

    gitRun(repo, ['push', '--set-upstream', 'origin', 'main']);
    await writeFile(join(repo, 'src/app.ts'), 'v3\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'local work' }), ctx);
    const r = await gitPushTool({}, ctx);
    if (!r.ok) {
      expect(r.content).toMatch(/REJECTED|FAILED/);
      expect(r.content).toContain('will not force push');
    }
    // Whatever happened, the other branch's commit is still on the remote.
    const remoteLog = spawnSync('git', ['--git-dir', remote, 'log', '--oneline', 'main'], { encoding: 'utf8', env: gitEnv() });
    expect(remoteLog.stdout).toContain('from elsewhere');
  });

  it('says there is nothing to push rather than pushing nothing', async () => {
    gitRun(repo, ['push', '--set-upstream', 'origin', 'main']);
    const r = await gitPushTool({}, ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('nothing to push');
  });

  it('reports an unreachable remote as an authentication or network failure', async () => {
    gitRun(repo, ['remote', 'set-url', 'origin', join(base, 'does-not-exist.git')]);
    await writeFile(join(repo, 'src/app.ts'), 'v2\n', 'utf8');
    await gitAddTool(args({ paths: ['src/app.ts'] }), ctx);
    await gitCommitTool(args({ message: 'fix' }), ctx);
    const r = await gitPushTool({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('FAILED');
  });

  it('has no way to force push at all: neither the argv it builds nor the classifier allows it', () => {
    const argv = pushArgs({ remote: 'origin', branch: 'main', setUpstream: true });
    expect(argv).toEqual(['push', '--set-upstream', 'origin', 'main']);
    for (const flag of ['--force', '-f', '--force-with-lease', '--delete', '--mirror']) {
      expect(argv, flag).not.toContain(flag);
    }
    expect(classifyArgv(['git', ...argv]).level).toBe('elevated');
    expect(classifyArgv(['git', 'push', '--force']).level).toBe('critical');
    expect(classifyArgv(['git', 'push', '--force-with-lease']).level).toBe('critical');
  });

  it('says there is nowhere to push when the repository has no remote', async () => {
    gitRun(repo, ['remote', 'remove', 'origin']);
    const r = await gitPushTool({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('no remote configured');
  });
});
