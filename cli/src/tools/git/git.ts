/**
 * Git, as a first-class part of the agent rather than a shell string.
 *
 * Everything here runs the user's own `git` binary, in their repository, with
 * their credential helper and their SSH agent. VinaX never asks for a Git
 * password, never stores one, and never puts a token into a remote URL.
 *
 * The rules that matter:
 *
 *  - VinaX distinguishes changes that were already there from changes it
 *    made. Staging is by explicit path, never `git add -A`, so a user's
 *    unrelated work-in-progress is not swept into the agent's commit.
 *  - Nothing destructive is reachable. There is no reset --hard, no clean,
 *    no checkout-that-discards, no force push, no remote branch delete. Not
 *    behind a flag, not behind a prompt: the tools do not exist.
 *  - Hooks always run. `--no-verify` is never added.
 *  - A push shows the user the remote, the branch and the commits first, and
 *    needs approval every time unless they grant it for the session.
 */
import { runProcess } from '../process/runner.js';
import { classifyArgv } from '../../security/risk.js';
import { redact } from '../../security/secrets.js';
import { clip } from '../../utils/text.js';
import { resolvePath } from '../../security/paths.js';
import { argBool, argList, argNum, argStr, fail, ok, type ToolContext, type ToolResult } from '../types.js';

export interface GitRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError: string | null;
}

/** Run git with an argument array. Never a shell, never a prompt. */
export async function git(ctx: { root: string; signal: AbortSignal; timeoutMs?: number }, args: string[]): Promise<GitRun> {
  const result = await runProcess({
    command: 'git',
    args,
    cwd: ctx.root,
    timeoutMs: ctx.timeoutMs ?? 120_000,
    maxOutputChars: 400_000,
    shell: false,
    signal: ctx.signal,
    env: {
      ...process.env,
      // A git that decides to open an editor or an askpass dialog inside a
      // non-interactive child is a hang, not a feature.
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      ...(process.env.GIT_ASKPASS === undefined && process.env.SSH_ASKPASS === undefined ? {} : {}),
    },
  });
  return {
    ok: result.exitCode === 0 && !result.spawnError,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    spawnError: result.spawnError,
  };
}

function gitMissing(r: GitRun): ToolResult | null {
  if (r.spawnError && /ENOENT/.test(r.spawnError)) {
    return fail('Git is not installed, or not on PATH. Install Git and try again.');
  }
  return null;
}

/** Is this directory inside a Git working tree, and where is its root? */
export async function gitRoot(dir: string, signal: AbortSignal): Promise<string | null> {
  const r = await git({ root: dir, signal, timeoutMs: 10_000 }, ['rev-parse', '--show-toplevel']);
  if (!r.ok) return null;
  const out = r.stdout.trim();
  return out || null;
}

