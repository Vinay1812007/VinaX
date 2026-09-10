/**
 * End-to-end: the real compiled binary, a real broken project, a mock VinaX
 * agent server scripting the tool calls.
 *
 * This is the test that distinguishes a coding agent from a chat wrapper. The
 * server never touches the project. Everything that happens to those files —
 * reading them, running the failing test, patching the bug, rerunning until
 * it passes, committing — is the CLI doing it locally, and the assertions are
 * on the FILES and the EXIT CODE, not on the prose.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, gitRun, hasGit, initRepo, tempDir, writeFiles } from './helpers.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

interface Scripted {
  /** Prose the "model" says before its tool call. */
  say?: string;
  /** Tool calls to request this step. */
  calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  /** The final answer, when this is the last step. */
  final?: string;
}

interface ServerState {
  script: Scripted[];
  /** Everything the CLI sent back, so the test can prove what really ran. */
  received: Array<{ step: number; toolResults: Array<{ id: string; name: string; ok: boolean; content: string }> }>;
  requests: Array<Record<string, unknown>>;
}

let server: Server;
let port = 0;
let state: ServerState;

function sse(res: import('node:http').ServerResponse, events: Array<Record<string, unknown>>): void {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end();
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/api/vinaxcli/meta') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        service: 'VinaX CLI', protocol: 'vinax-cli/1', protocols: ['vinax-cli/1'],
        engines: [{ id: 'auto', label: 'VinaX AUTO', hint: '', acceptsModel: false, available: true }],
        catalogEndpoint: '/api/aimodels', tools: [], limits: { maxSteps: 80 }, web: { available: true },
        docs: 'https://www.sirimillavinay.online/VinaXAI/cli/docs',
      }));
      return;
    }
    if (req.url !== '/api/vinaxcli/agent') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body) as {
        step: number;
        toolResults: Array<{ id: string; name: string; ok: boolean; content: string }>;
      };
      state.requests.push(parsed as unknown as Record<string, unknown>);
      state.received.push({ step: parsed.step, toolResults: parsed.toolResults ?? [] });
      const plan = state.script[parsed.step - 1];
      const base = { seq: 0, runId: 'run_e2e', requestId: `req_${parsed.step}`, step: parsed.step };
      const events: Array<Record<string, unknown>> = [
        { type: 'hello', protocol: 'vinax-cli/1', maxSteps: 80, maxCallsPerStep: 6, ...base },
        { type: 'engine', engine: 'balanced', label: 'VinaX Balanced', model: 'test-model', web: false, ...base },
      ];
      if (!plan) {
        events.push({ type: 'assistant_delta', text: 'Done.', ...base });
        events.push({ type: 'done', reason: 'final', toolCalls: 0, ...base });
        sse(res, events);
        return;
      }
      if (plan.say) events.push({ type: 'assistant_delta', text: plan.say, ...base });
      if (plan.final) events.push({ type: 'assistant_delta', text: plan.final, ...base });
      let n = 0;
      for (const call of plan.calls ?? []) {
        n += 1;
        events.push({ type: 'tool_call', id: `call_${parsed.step}_${n}`, name: call.name, arguments: call.arguments, ...base });
      }
      events.push({ type: 'usage', inputTokens: 500, outputTokens: 40, ...base });
      events.push({
        type: 'done',
        reason: (plan.calls?.length ?? 0) > 0 ? 'tool_calls' : 'final',
        toolCalls: plan.calls?.length ?? 0,
        ...base,
      });
      sse(res, events);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;

  // The suite drives the built binary, so it must exist.
  await stat(CLI);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

let project = '';
let vinaxHome = '';

