/**
 * The `run_command` and `run_shell` tools.
 *
 * The split between them is a security boundary, not a convenience. A
 * structured call is an executable plus an argument array: nothing in it can
 * be reinterpreted as syntax. A shell line is a program in another language
 * that VinaX is about to hand to `sh`, so it is classified more suspiciously,
 * prompts more loudly, and can never be waved through by a session grant that
 * a structured command earned.
 */
import { stat } from 'node:fs/promises';
import { resolvePath } from '../../security/paths.js';
import { classifyArgv, classifyShell, programName } from '../../security/risk.js';
import { commandLabel, summarizeRun } from '../../agent/ledger.js';
import { isLongRunning, runProcess } from './runner.js';
import { argList, argNum, argStr, fail, ok, type ToolContext, type ToolResult } from '../types.js';

async function resolveCwd(ctx: ToolContext, raw: string): Promise<{ ok: true; cwd: string; display: string } | { ok: false; result: ToolResult }> {
  if (!raw) return { ok: true, cwd: ctx.ws.root, display: '.' };
  const r = await resolvePath(ctx.ws, raw);
  if (!r.ok) {
    return { ok: false, result: { ...fail(`Cannot run there: ${r.detail}`), permissionDenied: true } };
  }
  const st = await stat(r.path).catch(() => null);
  if (!st?.isDirectory()) return { ok: false, result: fail(`${r.display} is not a directory.`) };
  return { ok: true, cwd: r.path, display: r.display };
}

function describe(result: Awaited<ReturnType<typeof runProcess>>, label: string): ToolResult {
  if (result.spawnError) {
    const missing = /ENOENT/.test(result.spawnError);
    return fail(
      missing
        ? `Could not run "${label}": the executable was not found on this machine. Check it is installed and on PATH.`
        : `Could not run "${label}": ${result.spawnError}`,
    );
  }
  if (result.aborted) {
    return fail(`"${label}" was interrupted by the user after ${(result.ms / 1000).toFixed(1)}s.\n\nOutput so far:\n${result.output}`);
  }
  if (result.timedOut) {
    return fail(
      `"${label}" was still running after ${(result.ms / 1000).toFixed(0)}s and was stopped, along with everything it had started.\n\nOutput before the timeout:\n${result.output}`,
    );
  }
  const head = `exit ${result.exitCode ?? 'none'}${result.signal ? ` (${result.signal})` : ''} in ${(result.ms / 1000).toFixed(1)}s${result.truncated ? ', output truncated' : ''}`;
  const body = result.output || '(no output)';
  return result.exitCode === 0 ? ok(`${head}\n\n${body}`) : fail(`${head}\n\n${body}`);
}

export async function runCommandTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const command = argStr(args, 'command').trim();
  if (!command) return fail('run_command needs a command.');
  // A "command" containing shell syntax is a shell line wearing a disguise,
  // and letting it through would route around the stricter shell prompt.
  if (/[;&|><`$\n]/.test(command)) {
    return fail('run_command takes an executable name and an argument array. For pipes or shell syntax, use run_shell — which asks the user for a stricter approval.');
  }
  const argv = argList(args, 'args');
  const cwdR = await resolveCwd(ctx, argStr(args, 'cwd'));
  if (!cwdR.ok) return cwdR.result;

  const risk = classifyArgv([command, ...argv]);
  const label = commandLabel(command, argv);
  const decision = await ctx.permissions.check({
    kind: 'execute',
    title: 'Run command?',
    detail: [
      `  ${label}`,
      '',
      `Working directory:`,
      `  ${cwdR.cwd}`,
      ...(risk.reason ? ['', risk.reason] : []),
      ...(isLongRunning(command, argv) ? ['', 'This looks like a long-running process. Ctrl+C stops it and returns to VinaX.'] : []),
    ],
    risk: risk.level,
    scopeKey: `run:${programName(command)}`,
    scopeLabel: `Allow ${programName(command)} commands this session`,
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  ctx.ledger.setState(/\b(test|spec|vitest|jest|pytest)\b/i.test(label) ? 'Testing' : 'Running command');
  ctx.ui.step(`Running ${label}`);
  const result = await runProcess({
    command,
    args: argv,
    cwd: cwdR.cwd,
    timeoutMs: Math.min(argNum(args, 'timeoutMs', ctx.config.commandTimeoutMs), 900_000),
    maxOutputChars: ctx.config.maxOutputChars,
    shell: false,
    signal: ctx.signal,
    onOutput: (chunk, source) => ctx.ui.stream(chunk, source),
  });
  ctx.ledger.recordCommand({
    command: label,
    exitCode: result.exitCode,
    ms: result.ms,
    summary: summarizeRun(result.exitCode, `${result.stdout}\n${result.stderr}`),
  });
  return describe(result, label);
}

export async function runShellTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const line = argStr(args, 'command').trim();
  if (!line) return fail('run_shell needs a command line.');
  const cwdR = await resolveCwd(ctx, argStr(args, 'cwd'));
  if (!cwdR.ok) return cwdR.result;

  const risk = classifyShell(line);
  const decision = await ctx.permissions.check({
    kind: 'shell',
    title: 'Run this shell command?',
    detail: [
      `  ${line}`,
      '',
      'Working directory:',
      `  ${cwdR.cwd}`,
      '',
      risk.reason ?? 'A shell line can do anything the shell can do.',
    ],
    // A shell line is never "routine" for grant purposes: the elevated floor
    // is what keeps auto-edit from running arbitrary shell unattended.
    risk: risk.level === 'routine' ? 'routine' : risk.level,
    scopeKey: risk.level === 'critical' ? `shell-critical:${line}` : 'shell:any',
    scopeLabel: 'Allow shell commands this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  ctx.ledger.setState('Running command');
  const label = commandLabel(line);
  ctx.ui.step(`Running ${label}`);
  const result = await runProcess({
    command: line,
    args: [],
    cwd: cwdR.cwd,
    timeoutMs: Math.min(argNum(args, 'timeoutMs', ctx.config.commandTimeoutMs), 900_000),
    maxOutputChars: ctx.config.maxOutputChars,
    shell: true,
    signal: ctx.signal,
    onOutput: (chunk, source) => ctx.ui.stream(chunk, source),
  });
  ctx.ledger.recordCommand({
    command: label,
    exitCode: result.exitCode,
    ms: result.ms,
    summary: summarizeRun(result.exitCode, `${result.stdout}\n${result.stderr}`),
  });
  return describe(result, label);
}
