/**
 * `vinax doctor` — is this machine set up to run VinaX CLI?
 *
 * Every check answers a question a user might otherwise have to guess at, and
 * every failure says what to do about it. Nothing here prints a secret: not a
 * key, not a token, not an environment value — the checks report presence and
 * reachability, never contents.
 */
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { runProcess } from '../tools/process/runner.js';
import { paths } from '../config/paths.js';
import { detectTheme, glyphs, paint, type Theme } from '../terminal/render.js';
import { CLI_VERSION } from '../version.js';
import { PROTOCOL } from '../protocol/events.js';
import type { VinaxApi } from '../api/client.js';
import type { VinaxConfig } from '../config/config.js';
import type { Workspace } from '../security/paths.js';
import type { Discovery } from '../context/discovery.js';
import type { McpRegistry } from '../tools/mcp/client.js';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  /** What to do about it, when there is something to do. */
  fix?: string;
}

export interface DoctorDeps {
  api: VinaxApi;
  config: VinaxConfig;
  ws: Workspace;
  discovery: Discovery;
  mcp: McpRegistry | null;
  signal: AbortSignal;
}

async function checkNode(): Promise<Check> {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= 22) {
    return { name: 'Node.js', status: 'ok', detail: `v${process.versions.node}` };
  }
  return {
    name: 'Node.js',
    status: 'fail',
    detail: `v${process.versions.node} — VinaX CLI needs Node 22 or newer`,
    fix: 'Install Node 22+ (nodejs.org, nvm, or your package manager) and run vinax again.',
  };
}

async function checkGit(signal: AbortSignal): Promise<Check[]> {
  const r = await runProcess({
    command: 'git', args: ['--version'], cwd: process.cwd(),
    timeoutMs: 10_000, maxOutputChars: 2000, shell: false, signal,
  });
  if (r.spawnError || r.exitCode !== 0) {
    return [{
      name: 'Git',
      status: 'warn',
      detail: 'not found on PATH',
      fix: 'Install Git if you want VinaX to read diffs, commit or push. Everything else works without it.',
    }];
  }
  return [{ name: 'Git', status: 'ok', detail: r.stdout.trim() || 'available' }];
}

async function checkApi(deps: DoctorDeps): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const meta = await deps.api.meta(deps.signal);
    out.push({ name: 'VinaX service', status: 'ok', detail: `${deps.api.apiBase} reachable` });
    const compatible = meta.protocols.includes(PROTOCOL);
    out.push({
      name: 'Protocol',
      status: compatible ? 'ok' : 'fail',
      detail: compatible
        ? `${PROTOCOL} supported`
        : `this CLI speaks ${PROTOCOL}; the service speaks ${meta.protocols.join(', ')}`,
      ...(compatible ? {} : { fix: 'Update VinaX CLI to a version that matches the service.' }),
    });
    const available = meta.engines.filter((e) => e.available);
    out.push({
      name: 'Engines',
      status: available.length ? 'ok' : 'fail',
      detail: available.length
        ? `${available.length} of ${meta.engines.length} available`
        : 'no engine is currently configured on the service',
      ...(available.length ? {} : { fix: 'This is a service-side problem, not a local one. Try again shortly.' }),
    });
    const wanted = meta.engines.find((e) => e.id === deps.config.engine);
    if (deps.config.engine !== 'auto' && wanted && !wanted.available) {
      out.push({
        name: 'Chosen engine',
        status: 'warn',
        detail: `${wanted.label} is not available right now`,
        fix: 'Use --engine auto, or pick another from vinax models.',
      });
    }
  } catch (e) {
    out.push({
      name: 'VinaX service',
      status: 'fail',
      detail: `${deps.api.apiBase} — ${e instanceof Error ? e.message : String(e)}`,
      fix: 'Check your network. For local development, point VINAX_API_BASE at your wrangler dev server.',
    });
  }
  return out;
}

async function checkWorkspace(deps: DoctorDeps): Promise<Check[]> {
  const out: Check[] = [];
  try {
    await access(deps.ws.root, constants.R_OK | constants.W_OK);
    out.push({
      name: 'Workspace',
      status: 'ok',
      detail: `${deps.ws.root}${deps.ws.roots.length > 1 ? ` (+${deps.ws.roots.length - 1} extra root)` : ''}`,
    });
  } catch {
    out.push({
      name: 'Workspace',
      status: 'fail',
      detail: `${deps.ws.root} is not readable and writable`,
      fix: 'Run VinaX from a directory you own, or fix the permissions on that path.',
    });
  }
  out.push({
    name: 'Repository',
    status: 'ok',
    detail: deps.discovery.isGitRepo
      ? `git repository on ${deps.discovery.branch || 'a detached HEAD'}`
      : 'not a git repository — VinaX will work in this directory without version control',
  });
  return out;
}