beforeEach(async () => {
  project = await tempDir('vinax-e2e-project-');
  vinaxHome = await tempDir('vinax-e2e-home-');
  state = { script: [], received: [], requests: [] };
});
afterEach(async () => {
  await cleanup(project);
  await cleanup(vinaxHome);
});

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { cwd?: string; apiBase?: string } = {}): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? project,
      env: {
        ...process.env,
        VINAX_API_BASE: opts.apiBase ?? `http://127.0.0.1:${port}`,
        VINAX_HOME: vinaxHome,
        NO_COLOR: '1',
        CI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

/** A project whose one test fails because of a real one-character bug. */
async function brokenProject(): Promise<void> {
  await writeFiles(project, {
    'package.json': JSON.stringify({ name: 'broken', version: '1.0.0', scripts: { test: 'node run-tests.js' } }, null, 2),
    'src/sum.js': 'function sum(a, b) {\n  return a - b;\n}\nmodule.exports = { sum };\n',
    'run-tests.js': [
      "const { sum } = require('./src/sum');",
      'const got = sum(2, 3);',
      'if (got !== 5) {',
      "  console.error('FAIL: sum(2, 3) returned ' + got + ', expected 5');",
      '  process.exit(1);',
      '}',
      "console.log('Tests 1 passed');",
      '',
    ].join('\n'),
  });
}

describe('the agent loop, end to end', () => {
  it('inspects, runs the failing test, patches, reruns until it passes, and reports', async () => {
    await brokenProject();
    state.script = [
      {
        say: 'Looking at the project.',
        calls: [
          { name: 'read_file', arguments: { path: 'package.json' } },
          { name: 'read_file', arguments: { path: 'run-tests.js' } },
        ],
      },
      { say: 'Running the tests.', calls: [{ name: 'run_command', arguments: { command: process.execPath, args: ['run-tests.js'] } }] },
      { say: 'Reading the source.', calls: [{ name: 'read_file', arguments: { path: 'src/sum.js' } }] },
      {
        say: 'Fixing the operator.',
        calls: [{ name: 'apply_patch', arguments: { path: 'src/sum.js', oldText: 'return a - b;', newText: 'return a + b;' } }],
      },
      { say: 'Running the tests again.', calls: [{ name: 'run_command', arguments: { command: process.execPath, args: ['run-tests.js'] } }] },
      { final: 'Fixed sum() — it subtracted instead of adding. All tests pass.' },
    ];

    const run = await runCli(['--full-auto', '-p', 'Find why the tests fail and fix them.']);

    // 1. The file on disk really changed.
    expect(await readFile(join(project, 'src/sum.js'), 'utf8')).toContain('return a + b;');

    // 2. The CLI actually ran the failing test and sent the REAL output back.
    const firstRun = state.received[2].toolResults.find((r) => r.name === 'run_command');
    expect(firstRun?.ok).toBe(false);
    expect(firstRun?.content).toContain('FAIL: sum(2, 3) returned -1');

    // 3. And the rerun really passed.
    const secondRun = state.received[5].toolResults.find((r) => r.name === 'run_command');
    expect(secondRun?.ok).toBe(true);
    expect(secondRun?.content).toContain('Tests 1 passed');

    // 4. The patch result came back as a success.
    const patch = state.received[4].toolResults.find((r) => r.name === 'apply_patch');
    expect(patch?.ok).toBe(true);

    // 5. Every tool call had a distinct id, and the journal never repeated one.
    const ids = state.received.flatMap((r) => r.toolResults.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);

    // 6. The run finished cleanly and said so.
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Fixed sum()');
    expect(run.stdout).toContain('src/sum.js');
  }, 60_000);

  it('sends the project context and instruction file with every step, and no system prompt', async () => {
    await brokenProject();
    await writeFile(join(project, 'VINAX.md'), '# Project rules\n\nAlways run `node run-tests.js` before committing.\n', 'utf8');
    state.script = [{ final: 'Understood.' }];
    await runCli(['-p', "what are this project's rules?"]);

    const req = state.requests[0] as {
      project: { instructions: string; context: string };
      messages: Array<{ role: string; content: string }>;
      protocol: string;
      client: { version: string; platform: string };
      system?: unknown;
    };
    expect(req.protocol).toBe('vinax-cli/1');
    expect(req.project.instructions).toContain('Always run `node run-tests.js`');
    expect(req.project.context).toContain('workspace root:');
    expect(req.project.context).toContain('project: Node.js');
    // The agent contract is server-owned: the client sends no system message.
    expect(req.system).toBeUndefined();
    expect(req.messages.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
    expect(req.client.version).toMatch(/^\d+\.\d+\.\d+$/);
  }, 60_000);

  it('REFUSES a write outside the workspace even in full-auto, and reports it', async () => {
    await brokenProject();
    state.script = [
      { calls: [{ name: 'write_file', arguments: { path: '../escaped.txt', content: 'should never exist' } }] },
      { final: 'Blocked.' },
    ];
    const run = await runCli(['--full-auto', '-p', 'write outside']);
    await expect(stat(join(project, '..', 'escaped.txt'))).rejects.toThrow();
    expect(run.code).toBe(4);
    expect(`${run.stdout}${run.stderr}`).toMatch(/outside the approved workspace|Denied/);
  }, 60_000);

  it('REFUSES to push in a non-interactive run, because nobody can approve it', async () => {
    if (!hasGit()) return;
    await brokenProject();
    await initRepo(project);
    gitRun(project, ['add', '.']);
    gitRun(project, ['commit', '-m', 'initial']);
    // A real (local, bare) remote, so the push genuinely COULD succeed and the
    // only thing stopping it is that nobody is there to approve it.
    const remote = join(project, '..', `remote-${Date.now()}.git`);
    gitRun(project, ['init', '--bare', remote]);
    gitRun(project, ['remote', 'add', 'origin', remote]);

    state.script = [
      { calls: [{ name: 'git_push', arguments: {} }] },
      { final: 'Could not push.' },
    ];
    const run = await runCli(['--full-auto', '-p', 'push this branch']);
    expect(run.code).toBe(4);
    expect(`${run.stdout}${run.stderr}`).toMatch(/approval|cannot ask/i);
    // And nothing reached the remote.
    expect(gitRun(project, ['ls-remote', '--heads', 'origin']).stdout.trim()).toBe('');
  }, 60_000);

  it('commits real changes and reports the real hash', async () => {
    if (!hasGit()) return;
    await brokenProject();
    await initRepo(project);
    gitRun(project, ['add', '.']);
    gitRun(project, ['commit', '-m', 'initial']);
    state.script = [
      { calls: [{ name: 'apply_patch', arguments: { path: 'src/sum.js', oldText: 'return a - b;', newText: 'return a + b;' } }] },
      { calls: [{ name: 'git_add', arguments: { paths: ['src/sum.js'] } }] },
      { calls: [{ name: 'git_commit', arguments: { message: 'fix: sum should add' } }] },
      { final: 'Committed.' },
    ];
    const run = await runCli(['--full-auto', '-p', 'fix and commit']);
    expect(run.code).toBe(0);
    const log = gitRun(project, ['log', '--oneline']).stdout;
    expect(log).toContain('fix: sum should add');
    const commitResult = state.received[3].toolResults.find((r) => r.name === 'git_commit');
    const hash = /Committed ([0-9a-f]{7,12})/.exec(commitResult?.content ?? '')?.[1];
    expect(hash).toBeTruthy();
    expect(gitRun(project, ['rev-parse', 'HEAD']).stdout).toContain(String(hash));
  }, 60_000);

  it('emits versioned JSONL on stdout in --json mode, and nothing else', async () => {
    await brokenProject();
    state.script = [
      { say: 'Reading.', calls: [{ name: 'read_file', arguments: { path: 'package.json' } }] },
      { final: 'It is a Node project.' },
    ];
    const run = await runCli(['--full-auto', '--json', '-p', 'what is this project?']);
    const lines = run.stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(3);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    for (const e of events) expect(e.v).toBe('vinax-cli-json/1');
    const types = events.map((e) => e.type);
    expect(types).toContain('engine');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('usage');
    expect(types).toContain('final');
    const toolCall = events.find((e) => e.type === 'tool_call') as { tool: string; id: string };
    expect(toolCall.tool).toBe('read_file');
    expect(typeof toolCall.id).toBe('string');
    const final = events.find((e) => e.type === 'final') as { text: string };
    expect(final.text).toContain('Node project');
    expect(run.code).toBe(0);
  }, 60_000);

  it('reports a permission refusal as a structured event in --json mode', async () => {
    await brokenProject();
    state.script = [
      { calls: [{ name: 'write_file', arguments: { path: '../nope.txt', content: 'x' } }] },
      { final: 'Blocked.' },
    ];
    const run = await runCli(['--full-auto', '--json', '-p', 'escape the workspace']);
    const events = run.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.some((e) => e.type === 'permission_required')).toBe(true);
    expect(run.code).toBe(4);
  }, 60_000);

  it('writes a resumable session transcript', async () => {
    await brokenProject();
    state.script = [
      { say: 'Reading.', calls: [{ name: 'read_file', arguments: { path: 'package.json' } }] },
      { final: 'It is a Node project called broken.' },
    ];
    await runCli(['--full-auto', '-p', 'what is this project called?']);
    const sessions = await runCli(['sessions']);
    expect(sessions.stdout).toContain('what is this project called?');
    expect(sessions.code).toBe(0);
  }, 60_000);

  it('stops at the step ceiling with the documented exit code, without looping forever', async () => {
    await brokenProject();
    // A server that always asks for another read: the CLI must stop itself.
    state.script = Array.from({ length: 10 }, () => ({
      calls: [{ name: 'read_file', arguments: { path: 'package.json' } }],
    }));
    const run = await runCli(['--full-auto', '--max-steps', '3', '-p', 'loop forever']);
    expect(run.code).toBe(5);
    expect(state.received.length).toBe(3);
    expect(`${run.stdout}${run.stderr}`).toContain('3 steps');
  }, 60_000);

  it('reports a service failure with the API exit code rather than a stack trace', async () => {
    await brokenProject();
    const run = await runCli(['-p', 'hello'], { apiBase: 'http://127.0.0.1:1' });
    expect(run.code).toBe(3);
    expect(run.stderr).not.toContain('    at ');
    expect(run.stderr.toLowerCase()).toMatch(/could not reach|refused|vinax service/);
  }, 60_000);
});

describe('the binary itself', () => {
  it('prints its version and help without needing a service', async () => {
    const v = await runCli(['--version']);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);

    const h = await runCli(['--help']);
    expect(h.code).toBe(0);
    expect(h.stdout).toContain('VinaX CLI');
    expect(h.stdout).toContain('--approval');
    expect(h.stdout).toContain('/VinaXAI/cli/docs');
  }, 30_000);

  it('exits with the usage code on a bad flag', async () => {
    const r = await runCli(['--mode', 'fast']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown option --mode');
  }, 30_000);

  it('refuses to sit and wait when there is no terminal to read from', async () => {
    const r = await runCli([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('no terminal');
  }, 30_000);

  it('emits no colour escape codes when NO_COLOR is set', async () => {
    await brokenProject();
    state.script = [{ final: 'Plain text only.' }];
    const r = await runCli(['-p', 'hello']);
    expect(r.stdout).not.toContain('\u001b[');
    expect(r.stderr).not.toContain('\u001b[');
  }, 30_000);
});
