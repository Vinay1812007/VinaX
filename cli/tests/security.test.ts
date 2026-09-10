/**
 * Workspace escape, secret protection and command risk — the three checks
 * that stand between a model's request and somebody's machine.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { containedIn, makeWorkspace, resolvePath } from '../src/security/paths.js';
import { containsSecret, envForModel, isProtectedPath, redact } from '../src/security/secrets.js';
import { classifyArgv, classifyShell, programName, splitShell } from '../src/security/risk.js';
import { cleanup, tempDir, writeFiles } from './helpers.js';

let base = '';
let workspace = '';
beforeEach(async () => {
  base = await tempDir('vinax-sec-');
  workspace = join(base, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFiles(base, {
    'secret.txt': 'the secret',
    'workspace/src/index.ts': 'export const x = 1;\n',
    'workspace/nested/deep/file.ts': 'ok\n',
  });
});
afterEach(async () => { await cleanup(base); });

describe('workspace boundary', () => {
  it('accepts a path inside the workspace', async () => {
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, 'src/index.ts');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.display).toBe('src/index.ts');
  });

  it('reports display paths with forward slashes on EVERY platform', async () => {
    // The model emits src/index.ts wherever it is running; handing it back a
    // backslashed path on one platform only is an inconsistency it has to
    // absorb for no benefit, and it leaks into tool results, the edit journal
    // and the final summary.
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, 'nested/deep/file.ts');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.display).toBe('nested/deep/file.ts');
      expect(r.display).not.toContain('\\');
      // …while the path actually used on disk keeps the platform's own form.
      expect(r.path).toContain(sep);
    }
  });

  it('REJECTS ../ traversal out of the workspace', async () => {
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, '../secret.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('outside_workspace');
  });

  it('REJECTS traversal buried in the middle of a path', async () => {
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, 'src/../../secret.txt');
    expect(r.ok).toBe(false);
  });

  it('REJECTS a symlink that points out of the workspace', async () => {
    const ws = await makeWorkspace(workspace);
    await symlink(base, join(workspace, 'escape'), 'dir');
    const r = await resolvePath(ws, 'escape/secret.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('symlink_escape');
  });

  // Creating a symlink to an absolute system path is POSIX-shaped: on Windows
  // /etc does not exist and unprivileged symlink creation behaves differently,
  // so that platform gets its own equivalent below.
  it.runIf(process.platform !== 'win32')('REJECTS a symlink to a system directory', async () => {
    const ws = await makeWorkspace(workspace);
    await symlink('/etc', join(workspace, 'link'), 'dir');
    const r = await resolvePath(ws, 'link/hosts');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('symlink_escape');
  });

  it.runIf(process.platform === 'win32')('REJECTS an absolute path to a Windows system directory', async () => {
    const ws = await makeWorkspace(workspace);
    for (const p of ['C:\\Windows\\System32\\drivers\\etc\\hosts', 'C:\\Windows']) {
      const r = await resolvePath(ws, p);
      expect(r.ok, p).toBe(false);
    }
  });

  it('REJECTS a NESTED symlink escape (link to a link to outside)', async () => {
    const ws = await makeWorkspace(workspace);
    await symlink(base, join(base, 'hop'), 'dir');
    await symlink(join(base, 'hop'), join(workspace, 'nested-escape'), 'dir');
    const r = await resolvePath(ws, 'nested-escape/secret.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('symlink_escape');
  });

  it('allows a symlink that stays inside the workspace', async () => {
    const ws = await makeWorkspace(workspace);
    await symlink(join(workspace, 'src'), join(workspace, 'alias'), 'dir');
    const r = await resolvePath(ws, 'alias/index.ts');
    expect(r.ok).toBe(true);
  });

  it('resolves a path whose PARENT is a symlink out, even when the file does not exist yet', async () => {
    const ws = await makeWorkspace(workspace);
    await symlink(base, join(workspace, 'out'), 'dir');
    const r = await resolvePath(ws, 'out/brand-new-file.txt');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('symlink_escape');
  });

  it('refuses a NUL byte', async () => {
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, 'src/index\0.ts');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('null_byte');
  });

  it('refuses device and kernel paths', async () => {
    const ws = await makeWorkspace(workspace);
    const dev = await resolvePath(ws, '/dev/zero');
    expect(dev.ok).toBe(false);
    const proc = await resolvePath(ws, '/proc/self/environ');
    expect(proc.ok).toBe(false);
  });

  it('accepts an approved extra root and nothing beyond it', async () => {
    const shared = join(base, 'shared');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'lib.ts'), 'export {};\n', 'utf8');
    const ws = await makeWorkspace(workspace, [shared]);
    expect((await resolvePath(ws, join(shared, 'lib.ts'))).ok).toBe(true);
    expect((await resolvePath(ws, join(base, 'secret.txt'))).ok).toBe(false);
  });

  it('does not fall for a sibling directory that shares a name prefix', async () => {
    // The classic string-prefix bug: /tmp/x/workspace-secrets starts with
    // /tmp/x/workspace.
    const sibling = `${workspace}-secrets`;
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, 'keys.txt'), 'nope', 'utf8');
    const ws = await makeWorkspace(workspace);
    const r = await resolvePath(ws, join(sibling, 'keys.txt'));
    expect(r.ok).toBe(false);
  });

  it('containedIn compares by segments, not by string prefix', () => {
    expect(containedIn('/a/b', '/a/b/c')).toBe(true);
    expect(containedIn('/a/b', '/a/b')).toBe(true);
    expect(containedIn('/a/b', '/a/bc')).toBe(false);
    expect(containedIn('/a/b', '/a')).toBe(false);
  });

  it.runIf(process.platform === 'win32')('refuses Windows device and UNC paths', async () => {
    const ws = await makeWorkspace(workspace);
    expect((await resolvePath(ws, '\\\\?\\C:\\Windows')).ok).toBe(false);
    expect((await resolvePath(ws, '\\\\server\\share\\file')).ok).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('refuses an absolute path on another part of the filesystem', async () => {
    const ws = await makeWorkspace(workspace);
    expect((await resolvePath(ws, '/etc/hosts')).ok).toBe(false);
  });
});

describe('protected files', () => {
  it('protects env files, keys and credential names', () => {
    for (const p of [
      '.env', '.env.local', '.env.production', 'server.pem', 'private.key', 'cert.p12', 'store.pfx',
      'id_rsa', 'id_ed25519', 'credentials', 'credentials.json', 'secrets.yml', 'service-account.json',
      '.npmrc', '.netrc', 'worker/.dev.vars',
    ]) {
      expect(isProtectedPath(p).protected, `${p} should be protected`).toBe(true);
    }
  });

  it('protects credential directories wherever they appear', () => {
    expect(isProtectedPath('/home/u/.ssh/config').protected).toBe(true);
    expect(isProtectedPath('.aws/credentials').protected).toBe(true);
    expect(isProtectedPath('project/.gnupg/secring.gpg').protected).toBe(true);
    expect(isProtectedPath('.kube/config').protected).toBe(true);
  });

  it('leaves ordinary source files alone', () => {
    for (const p of ['src/index.ts', 'README.md', 'package.json', 'env.ts', 'keyboard.tsx', 'secretsManager.test.ts']) {
      expect(isProtectedPath(p).protected, `${p} should not be protected`).toBe(false);
    }
  });
});

describe('secret redaction', () => {
  it('redacts a private key block but keeps the fence, so the reader knows', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...lots\n-----END RSA PRIVATE KEY-----';
    const out = redact(pem);
    expect(out).not.toContain('MIIEow');
    expect(out).toContain('BEGIN RSA PRIVATE KEY');
    expect(out).toContain('[redacted by VinaX]');
  });

  it('redacts authorization headers and bare bearer tokens', () => {
    expect(redact('Authorization: Bearer abcdef1234567890xyz')).not.toContain('abcdef1234567890xyz');
    expect(redact('authorization: token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).not.toContain('ghp_aaaa');
    expect(redact('curl -H "Bearer sk-abcdefghijklmnop123456"')).not.toContain('sk-abcdefghijklmnop');
  });

  it('redacts environment values whose NAME says secret, and leaves the rest', () => {
    const out = redact('NODE_ENV=production\nAPI_KEY=abc123456\nDATABASE_PASSWORD=hunter22\nPORT=3000');
    expect(out).toContain('NODE_ENV=production');
    expect(out).toContain('PORT=3000');
    expect(out).not.toContain('abc123456');
    expect(out).not.toContain('hunter22');
  });

  it('redacts a password in JSON', () => {
    const out = redact('{"user":"alice","password":"hunter22xyz"}');
    expect(out).not.toContain('hunter22xyz');
    expect(out).toContain('alice');
  });

  it('redacts the common provider token shapes', () => {
    const samples = [
      'sk-abcdefghijklmnopqrstuvwx',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
      'github_pat_11ABCDEFG0abcdefghijklmnop',
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyA1234567890abcdefghijklmnopqrstuvw',
      'xoxb-1234567890-abcdefghij',
      'npm_abcdefghijklmnopqrstuvwxyz0123456789',
      'glpat-ABCDEFGHIJKLMNOPQRST',
    ];
    for (const s of samples) {
      expect(redact(`token is ${s} ok`), s).not.toContain(s);
    }
  });

  it('redacts a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(redact(jwt)).not.toContain('dBjftJeZ4CVPmB92');
  });

  it('redacts credentials embedded in a URL', () => {
    const out = redact('git remote add origin https://alice:s3cr3tvalue@github.com/x/y.git');
    expect(out).not.toContain('s3cr3tvalue');
    expect(out).toContain('alice');
  });

  it('is idempotent, so repeated scrubbing cannot corrupt text', () => {
    const once = redact('API_KEY=abcdef123456');
    expect(redact(once)).toBe(once);
  });

  it('leaves ordinary code untouched', () => {
    const code = 'const timeout = 5000;\nexport function keyFor(id: string) { return `k:${id}`; }';
    expect(redact(code)).toBe(code);
    expect(containsSecret(code)).toBe(false);
  });

  it('never hands the model an environment value that looks like a credential', () => {
    const env = envForModel({ PATH: '/usr/bin', GITHUB_TOKEN: 'ghp_realtokenvalue', LANG: 'en_US.UTF-8' });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.GITHUB_TOKEN).toBe('[redacted by VinaX]');
  });
});

describe('command risk', () => {
  it('treats ordinary project work as routine', () => {
    for (const argv of [['npm', 'test'], ['npm', 'run', 'build'], ['pytest'], ['cargo', 'test'], ['go', 'test', './...'], ['eslint', 'src']]) {
      expect(classifyArgv(argv).level, argv.join(' ')).toBe('routine');
    }
  });

  it('treats privilege escalation as critical in every mode', () => {
    expect(classifyArgv(['sudo', 'rm', 'file']).level).toBe('critical');
    expect(classifyArgv(['doas', 'ls']).level).toBe('critical');
    expect(classifyArgv(['pkexec', 'anything']).level).toBe('critical');
  });

  it('treats destroying the machine as critical', () => {
    expect(classifyArgv(['rm', '-rf', '/']).level).toBe('critical');
    expect(classifyArgv(['rm', '-rf', '/etc']).level).toBe('critical');
    expect(classifyArgv(['mkfs.ext4', '/dev/sda1']).level).toBe('critical');
    expect(classifyArgv(['shutdown', '-h', 'now']).level).toBe('critical');
    expect(classifyArgv(['diskutil', 'eraseDisk']).level).toBe('critical');
  });

  it('treats credential stores and browser profiles as critical', () => {
    expect(classifyArgv(['cat', '/home/u/.ssh/id_rsa']).level).toBe('critical');
    expect(classifyArgv(['cp', '-r', '~/.aws', '/tmp']).level).toBe('critical');
  });

  it('treats history rewriting and remote deletion as critical', () => {
    expect(classifyArgv(['git', 'push', '--force', 'origin', 'main']).level).toBe('critical');
    expect(classifyArgv(['git', 'push', '-f']).level).toBe('critical');
    expect(classifyArgv(['git', 'push', 'origin', '--delete', 'main']).level).toBe('critical');
    expect(classifyArgv(['git', 'reset', '--hard', 'HEAD~5']).level).toBe('critical');
    expect(classifyArgv(['git', 'clean', '-fdx']).level).toBe('critical');
    expect(classifyArgv(['git', 'filter-branch']).level).toBe('critical');
  });

  it('treats a normal push and an install as elevated, not routine', () => {
    expect(classifyArgv(['git', 'push']).level).toBe('elevated');
    expect(classifyArgv(['npm', 'install', 'left-pad']).level).toBe('elevated');
    expect(classifyArgv(['pip', 'install', '-r', 'requirements.txt']).level).toBe('elevated');
    expect(classifyArgv(['curl', 'https://example.com']).level).toBe('elevated');
    expect(classifyArgv(['env']).level).toBe('elevated');
  });

  it('splits a shell line and takes the WORST verdict across it', () => {
    expect(splitShell('npm test && sudo rm -rf /')).toEqual([['npm', 'test'], ['sudo', 'rm', '-rf', '/']]);
    expect(classifyShell('npm test && sudo rm -rf /').level).toBe('critical');
    expect(classifyShell('npm run lint; git push --force').level).toBe('critical');
    expect(classifyShell('npm test | tail -5').level).toBe('routine');
  });

  it('never calls a line with command substitution routine', () => {
    expect(classifyShell('echo $(cat ~/.ssh/id_rsa)').level).not.toBe('routine');
    expect(classifyShell('ls `whoami`').level).not.toBe('routine');
  });

  it('keeps quoted arguments together', () => {
    expect(splitShell('git commit -m "fix: the thing; and more"')).toEqual([
      ['git', 'commit', '-m', 'fix: the thing; and more'],
    ]);
  });

  it('normalizes a program path or Windows extension to its name', () => {
    expect(programName('/usr/local/bin/npm')).toBe('npm');
    expect(programName('C:\\Program Files\\nodejs\\npm.cmd')).toBe('npm');
  });
});
