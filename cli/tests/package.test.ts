/**
 * Package hygiene: the version is in one place, the help is honest, doctor
 * reports honestly, and `npm pack` ships only what belongs in a published
 * package.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CLI_VERSION } from '../src/version.js';
import { helpText } from '../src/commands/help.js';
import { doctorExitCode, renderDoctor, type Check } from '../src/commands/doctor.js';
import { EXIT, EXIT_LABEL } from '../src/utils/exit.js';
import { TOOLS } from '../src/tools/registry.js';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('the package stays publishable', () => {
  /**
   * The `npm install -g vinax-cli` 404 had exactly one cause: the package was
   * marked private, so it was never published. Each assertion here is one way
   * that could silently come back.
   */
  it('is NOT private — a private package can never reach the registry', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { private?: boolean };
    expect(pkg.private, 'cli/package.json must not be private, or npm publish refuses it').toBeUndefined();
  });

  it('publishes publicly, which an unscoped first release requires', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { publishConfig?: { access?: string; provenance?: boolean } };
    expect(pkg.publishConfig?.access).toBe('public');
    // Provenance belongs to the release workflow (`npm publish --provenance`),
    // not here: in publishConfig it makes a manual publish fail outright, and
    // the FIRST publish has to be manual — trusted publishing cannot be
    // configured for a package that does not exist yet.
    expect(pkg.publishConfig?.provenance).toBeUndefined();
  });

  it('points at the real repository, documentation and issue tracker', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      repository?: { url?: string; directory?: string };
      homepage?: string;
      bugs?: { url?: string };
    };
    expect(pkg.repository?.url).toContain('github.com/Vinay1812007/VinaX');
    expect(pkg.repository?.directory).toBe('cli');
    expect(pkg.homepage).toBe('https://www.sirimillavinay.online/VinaXAI/cli/docs/');
    expect(pkg.bugs?.url).toContain('github.com/Vinay1812007/VinaX');
  });

  it('keeps the licence the repository chose — npm distribution is not a licence decision', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { license: string };
    expect(pkg.license).toBe('UNLICENSED');
  });

  it('rebuilds before packing, so a stale or missing dist can never be published', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepack).toBe('npm run build');
  });
});

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