export async function currentBranch(root: string, signal: AbortSignal): Promise<string> {
  const r = await git({ root, signal, timeoutMs: 10_000 }, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return r.ok ? r.stdout.trim() : '';
}

/** Porcelain status as structured rows. */
export async function statusRows(root: string, signal: AbortSignal): Promise<Array<{ x: string; y: string; path: string }>> {
  const r = await git({ root, signal, timeoutMs: 20_000 }, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (!r.ok) return [];
  const rows: Array<{ x: string; y: string; path: string }> = [];
  for (const line of r.stdout.split('\n')) {
    if (line.length < 4) continue;
    rows.push({ x: line[0], y: line[1], path: line.slice(3).trim() });
  }
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

async function requireRepo(ctx: ToolContext): Promise<{ ok: true; root: string } | { ok: false; result: ToolResult }> {
  const root = await gitRoot(ctx.ws.root, ctx.signal);
  if (!root) return { ok: false, result: fail('This workspace is not a Git repository.') };
  return { ok: true, root };
}

export async function gitStatusTool(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  ctx.ledger.setState('Checking Git');
  ctx.ui.step('Checking git status');
  const branch = await currentBranch(repo.root, ctx.signal);
  ctx.ledger.branch = branch;
  const rows = await statusRows(repo.root, ctx.signal);
  const upstream = await git({ root: repo.root, signal: ctx.signal }, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const lines = rows.map((r) => `${r.x}${r.y} ${r.path}`);
  return ok(
    [
      `branch: ${branch || '(detached)'}`,
      upstream.ok ? `upstream: ${upstream.stdout.trim()}` : 'upstream: none (this branch has never been pushed)',
      '',
      lines.length ? lines.join('\n') : '(working tree clean)',
    ].join('\n'),
    { branch, changed: rows.length },
  );
}

export async function gitDiffTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const staged = argBool(args, 'staged');
  const path = argStr(args, 'path');
  const argv = ['diff', ...(staged ? ['--cached'] : []), '--no-color'];
  if (path) {
    const r = await resolvePath(ctx.ws, path);
    if (!r.ok) return { ...fail(`Cannot diff that path: ${r.detail}`), permissionDenied: true };
    argv.push('--', r.path);
  }
  ctx.ui.step(`git diff${staged ? ' --cached' : ''}${path ? ` -- ${path}` : ''}`);
  const r = await git({ root: repo.root, signal: ctx.signal }, argv);
  const missing = gitMissing(r);
  if (missing) return missing;
  if (!r.ok) return fail(`git diff failed: ${redact(r.stderr.trim())}`);
  const out = r.stdout.trim();
  if (!out) return ok(staged ? 'Nothing is staged.' : 'The working tree has no unstaged changes.');
  return ok(clip(redact(out), ctx.config.maxOutputChars).text);
}

export async function gitLogTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const limit = Math.min(100, Math.max(1, argNum(args, 'limit', 20)));
  const argv = ['log', `-${limit}`, '--no-color', '--date=short', '--pretty=format:%h  %ad  %an  %s'];
  const path = argStr(args, 'path');
  if (path) {
    const r = await resolvePath(ctx.ws, path);
    if (!r.ok) return { ...fail(`Cannot log that path: ${r.detail}`), permissionDenied: true };
    argv.push('--', r.path);
  }
  ctx.ui.step('git log');
  const r = await git({ root: repo.root, signal: ctx.signal }, argv);
  if (!r.ok) return fail(`git log failed: ${redact(r.stderr.trim()) || 'no commits yet'}`);
  return ok(clip(r.stdout.trim() || '(no commits)', ctx.config.maxOutputChars).text);
}

export async function gitShowTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const ref = argStr(args, 'ref', 'HEAD').trim() || 'HEAD';
  // A ref is an identifier, not a place to smuggle options in.
  if (!/^[\w./@^~{}-]{1,120}$/.test(ref)) return fail(`"${ref}" is not a valid commit reference.`);
  ctx.ui.step(`git show ${ref}`);
  const r = await git({ root: repo.root, signal: ctx.signal }, ['show', '--no-color', '--stat', '--patch', ref]);
  if (!r.ok) return fail(`git show failed: ${redact(r.stderr.trim())}`);
  return ok(clip(redact(r.stdout.trim()), ctx.config.maxOutputChars).text);
}

export async function gitBranchTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const create = argStr(args, 'create').trim();
  const checkout = argStr(args, 'checkout').trim();
  const valid = (b: string): boolean => /^[\w][\w./-]{0,120}$/.test(b) && !b.includes('..');

  if (create || checkout) {
    const name = create || checkout;
    if (!valid(name)) return fail(`"${name}" is not a valid branch name.`);
    // Switching branches with uncommitted work can lose it. Git itself
    // refuses when it would overwrite, but VinaX asks first regardless.
    const dirty = (await statusRows(repo.root, ctx.signal)).filter((r) => r.x !== '?' || r.y !== '?');
    const decision = await ctx.permissions.check({
      kind: 'git-write',
      title: create ? `Create and switch to branch ${name}?` : `Switch to branch ${name}?`,
      detail: dirty.length
        ? [`There are ${dirty.length} uncommitted change(s) in the working tree.`, 'Git will refuse the switch if it would overwrite any of them.']
        : ['The working tree is clean.'],
      risk: 'routine',
      scopeKey: 'git:branch',
      scopeLabel: 'Allow branch switches this session',
    });
    if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };
    const argv = create ? ['checkout', '-b', name] : ['checkout', name];
    const r = await git({ root: repo.root, signal: ctx.signal }, argv);
    if (!r.ok) return fail(`git checkout failed: ${redact((r.stderr || r.stdout).trim())}`);
    ctx.ledger.branch = name;
    ctx.ui.step(`Now on branch ${name}`);
    return ok(`Now on branch ${name}.`);
  }

  const r = await git({ root: repo.root, signal: ctx.signal }, ['branch', '--list', '--no-color', '-vv']);
  if (!r.ok) return fail(`git branch failed: ${redact(r.stderr.trim())}`);
  return ok(clip(r.stdout.trim() || '(no branches)', ctx.config.maxOutputChars).text);
}

