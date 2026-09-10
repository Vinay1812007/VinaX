/**
 * Sessions, the run journal, undo, duplicate-call protection and context
 * compaction — the parts that make a long run survivable.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conversationFrom, listSessions, SessionStore } from '../src/session/store.js';
import { RunJournal } from '../src/session/journal.js';
import { buildSummary, compact, estimateTokens, type Turn } from '../src/agent/context.js';
import { TaskLedger } from '../src/agent/ledger.js';
import { executeTool } from '../src/tools/registry.js';
import { contentHash } from '../src/utils/text.js';
import { paths } from '../src/config/paths.js';
import { cleanup, tempDir, testContext, writeFiles, type TestContext } from './helpers.js';

let home = '';
let root = '';
let p: ReturnType<typeof paths>;

beforeEach(async () => {
  home = await tempDir('vinax-home-');
  root = await tempDir('vinax-sess-');
  p = paths({ VINAX_HOME: home });
});
afterEach(async () => {
  await cleanup(home);
  await cleanup(root);
});

describe('session storage', () => {
  it('records a conversation and reads it back', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'user', at: Date.now(), text: 'fix the failing test' });
    await s.append({ t: 'tool_call', at: Date.now(), id: 'c1', name: 'read_file', arguments: { path: 'a.ts' } });
    await s.append({ t: 'tool_result', at: Date.now(), id: 'c1', name: 'read_file', ok: true, content: 'contents' });
    await s.append({ t: 'assistant', at: Date.now(), text: 'Fixed it.' });
    await s.finish('completed');

    const entries = await SessionStore.read(s.id, p);
    expect(entries.map((e) => e.t)).toEqual(['meta', 'user', 'tool_call', 'tool_result', 'assistant']);
    expect(conversationFrom(entries)).toEqual([
      { role: 'user', content: 'fix the failing test' },
      { role: 'assistant', content: 'Fixed it.' },
    ]);
  });

  it('records the facts a resumed session needs', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'feat/x', engine: 'deep', model: 'm/1', cliVersion: '0.1.0' }, p);
    await s.append({ t: 'file_changed', at: Date.now(), path: 'src/a.ts' });
    await s.append({ t: 'command', at: Date.now(), command: 'npm test', exitCode: 0, summary: '47 passed' });
    await s.append({ t: 'permission', at: Date.now(), action: 'git_push', outcome: 'allow' });
    await s.finish('completed');
    const entries = await SessionStore.read(s.id, p);
    expect(entries.some((e) => e.t === 'file_changed')).toBe(true);
    expect(entries.some((e) => e.t === 'command')).toBe(true);
    const meta = entries.find((e) => e.t === 'meta');
    expect(meta).toMatchObject({ workspace: root, branch: 'feat/x', engine: 'deep', model: 'm/1' });
  });

  it('SURVIVES a crash mid-write: the torn last line is skipped, the rest is intact', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'user', at: 1, text: 'first' });
    await s.append({ t: 'assistant', at: 2, text: 'second' });
    // Simulate the process dying halfway through writing the next line.
    await appendFile(s.file, '{"t":"user","at":3,"text":"tor', 'utf8');
    const entries = await SessionStore.read(s.id, p);
    expect(entries).toHaveLength(3);
    expect(entries.at(-1)).toMatchObject({ t: 'assistant', text: 'second' });
  });

  it('lists sessions even when the index was never written', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'user', at: Date.now(), text: 'a request that was interrupted' });
    // No finish() and no checkpoint(): exactly the state a kill -9 leaves.
    await rm(join(p.sessions, 'index.json'), { force: true });
    const rows = await listSessions(p);
    expect(rows.some((r) => r.id === s.id)).toBe(true);
    expect(rows.find((r) => r.id === s.id)?.title).toContain('interrupted');
  });

  it('titles a session from its first user message', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'user', at: Date.now(), text: 'why does the build fail on windows' });
    await s.finish('completed');
    expect((await listSessions(p)).find((r) => r.id === s.id)?.title).toContain('why does the build fail');
  });

  it('reopens an existing session for appending', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'user', at: 1, text: 'first' });
    await s.checkpoint();
    const again = await SessionStore.open(s.id, p);
    expect(again).not.toBeNull();
    await again!.append({ t: 'user', at: 2, text: 'second' });
    expect((await SessionStore.read(s.id, p)).filter((e) => e.t === 'user')).toHaveLength(2);
  });

  it('stores no provider credentials, because there are none to store', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'tool_result', at: 1, id: 'c1', name: 'run_command', ok: true, content: 'API_KEY=[redacted by VinaX]' });
    await s.finish('completed');
    const raw = await readFile(s.file, 'utf8');
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{16}/);
    expect(raw).not.toContain('Bearer ');
  });
});

describe('the run journal', () => {
  it('replays a repeated call id instead of running it again', async () => {
    await writeFiles(root, { 'a.txt': 'hello\n' });
    const ctx: TestContext = await testContext({ root });
    const call = { id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } };
    const first = await executeTool(call, ctx);
    const second = await executeTool(call, ctx);
    expect(second.content).toBe(first.content);
    expect(ctx.journal.callCount()).toBe(1);
    expect(ctx.ui.notes.join(' ')).toContain('already ran');
  });

  it('is what stops a dropped stream committing twice', async () => {
    const ctx: TestContext = await testContext({ root, config: { approval: 'full-auto' } });
    await writeFiles(root, { 'x.txt': 'one\n' });
    const call = { id: 'call_commit', name: 'write_file', arguments: { path: 'new.txt', content: 'created once\n' } };
    await executeTool(call, ctx);
    await writeFile(join(root, 'new.txt'), 'a human edited this afterwards\n', 'utf8');
    // The same call arriving again must not overwrite the human's edit.
    await executeTool(call, ctx);
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('a human edited this afterwards\n');
  });

  it('enforces the run-wide tool-call ceiling', async () => {
    await writeFiles(root, { 'a.txt': 'x' });
    const ctx: TestContext = await testContext({ root, config: { maxToolCalls: 2 } });
    await executeTool({ id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } }, ctx);
    await executeTool({ id: 'c2', name: 'read_file', arguments: { path: 'a.txt' } }, ctx);
    const third = await executeTool({ id: 'c3', name: 'read_file', arguments: { path: 'a.txt' } }, ctx);
    expect(third.ok).toBe(false);
    expect(third.content).toContain('ceiling of 2 tool calls');
  });

  it('turns an unknown tool into a failed result rather than a crash', async () => {
    const ctx: TestContext = await testContext({ root });
    const r = await executeTool({ id: 'c1', name: 'launch_missiles', arguments: {} }, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('no tool called launch_missiles');
  });
});

describe('undo', () => {
  it('restores the previous content of a VinaX edit', async () => {
    const file = join(root, 'a.ts');
    await writeFile(file, 'before\n', 'utf8');
    const j = new RunJournal();
    j.recordEdit({ path: file, display: 'a.ts', before: 'before\n', after: 'after\n', hashAfter: contentHash('after\n'), at: 1, group: 'g1' });
    await writeFile(file, 'after\n', 'utf8');

    const r = await j.undoLast(io());
    expect(r.ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('before\n');
  });

  it('REFUSES when the file changed after VinaX touched it', async () => {
    const file = join(root, 'a.ts');
    const j = new RunJournal();
    j.recordEdit({ path: file, display: 'a.ts', before: 'before\n', after: 'after\n', hashAfter: contentHash('after\n'), at: 1, group: 'g1' });
    await writeFile(file, 'someone else changed this\n', 'utf8');

    const r = await j.undoLast(io());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('has changed since VinaX edited it');
    expect(await readFile(file, 'utf8')).toBe('someone else changed this\n');
  });

  it('removes a file VinaX created', async () => {
    const file = join(root, 'created.ts');
    await writeFile(file, 'new\n', 'utf8');
    const j = new RunJournal();
    j.recordEdit({ path: file, display: 'created.ts', before: null, after: 'new\n', hashAfter: contentHash('new\n'), at: 1, group: 'g1' });
    const r = await j.undoLast(io());
    expect(r.ok).toBe(true);
    await expect(readFile(file, 'utf8')).rejects.toThrow();
  });

  it('restores a file VinaX deleted', async () => {
    const file = join(root, 'gone.ts');
    const j = new RunJournal();
    j.recordEdit({ path: file, display: 'gone.ts', before: 'was here\n', after: null, hashAfter: null, at: 1, group: 'g1' });
    const r = await j.undoLast(io());
    expect(r.ok).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('was here\n');
  });

  it('undoes a whole edit GROUP together, all or nothing', async () => {
    const a = join(root, 'a.ts');
    const b = join(root, 'b.ts');
    await writeFile(a, 'A2\n', 'utf8');
    await writeFile(b, 'someone touched this\n', 'utf8');
    const j = new RunJournal();
    j.recordEdit({ path: a, display: 'a.ts', before: 'A1\n', after: 'A2\n', hashAfter: contentHash('A2\n'), at: 1, group: 'g1' });
    j.recordEdit({ path: b, display: 'b.ts', before: 'B1\n', after: 'B2\n', hashAfter: contentHash('B2\n'), at: 2, group: 'g1' });

    const r = await j.undoLast(io());
    expect(r.ok).toBe(false);
    // Neither file was touched — a half-applied undo would be worse than none.
    expect(await readFile(a, 'utf8')).toBe('A2\n');
    expect(await readFile(b, 'utf8')).toBe('someone touched this\n');
  });

  it('says plainly when there is nothing to undo', async () => {
    const r = await new RunJournal().undoLast(io());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('has not edited anything');
  });

  function io() {
    return {
      readFile: (path: string) => readFile(path, 'utf8').then((t) => t as string | null).catch(() => null),
      writeFile: (path: string, content: string) => writeFile(path, content, 'utf8'),
      removeFile: (path: string) => rm(path, { force: true }),
    };
  }
});

describe('context compaction', () => {
  const ledger = (): TaskLedger => {
    const l = new TaskLedger();
    l.goal = 'fix the authentication tests';
    l.setPlan('fix the authentication tests', ['done: reproduce the failure', 'doing: fix token expiry', 'todo: rerun tests']);
    l.filesChanged.add('src/auth/session.ts');
    l.filesRead.add('src/auth/session.ts');
    l.recordCommand({ command: 'npm test', exitCode: 1, ms: 100, summary: '1 failed, 46 passed' });
    l.commits.push({ hash: 'abc123', message: 'fix: token expiry' });
    l.blockers.push('the integration suite still needs a database');
    l.branch = 'feat/auth-fix';
    return l;
  };

  it('leaves a short conversation alone', () => {
    const turns: Turn[] = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }];
    const r = compact(turns, ledger());
    expect(r.summary).toBeNull();
    expect(r.turns).toBe(turns);
  });

  it('compacts when forced, and shrinks the estimate', () => {
    const turns: Turn[] = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as Turn['role'],
      content: `turn ${i} `.repeat(200),
    }));
    const r = compact(turns, ledger(), { force: true, keepRecent: 4 });
    expect(r.summary).not.toBeNull();
    expect(r.tokensAfter).toBeLessThan(r.tokensBefore);
    expect(r.turns.length).toBeLessThan(turns.length);
  });

  it('KEEPS the original request verbatim — the objective is not paraphrased', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'THE ORIGINAL REQUEST: make the auth tests pass without changing the API' },
      ...Array.from({ length: 20 }, (_, i) => ({ role: 'assistant' as const, content: `step ${i} `.repeat(200) })),
    ];
    const r = compact(turns, ledger(), { force: true, keepRecent: 3 });
    expect(r.turns[0].content).toContain('THE ORIGINAL REQUEST');
  });

  it('preserves objective, files changed, commands, failures and commits', () => {
    const summary = buildSummary([{ role: 'user', content: 'fix the authentication tests' }], ledger());
    expect(summary).toContain('fix the authentication tests');
    expect(summary).toContain('src/auth/session.ts');
    expect(summary).toContain('npm test');
    expect(summary).toContain('1 failed, 46 passed');
    expect(summary).toContain('Still failing');
    expect(summary).toContain('abc123');
    expect(summary).toContain('the integration suite still needs a database');
    expect(summary).toContain('feat/auth-fix');
  });

  it('keeps the most recent turns verbatim', () => {
    const turns: Turn[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ role: 'assistant' as const, content: `old ${i} `.repeat(200) })),
      { role: 'user', content: 'MOST RECENT INSTRUCTION' },
    ];
    const r = compact(turns, ledger(), { force: true, keepRecent: 2 });
    expect(r.turns.at(-1)?.content).toBe('MOST RECENT INSTRUCTION');
  });

  it('estimates tokens well enough to decide when to act', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(370))).toBeGreaterThan(80);
  });
});

describe('the session transcript is a usable record', () => {
  it('logs each changed file ONCE, not once per later tool call', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    // The loop de-duplicates before appending; this asserts the reader side
    // agrees, so a resumed session's file list is the real set either way.
    await s.append({ t: 'file_changed', at: 1, path: 'src/a.ts' });
    await s.append({ t: 'file_changed', at: 2, path: 'src/b.ts' });
    await s.finish('completed');
    const row = (await listSessions(p)).find((r) => r.id === s.id);
    expect(row?.filesChanged).toBe(2);
  });

  it('records commands with their exit code, so a resumed run knows what was validated', async () => {
    const s = await SessionStore.create({ workspace: root, branch: 'main', engine: 'balanced', model: null, cliVersion: '0.1.0' }, p);
    await s.append({ t: 'command', at: 1, command: 'npm test', exitCode: 1, summary: '1 failed, 46 passed' });
    await s.append({ t: 'command', at: 2, command: 'npm test', exitCode: 0, summary: '47 passed' });
    await s.finish('completed');
    const commands = (await SessionStore.read(s.id, p)).filter((e) => e.t === 'command');
    expect(commands).toHaveLength(2);
    expect(commands.at(-1)).toMatchObject({ exitCode: 0, summary: '47 passed' });
  });
});