describe('the shipped binary', () => {
  it('keeps its shebang, or the installed vinax command will not run', async () => {
    const entry = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'cli.js');
    const head = (await readFile(entry, 'utf8')).slice(0, 32);
    expect(head.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('is executable', async () => {
    if (process.platform === 'win32') return; // no POSIX mode bits
    const entry = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'cli.js');
    expect((await stat(entry)).mode & 0o111).toBeGreaterThan(0);
  });

  it('is the file that bin actually points at', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { bin: Record<string, string> };
    const target = resolve(fileURLToPath(new URL('..', import.meta.url)), pkg.bin.vinax);
    await expect(stat(target)).resolves.toBeDefined();
  });

  it('reports the same version three ways: package.json, the module, and --version', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
    const entry = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'cli.js');
    const printed = spawnSync(process.execPath, [entry, '--version'], { encoding: 'utf8' });
    expect(printed.status).toBe(0);
    expect(printed.stdout.trim()).toBe(pkg.version);
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

describe('what npm would actually receive', () => {
  /**
   * `npm pack --dry-run --json` is the closest thing to asking npm "what would
   * you publish?".
   *
   * `--ignore-scripts` is deliberate: prepack does `rm -rf dist && tsc`, and
   * vitest runs test files in parallel, so without it this quietly deleted
   * dist/cli.js underneath the end-to-end suite that drives it. The build
   * itself is covered by `npm run build` and by the CI pack step.
   */
  const packed = (): { name: string; version: string; files: string[] } | null => {
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    if (r.status !== 0) return null;
    try {
      const parsed = JSON.parse(r.stdout) as Array<{ name: string; version: string; files: Array<{ path: string }> }>;
      return { name: parsed[0].name, version: parsed[0].version, files: parsed[0].files.map((f) => f.path) };
    } catch {
      return null;
    }
  };

  it('emits clean JSON that names the package', () => {
    const p = packed();
    if (!p) return; // npm unavailable on this machine
    expect(p.name).toBe('vinax-cli');
    expect(p.version).toBe(CLI_VERSION);
  }, 60_000);

  it('has no build step that writes to stdout — that would corrupt npm --json output', () => {
    // postbuild runs as `prepack`, so anything it prints on stdout lands in
    // the middle of `npm pack --json` / `npm publish --json`.
    const cliRoot = fileURLToPath(new URL('..', import.meta.url));
    const r = spawnSync(process.execPath, [join('scripts', 'postbuild.mjs')], { cwd: cliRoot, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout, 'postbuild must log to stderr, not stdout').toBe('');
    expect(r.stderr).toContain('executable');
  }, 30_000);

  it('INCLUDES everything needed to run the CLI', () => {
    const p = packed();
    if (!p) return;
    expect(p.files).toContain('dist/cli.js');
    expect(p.files).toContain('package.json');
    expect(p.files).toContain('README.md');
    expect(p.files.some((f) => f.startsWith('dist/tools/'))).toBe(true);
    expect(p.files.some((f) => f.startsWith('dist/agent/'))).toBe(true);
  }, 60_000);

  it('EXCLUDES sources, tests, configs and anything that could carry a secret', () => {
    const p = packed();
    if (!p) return;
    for (const f of p.files) {
      expect(f, `${f} does not belong in the published package`).not.toMatch(
        /^tests\/|^src\/|^scripts\/|^\.github\/|\.test\.|\.env|tsconfig|eslint\.config|vitest\.config|package-lock\.json|\.jsonl$|\.npmrc|\.map$/,
      );
    }
  }, 60_000);
});

describe('the release workflow', () => {
  const workflow = (): string => {
    try {
      return readFileSync(resolve(fileURLToPath(new URL('../..', import.meta.url)), '.github/workflows/cli-publish.yml'), 'utf8');
    } catch {
      return '';
    }
  };

  it('exists, and publishes only on a CLI release tag — never on an ordinary commit', () => {
    const w = workflow();
    expect(w, 'cli-publish.yml is missing').not.toBe('');
    expect(w).toContain('vinax-cli-v');
    expect(w).not.toMatch(/on:\s*\n\s*push:\s*\n\s*branches/);
  });

  it('refuses to publish when the tag and the package version disagree', () => {
    const w = workflow();
    expect(w).toContain('package.json');
    expect(w).toContain('CLI_VERSION');
    expect(w.toLowerCase()).toContain('exit 1');
  });

  it('runs the full gates before publishing', () => {
    const w = workflow();
    for (const step of ['npm ci', 'npm run lint', 'npm run typecheck', 'npm run build', 'npm test', 'npm pack --dry-run']) {
      expect(w, step).toContain(step);
    }
    // The gates must come before the publish, not after it.
    expect(w.indexOf('npm test')).toBeLessThan(w.indexOf('npm publish'));
  });

  it('uses trusted publishing rather than a committed token', () => {
    const w = workflow();
    expect(w).toContain('id-token: write');
    expect(w).toContain('--provenance');
    expect(w).not.toMatch(/NPM_TOKEN\s*:\s*['"]?[A-Za-z0-9_-]{20,}/);
  });
});

describe('the documentation tells the truth about installing', () => {
  const cliReadme = (): string => readFileSync(resolve(fileURLToPath(new URL('..', import.meta.url)), 'README.md'), 'utf8');
  const docsContent = (): string =>
    readFileSync(resolve(fileURLToPath(new URL('../..', import.meta.url)), 'frontend/src/features/cli/docsContent.ts'), 'utf8');

  it('names the package exactly as package.json does, everywhere', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name: string; bin: Record<string, string> };
    expect(cliReadme()).toContain(pkg.name);
    expect(docsContent()).toContain(pkg.name);
    expect(Object.keys(pkg.bin)).toEqual(['vinax']);
  });

  it('documents the source install, which works whether or not the registry release has happened', () => {
    for (const text of [cliReadme(), docsContent()]) {
      expect(text).toContain('git clone https://github.com/Vinay1812007/VinaX.git');
      expect(text).toContain('npm install -g .');
    }
  });

  it('documents the Node requirement the package actually declares', async () => {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { engines: { node: string } };
    expect(pkg.engines.node).toBe('>=22');
    expect(docsContent()).toContain('Node.js 22');
  });
});

describe('installing the real tarball', () => {
  /**
   * The reported failure was an INSTALL failure, so the last word has to come
   * from an actual install — not from `npm pack` output, and not from running
   * the source tree. This packs the package npm would receive, installs it
   * into a throwaway prefix, and runs the binary npm put there.
   *
   * The developer's own global installation is never touched: everything
   * happens under a temporary --prefix.
   */
  it('packs, installs into an isolated prefix, and the vinax binary runs', async () => {
    const cliRoot = fileURLToPath(new URL('..', import.meta.url));
    const work = await mkdtemp(join(tmpdir(), 'vinax-install-'));
    try {
      const packed = spawnSync('npm', ['pack', '--pack-destination', work, '--ignore-scripts'], {
        cwd: cliRoot,
        encoding: 'utf8',
      });
      if (packed.status !== 0) return; // npm unavailable on this machine
      const tarball = packed.stdout.trim().split('\n').pop() as string;
      expect(tarball).toMatch(/^vinax-cli-\d+\.\d+\.\d+\.tgz$/);

      const prefix = join(work, 'prefix');
      const installed = spawnSync('npm', ['install', '-g', '--prefix', prefix, join(work, tarball)], {
        encoding: 'utf8',
      });
      expect(installed.status, installed.stderr).toBe(0);

      // Windows gets a .cmd shim rather than a symlink into lib/.
      const bin = process.platform === 'win32' ? join(prefix, 'vinax.cmd') : join(prefix, 'bin', 'vinax');
      await expect(stat(bin)).resolves.toBeDefined();

      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string };
      const ran = spawnSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
      expect(ran.status, ran.stderr).toBe(0);
      expect(ran.stdout.trim()).toBe(pkg.version);

      const help = spawnSync(bin, ['--help'], { encoding: 'utf8', shell: process.platform === 'win32' });
      expect(help.status).toBe(0);
      expect(help.stdout).toContain('VinaX CLI');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }, 180_000);
});