export async function gitAddTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const wanted = argList(args, 'paths');
  if (!wanted.length) return fail('git_add needs the paths to stage. Stage only the files this task changed.');
  // "." and "-A" would sweep in the user's unrelated work. Refuse by name so
  // the model gets a usable error instead of a mystery.
  const sweeping = wanted.filter((p) => ['.', '-A', '--all', '*', './'].includes(p.trim()));
  if (sweeping.length) {
    return fail('git_add takes explicit file paths. Staging everything would include changes the user made that are not part of this task.');
  }

  const resolved: string[] = [];
  for (const p of wanted) {
    const r = await resolvePath(ctx.ws, p);
    if (!r.ok) return { ...fail(`Cannot stage ${p}: ${r.detail}`), permissionDenied: true };
    resolved.push(r.path);
  }
  const decision = await ctx.permissions.check({
    kind: 'git-write',
    title: `Stage ${resolved.length} file${resolved.length === 1 ? '' : 's'}?`,
    detail: wanted.map((p) => `  ${p}`),
    risk: 'routine',
    scopeKey: 'git:add',
    scopeLabel: 'Allow staging files this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  const r = await git({ root: repo.root, signal: ctx.signal }, ['add', '--', ...resolved]);
  if (!r.ok) return fail(`git add failed: ${redact((r.stderr || r.stdout).trim())}`);
  ctx.ui.step(`Staged ${wanted.join(', ')}`);
  const staged = await git({ root: repo.root, signal: ctx.signal }, ['diff', '--cached', '--name-only']);
  return ok(`Staged.\n\nNow staged:\n${staged.stdout.trim() || '(nothing)'}`);
}

export async function gitCommitTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const message = argStr(args, 'message').trim();
  if (!message) return fail('git_commit needs a message.');

  const staged = await git({ root: repo.root, signal: ctx.signal }, ['diff', '--cached', '--name-only']);
  const files = staged.stdout.trim().split('\n').filter(Boolean);
  if (!files.length) return fail('Nothing is staged. Stage the files this task changed with git_add first.');

  const stat = await git({ root: repo.root, signal: ctx.signal }, ['diff', '--cached', '--stat', '--no-color']);
  ctx.ledger.setState('Committing');
  const decision = await ctx.permissions.check({
    kind: 'git-write',
    title: 'Commit these changes?',
    detail: [
      ...message.split('\n').map((l) => `  ${l}`),
      '',
      'Staged:',
      ...stat.stdout.trim().split('\n').map((l) => `  ${l}`),
    ],
    risk: 'routine',
    scopeKey: 'git:commit',
    scopeLabel: 'Allow commits this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  ctx.ui.step('Committing');
  // No --no-verify, ever: the project's hooks are part of the project.
  const r = await git({ root: repo.root, signal: ctx.signal }, commitArgs(message));
  if (!r.ok) {
    const detail = redact((r.stderr || r.stdout).trim());
    return fail(`The commit did NOT happen. Git said:\n${clip(detail, 4000).text}`);
  }
  const hashRun = await git({ root: repo.root, signal: ctx.signal }, ['rev-parse', 'HEAD']);
  const hash = hashRun.stdout.trim().slice(0, 12);
  ctx.ledger.commits.push({ hash, message: message.split('\n')[0] });
  ctx.ui.step(`Committed ${hash}`);
  return ok(`Committed ${hash}: ${message.split('\n')[0]}\n\n${redact(r.stdout.trim())}`, { hash });
}

/**
 * The exact argv for a commit and for a push.
 *
 * Pulled out as pure functions so the tests can assert what VinaX would run
 * without guessing from the source text: no `--no-verify` on a commit, and no
 * force, lease or delete flag on a push, ever.
 */
export function commitArgs(message: string): string[] {
  return ['commit', '-m', message];
}

export function pushArgs(opts: { remote: string; branch: string; setUpstream: boolean }): string[] {
  return ['push', ...(opts.setUpstream ? ['--set-upstream'] : []), opts.remote, opts.branch];
}

async function remoteName(root: string, signal: AbortSignal, wanted: string): Promise<string | null> {
  const r = await git({ root, signal }, ['remote']);
  const remotes = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!remotes.length) return null;
  if (wanted) return remotes.includes(wanted) ? wanted : null;
  return remotes.includes('origin') ? 'origin' : remotes[0];
}

export async function gitFetchTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return fetchOrPull(args, ctx, 'fetch');
}

export async function gitPullTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return fetchOrPull(args, ctx, 'pull');
}