async function checkConfig(): Promise<Check[]> {
  const p = paths();
  const out: Check[] = [];
  try {
    const st = await stat(p.home);
    if (!st.isDirectory()) throw new Error('not a directory');
    out.push({ name: 'Config directory', status: 'ok', detail: p.home });
  } catch {
    out.push({ name: 'Config directory', status: 'ok', detail: `${p.home} (will be created on first use)` });
  }
  try {
    await stat(p.sessions);
    out.push({ name: 'Sessions', status: 'ok', detail: p.sessions });
  } catch {
    out.push({ name: 'Sessions', status: 'ok', detail: `${p.sessions} (will be created on first use)` });
  }
  return out;
}

function checkTerminal(): Check {
  const theme = detectTheme();
  const bits = [
    process.stdout.isTTY ? 'interactive' : 'not a terminal (prompts are unavailable)',
    theme.color ? 'colour' : 'no colour',
    `${theme.width} columns`,
  ];
  return { name: 'Terminal', status: 'ok', detail: bits.join(', ') };
}

async function checkRepoHostCli(signal: AbortSignal): Promise<Check> {
  const r = await runProcess({
    command: 'gh', args: ['auth', 'status'], cwd: process.cwd(),
    timeoutMs: 10_000, maxOutputChars: 4000, shell: false, signal,
  });
  if (r.spawnError) {
    return {
      name: 'Repository host CLI',
      status: 'ok',
      detail: 'not installed — pull requests and CI checks are unavailable',
      fix: 'Install and authenticate your repository host\'s CLI if you want VinaX to open pull requests for you.',
    };
  }
  if (r.exitCode !== 0) {
    return {
      name: 'Repository host CLI',
      status: 'warn',
      detail: 'installed but not authenticated',
      fix: 'Authenticate it yourself in a terminal. VinaX never logs in on your behalf.',
    };
  }
  return { name: 'Repository host CLI', status: 'ok', detail: 'installed and authenticated' };
}

function checkMcp(mcp: McpRegistry | null): Check {
  if (!mcp) return { name: 'MCP servers', status: 'ok', detail: 'none configured' };
  const tools = mcp.tools();
  return {
    name: 'MCP servers',
    status: 'ok',
    detail: tools.length ? `${new Set(tools.map((t) => t.server)).size} connected, ${tools.length} tools` : 'configured, none serving tools',
  };
}

export async function runDoctorChecks(deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [
    { name: 'VinaX CLI', status: 'ok', detail: `v${CLI_VERSION}` },
    await checkNode(),
  ];
  checks.push(...(await checkApi(deps)));
  checks.push(...(await checkGit(deps.signal)));
  checks.push(...(await checkWorkspace(deps)));
  checks.push(...(await checkConfig()));
  checks.push(checkTerminal());
  checks.push(await checkRepoHostCli(deps.signal));
  checks.push(checkMcp(deps.mcp));
  return checks;
}

export function renderDoctor(checks: Check[], theme: Theme): string {
  const g = glyphs(theme);
  const width = Math.max(...checks.map((c) => c.name.length));
  const lines: string[] = ['', paint(theme, 'bold', 'VinaX CLI — local setup'), ''];
  for (const c of checks) {
    const mark = c.status === 'ok' ? paint(theme, 'green', g.ok) : c.status === 'warn' ? paint(theme, 'yellow', g.warn) : paint(theme, 'red', g.fail);
    lines.push(`  ${mark} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.fix) lines.push(`      ${paint(theme, 'grey', c.fix)}`);
  }
  const failures = checks.filter((c) => c.status === 'fail').length;
  lines.push('');
  lines.push(
    failures
      ? paint(theme, 'red', `  ${failures} problem${failures === 1 ? '' : 's'} would stop VinaX working here.`)
      : paint(theme, 'green', '  Everything VinaX needs is in place.'),
  );
  lines.push('');
  return lines.join('\n');
}

/** Exit code for `vinax doctor`: non-zero only when something is broken. */
export function doctorExitCode(checks: Check[]): number {
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}
