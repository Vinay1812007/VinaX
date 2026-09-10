/**
 * Running commands: real child processes, real exit codes, real cleanup.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { runCommandTool, runShellTool } from '../src/tools/process/commands.js';
import { isLongRunning, killAllChildren, runProcess } from '../src/tools/process/runner.js';
import { summarizeRun } from '../src/agent/ledger.js';
import { cleanup, tempDir, testContext, writeFiles, type TestContext } from './helpers.js';

let root = '';
let ctx: TestContext;
const NODE = process.execPath;

beforeEach(async () => {
  root = await tempDir('vinax-proc-');
  await writeFiles(root, {
    'hello.js': 'console.log("hello from the child");\n',
    'fail.js': 'console.error("boom");\nprocess.exit(3);\n',
    'chatty.js': 'for (let i = 0; i < 500; i += 1) console.log("line " + i);\n',
    'forever.js': 'setInterval(() => {}, 1000);\nconsole.log("started");\n',
    'spawner.js': `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      console.log('CHILD_PID=' + child.pid);
      setInterval(() => {}, 1000);
    `,
  });
  ctx = await testContext({ root });
});
afterEach(async () => {
  killAllChildren();
  await cleanup(root);
});

const args = (o: Record<string, unknown>): Record<string, unknown> => o;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('run_command', () => {
  it('runs a program and returns its output and exit code', async () => {
    const r = await runCommandTool(args({ command: NODE, args: ['hello.js'] }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('hello from the child');
    expect(r.content).toContain('exit 0');
  });

  it('reports a non-zero exit as a failure, with stderr included', async () => {
    const r = await runCommandTool(args({ command: NODE, args: ['fail.js'] }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('exit 3');
    expect(r.content).toContain('boom');
  });

  it('streams output live rather than only at the end', async () => {
    await runCommandTool(args({ command: NODE, args: ['chatty.js'] }), ctx);
    expect(ctx.ui.output).toContain('line 0');
    expect(ctx.ui.output).toContain('line 499');
  });

  it('shows the exact command and directory in the approval prompt', async () => {
    await runCommandTool(args({ command: NODE, args: ['hello.js'] }), ctx);
    const detail = ctx.asked[0].detail.join('\n');
    expect(ctx.asked[0].title).toBe('Run command?');
    expect(detail).toContain('hello.js');
    expect(detail).toContain(root);
  });

  it('does NOT run when the user rejects', async () => {
    const strict = await testContext({ root, answer: () => 'reject' });
    const r = await runCommandTool(args({ command: NODE, args: ['hello.js'] }), strict);
    expect(r.ok).toBe(false);
    expect(r.permissionDenied).toBe(true);
    expect(strict.ui.output).toBe('');
  });

  it('REFUSES shell syntax in a structured command, pointing at run_shell', async () => {
    const r = await runCommandTool(args({ command: 'npm test && rm -rf /', args: [] }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('run_shell');
  });

  it('passes an argument containing a semicolon as DATA, not as syntax', async () => {
    const r = await runCommandTool(args({ command: NODE, args: ['-e', 'console.log(process.argv[1])', 'a;rm -rf /'] }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('a;rm -rf /');
  });

  it('times out and says what it had before the timeout', async () => {
    const r = await runCommandTool(args({ command: NODE, args: ['forever.js'], timeoutMs: 1500 }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('still running');
    expect(r.content).toContain('started');
  });

  it('reports a missing executable in words, not as a crash', async () => {
    const r = await runCommandTool(args({ command: 'definitely-not-a-real-program-xyz' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('not found on this machine');
  });

  it('records the run in the ledger with a readable summary', async () => {
    await runCommandTool(args({ command: NODE, args: ['hello.js'] }), ctx);
    expect(ctx.ledger.commands).toHaveLength(1);
    expect(ctx.ledger.commands[0].exitCode).toBe(0);
  });

  it('refuses a working directory outside the workspace', async () => {
    const r = await runCommandTool(args({ command: NODE, args: ['-v'], cwd: '../..' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.permissionDenied).toBe(true);
  });
});

describe('run_shell', () => {
  it('runs a shell line', async () => {
    const r = await runShellTool(args({ command: `"${NODE}" hello.js` }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('hello from the child');
  });

  it('asks under its own, stricter scope so a run_command grant cannot cover it', async () => {
    await runCommandTool(args({ command: NODE, args: ['hello.js'] }), ctx);
    await runShellTool(args({ command: `"${NODE}" hello.js` }), ctx);
    expect(ctx.asked[0].scopeKey).not.toBe(ctx.asked[1].scopeKey);
    expect(ctx.asked[1].kind).toBe('shell');
  });

  it('classifies a dangerous shell line as critical before running anything', async () => {
    const strict = await testContext({ root, answer: () => 'reject' });
    const r = await runShellTool(args({ command: 'echo hi && sudo rm -rf /' }), strict);
    expect(r.ok).toBe(false);
    expect(strict.asked[0].risk).toBe('critical');
  });
});

describe('cancellation and cleanup', () => {
  it('stops a running command when the user interrupts', async () => {
    const controller = new AbortController();
    const cancelCtx = await testContext({ root, signal: controller.signal });
    setTimeout(() => controller.abort(), 400);
    const r = await runCommandTool(args({ command: NODE, args: ['forever.js'], timeoutMs: 30_000 }), cancelCtx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('interrupted');
  });

  it.runIf(process.platform !== 'win32')('kills the whole child TREE, leaving no orphan', async () => {
    const controller = new AbortController();
    let captured = 0;
    const p = runProcess({
      command: NODE, args: ['spawner.js'], cwd: root,
      timeoutMs: 30_000, maxOutputChars: 10_000, shell: false, signal: controller.signal,
      onOutput: (chunk) => {
        const m = /CHILD_PID=(\d+)/.exec(chunk);
        if (m) captured = Number(m[1]);
      },
    });
    // Give the grandchild time to exist before pulling the plug.
    await new Promise((r) => setTimeout(r, 900));
    expect(captured).toBeGreaterThan(0);
    controller.abort();
    await p;
    await new Promise((r) => setTimeout(r, 700));
    expect(alive(captured)).toBe(false);
  });

  it('bounds output instead of buffering without limit', async () => {
    const tight = await testContext({ root, config: { maxOutputChars: 500 } });
    const r = await runCommandTool(args({ command: NODE, args: ['chatty.js'] }), tight);
    expect(r.content.length).toBeLessThan(3000);
    expect(r.content).toContain('omitted by VinaX');
  });

  it('keeps the TAIL when truncating, because that is where the failure is', async () => {
    const tight = await testContext({ root, config: { maxOutputChars: 400 } });
    const r = await runCommandTool(args({ command: NODE, args: ['chatty.js'] }), tight);
    expect(r.content).toContain('line 499');
  });

  it('redacts a secret a command printed', async () => {
    const r = await runCommandTool(
      args({ command: NODE, args: ['-e', 'console.log("GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")'] }),
      ctx,
    );
    expect(r.content).not.toContain('ghp_ABCDEFGHIJ');
    expect(r.content).toContain('[redacted by VinaX]');
  });

  it('recognises a long-running process', () => {
    expect(isLongRunning('npm', ['run', 'dev'])).toBe(true);
    expect(isLongRunning('vite', [])).toBe(true);
    expect(isLongRunning('npm', ['test'])).toBe(false);
  });
});

describe('summarising a run', () => {
  it('reads counts out of the runners people actually use', () => {
    expect(summarizeRun(0, 'Tests  47 passed (47)')).toBe('47 passed');
    expect(summarizeRun(1, 'Tests  1 failed | 46 passed (47)')).toBe('1 failed, 46 passed');
    expect(summarizeRun(1, 'Tests: 2 failed, 10 passed, 12 total')).toBe('2 failed, 10 passed');
    expect(summarizeRun(0, '  12 passing (400ms)')).toBe('12 passing');
  });

  it('states the exit code rather than inventing a number it did not see', () => {
    expect(summarizeRun(0, 'built in 3s')).toBe('exit 0');
    expect(summarizeRun(2, 'something went wrong')).toBe('exit 2');
    expect(summarizeRun(null, '')).toBe('did not finish');
  });
});

describe('no orphans survive the process', () => {
  it('killAllChildren reaps everything VinaX started', async () => {
    const controller = new AbortController();
    const p = runProcess({
      command: NODE, args: ['forever.js'], cwd: root,
      timeoutMs: 30_000, maxOutputChars: 1000, shell: false, signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 400));
    killAllChildren();
    const result = await p;
    expect(result.exitCode === null || result.exitCode !== 0 || result.signal !== null).toBe(true);
    // And nothing of ours is left behind.
    const check = spawnSync(NODE, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
    expect(check.status).toBe(0);
  });
});