async function fetchOrPull(args: Record<string, unknown>, ctx: ToolContext, verb: 'fetch' | 'pull'): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const remote = await remoteName(repo.root, ctx.signal, argStr(args, 'remote'));
  if (!remote) return fail('This repository has no matching remote.');

  const decision = await ctx.permissions.check({
    kind: 'network',
    title: `Run git ${verb} from ${remote}?`,
    detail: verb === 'pull'
      ? [`This merges remote commits into your current branch and can produce conflicts.`]
      : ['This only downloads; nothing in your working tree changes.'],
    risk: verb === 'pull' ? 'elevated' : 'routine',
    scopeKey: `git:${verb}`,
    scopeLabel: `Allow git ${verb} this session`,
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  ctx.ui.step(`git ${verb} ${remote}`);
  const r = await git({ root: repo.root, signal: ctx.signal, timeoutMs: 180_000 }, [verb, remote]);
  const out = redact(`${r.stdout}\n${r.stderr}`.trim());
  if (!r.ok) {
    if (/could not read Username|Authentication failed|Permission denied \(publickey\)|terminal prompts disabled/i.test(out)) {
      return fail(
        `git ${verb} could not authenticate to ${remote}. VinaX uses your own Git credentials and never asks for a password — set up your credential helper or SSH key and try again.\n\n${clip(out, 2000).text}`,
      );
    }
    if (/CONFLICT|Automatic merge failed/i.test(out)) {
      return fail(`git pull produced merge conflicts. Nothing was resolved automatically.\n\n${clip(out, 4000).text}`);
    }
    return fail(`git ${verb} failed:\n${clip(out, 4000).text}`);
  }
  return ok(clip(out || `${verb} completed.`, ctx.config.maxOutputChars).text);
}

export async function gitPushTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const repo = await requireRepo(ctx);
  if (!repo.ok) return repo.result;
  const remote = await remoteName(repo.root, ctx.signal, argStr(args, 'remote'));
  if (!remote) {
    return fail('This repository has no remote configured, so there is nowhere to push.');
  }
  const branch = argStr(args, 'branch').trim() || (await currentBranch(repo.root, ctx.signal));
  if (!branch || branch === 'HEAD') return fail('Cannot push from a detached HEAD. Check out a branch first.');
  if (!/^[\w][\w./-]{0,120}$/.test(branch)) return fail(`"${branch}" is not a valid branch name.`);

  // Say exactly what is about to leave the machine.
  const upstream = await git({ root: repo.root, signal: ctx.signal }, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const hasUpstream = upstream.ok && upstream.stdout.trim().length > 0;
  const range = hasUpstream ? `${upstream.stdout.trim()}..${branch}` : branch;
  const pending = await git({ root: repo.root, signal: ctx.signal }, ['log', '--no-color', '--pretty=format:%h %s', ...(hasUpstream ? [range] : ['-5', branch])]);
  const commits = pending.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (hasUpstream && !commits.length) {
    return ok(`${branch} is already up to date with ${upstream.stdout.trim()}; there is nothing to push.`);
  }

  const setUpstream = argBool(args, 'setUpstream', !hasUpstream);
  ctx.ledger.setState('Pushing');
  const decision = await ctx.permissions.check({
    kind: 'remote-write',
    title: 'Push changes?',
    detail: [
      `Remote:  ${remote}`,
      `Branch:  ${branch}`,
      hasUpstream ? `Tracking: ${upstream.stdout.trim()}` : 'Tracking: none yet (this creates the remote branch)',
      `Commits: ${commits.length}${hasUpstream ? '' : ' (most recent shown)'}`,
      '',
      ...commits.slice(0, 10).map((c) => `  ${c}`),
      ...(commits.length > 10 ? [`  … and ${commits.length - 10} more`] : []),
      '',
      'This changes the remote repository.',
    ],
    risk: 'elevated',
    scopeKey: 'git:push',
    scopeLabel: 'Allow normal pushes this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  // Belt and braces: whatever the arguments say, this must never be a force
  // push. classifyArgv is the same check the shell path uses.
  const argv = pushArgs({ remote, branch, setUpstream });
  if (classifyArgv(['git', ...argv]).level === 'critical') {
    return fail('That push was classified as a history-rewriting operation and VinaX will not run it.');
  }

  ctx.ui.step(`Pushing ${branch} to ${remote}`);
  const r = await git({ root: repo.root, signal: ctx.signal, timeoutMs: 180_000 }, argv);
  const out = redact(`${r.stdout}\n${r.stderr}`.trim());
  if (!r.ok) {
    ctx.ledger.pushes.push({ remote, branch, ok: false, detail: out.slice(0, 300) });
    if (/could not read Username|Authentication failed|Permission denied \(publickey\)|terminal prompts disabled|403/i.test(out)) {
      return fail(
        `The push FAILED: ${remote} rejected the credentials. VinaX uses your own Git authentication and never collects a password — check your credential helper or SSH key.\n\n${clip(out, 2000).text}`,
      );
    }
    if (/\[rejected\]|non-fast-forward|fetch first/i.test(out)) {
      return fail(
        `The push was REJECTED: ${remote}/${branch} has commits you do not have. Pull or rebase first — VinaX will not force push.\n\n${clip(out, 2000).text}`,
      );
    }
    return fail(`The push FAILED:\n${clip(out, 4000).text}`);
  }
  ctx.ledger.pushes.push({ remote, branch, ok: true, detail: out.slice(0, 300) });
  ctx.ui.step(`Pushed ${branch} to ${remote}`);
  return ok(`Pushed ${commits.length || 'the pending'} commit(s) to ${remote}/${branch}.\n\n${clip(out, 4000).text}`);
}
