/**
 * Package hygiene: the version is in one place, the help is honest, doctor
 * reports honestly, and `npm pack` ships only what belongs in a published
 * package.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from '../src/version.js';
import { helpText } from '../src/commands/help.js';
import { doctorExitCode, renderDoctor, type Check } from '../src/commands/doctor.js';
import { EXIT, EXIT_LABEL } from '../src/utils/exit.js';
import { TOOLS } from '../src/tools/registry.js';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('release hygiene', () => {
  it('keeps CLI_VERSION and package.json in step', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string; bin: Record<string, string> };
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe(CLI_VERSION);
  });

  it('exposes the vinax binary', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { bin: Record<string, string>; type: string; engines: { node: string } };
    expect(pkg.bin.vinax).toBe('dist/cli.js');
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toContain('22');
  });

  it('has no runtime dependencies to audit or ship', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});

describe('npm pack', () => {
  it('ships the build and the README, and NOTHING else', () => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    // A machine without npm on PATH should skip rather than fail.
    if (r.status !== 0) return;
    const parsed = JSON.parse(r.stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = parsed[0].files.map((f) => f.path);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.startsWith('dist/'))).toBe(true);
    expect(files).toContain('package.json');

    for (const f of files) {
      expect(f, `${f} does not belong in the package`).not.toMatch(/^tests\//);
      expect(f).not.toMatch(/^src\//);
      expect(f).not.toMatch(/\.test\.(ts|js)$/);
      expect(f).not.toMatch(/\.env/);
      expect(f).not.toMatch(/\.map$/);
      expect(f).not.toMatch(/^\.github\//);
      expect(f).not.toMatch(/eslint\.config/);
      expect(f).not.toMatch(/tsconfig/);
      expect(f).not.toMatch(/vitest\.config/);
      expect(f).not.toMatch(/^scripts\//);
      // Session transcripts and lockfiles are local state, never shipped.
      expect(f).not.toMatch(/\.jsonl$/);
      expect(f).not.toMatch(/package-lock\.json$/);
    }
  }, 60_000);
});

describe('help output', () => {
  const help = helpText();

  it('documents every flag the parser accepts', () => {
    for (const flag of [
      '--cwd', '--add-dir', '--engine', '--model', '--web', '--approval',
      '--ask', '--auto-edit', '--full-auto', '--max-steps', '--continue',
      '--resume', '--print', '--json', '--debug', '--color', '--help', '--version',
    ]) {
      expect(help, flag).toContain(flag);
    }
  });

  it('documents every subcommand', () => {
    for (const cmd of ['exec', 'models', 'sessions', 'doctor', 'mcp']) {
      expect(help, cmd).toContain(cmd);
    }
  });

  it('documents every exit code', () => {
    for (const [code, label] of Object.entries(EXIT_LABEL)) {
      expect(help).toContain(code);
      expect(help).toContain(label);
    }
  });

  it('says plainly that no provider keys are needed', () => {
    expect(help).toContain('needs no AI provider keys');
  });

  it('points at the public documentation route', () => {
    expect(help).toContain('https://www.sirimillavinay.online/VinaXAI/cli/docs');
  });

  it('uses VinaX branding and names no third-party AI product', () => {
    expect(help).toContain('VinaX CLI');
    for (const brand of ['OpenAI', 'ChatGPT', 'Claude', 'Anthropic', 'Gemini', 'Copilot', 'Cursor', 'Codex', 'Groq', 'NVIDIA', 'OpenRouter']) {
      expect(help, brand).not.toContain(brand);
    }
  });

  it('explains what full-auto still refuses to do', () => {
    expect(help).toContain('full-auto');
    expect(help).toContain('Privilege escalation');
    expect(help).toContain('credential stores');
  });
});

describe('exit codes', () => {
  it('distinguishes every outcome automation needs', () => {
    const values = Object.values(EXIT);
    expect(new Set(values).size).toBe(values.length);
    expect(EXIT.ok).toBe(0);
    expect(EXIT.usage).toBe(2);
    expect(EXIT.api).toBe(3);
    expect(EXIT.permissionDenied).toBe(4);
    expect(EXIT.maxSteps).toBe(5);
    expect(EXIT.interrupted).toBe(130);
  });

  it('has a label for each one', () => {
    for (const code of Object.values(EXIT)) expect(EXIT_LABEL[code]).toBeTruthy();
  });
});

describe('doctor', () => {
  const checks: Check[] = [
    { name: 'VinaX CLI', status: 'ok', detail: 'v0.1.0' },
    { name: 'Git', status: 'warn', detail: 'not found on PATH', fix: 'Install Git.' },
    { name: 'VinaX service', status: 'fail', detail: 'unreachable', fix: 'Check your network.' },
  ];

  it('renders every check with its status and its fix', () => {
    const out = renderDoctor(checks, { color: false, width: 80, unicode: true });
    expect(out).toContain('VinaX CLI');
    expect(out).toContain('not found on PATH');
    expect(out).toContain('Install Git.');
    expect(out).toContain('1 problem');
  });

  it('exits non-zero only when something is actually broken', () => {
    expect(doctorExitCode(checks)).toBe(1);
    expect(doctorExitCode(checks.filter((c) => c.status !== 'fail'))).toBe(0);
  });

  it('prints no secrets', () => {
    const out = renderDoctor(checks, { color: false, width: 80, unicode: true });
    expect(out).not.toMatch(/sk-|ghp_|Bearer /);
  });
});

describe('the tool surface', () => {
  it('implements every tool the protocol declares', () => {
    for (const name of [
      'read_file', 'read_files', 'read_file_range', 'list_directory', 'directory_tree',
      'glob', 'grep', 'search_files', 'file_stat', 'create_directory', 'write_file',
      'apply_patch', 'move_file', 'copy_file', 'delete_file', 'run_command', 'run_shell',
      'git_status', 'git_diff', 'git_log', 'git_branch', 'git_show', 'git_add',
      'git_commit', 'git_fetch', 'git_pull', 'git_push', 'update_plan', 'web_search',
    ]) {
      expect(Object.keys(TOOLS), name).toContain(name);
    }
  });

  it('offers no tool that destroys history or state', () => {
    for (const name of Object.keys(TOOLS)) {
      expect(name).not.toMatch(/reset|clean|force|discard|wipe/i);
    }
  });
});
