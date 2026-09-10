/**
 * Startup discovery, project instructions and the terminal renderer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectInstructions, contextBlock, discover, starterInstructions } from '../src/context/discovery.js';
import { detectTheme, renderDiff, renderMarkdown } from '../src/terminal/render.js';
import { renderRequest } from '../src/terminal/prompt.js';
import { globToRegExp, loadIgnores, matchGlob } from '../src/project/ignore.js';
import { cleanup, gitRun, hasGit, initRepo, tempDir, writeFiles } from './helpers.js';

let root = '';
const signal = new AbortController().signal;

beforeEach(async () => { root = await tempDir('vinax-disc-'); });
afterEach(async () => { await cleanup(root); });

describe('discovery', () => {
  it('reports the working directory and recognises the project kind', async () => {
    await writeFiles(root, { 'package.json': JSON.stringify({ scripts: { test: 'vitest', build: 'vite build' } }) });
    const d = await discover(root, signal);
    expect(d.cwd).toContain('vinax-disc-');
    expect(d.markers.some((m) => m.kind === 'Node.js')).toBe(true);
    expect(d.markers[0].commands).toContain('test');
    expect(d.markers[0].commands).toContain('build');
  });

  it('recognises several project kinds side by side', async () => {
    await writeFiles(root, {
      'pyproject.toml': '[project]\nname = "x"\n',
      'Cargo.toml': '[package]\nname = "x"\n',
      'go.mod': 'module x\n',
      'Dockerfile': 'FROM node\n',
    });
    const d = await discover(root, signal);
    const kinds = d.markers.map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['Python', 'Rust', 'Go', 'Docker']));
  });

  it('says plainly when a directory is not a repository', async () => {
    const d = await discover(root, signal);
    expect(d.isGitRepo).toBe(false);
    expect(contextBlock(d)).toContain('not a repository');
  });

  it.runIf(hasGit())('finds the git root, branch and PRE-EXISTING changes', async () => {
    await initRepo(root);
    await writeFiles(root, { 'a.txt': 'one\n', 'b.txt': 'two\n' });
    gitRun(root, ['add', 'a.txt']);
    gitRun(root, ['commit', '-m', 'initial']);
    await writeFile(join(root, 'a.txt'), 'modified by the user\n', 'utf8');

    const nested = join(root, 'packages', 'app');
    await mkdir(nested, { recursive: true });
    const d = await discover(nested, signal);

    expect(d.isGitRepo).toBe(true);
    expect(d.branch).toBe('main');
    expect(d.workspaceRoot).toContain('vinax-disc-');
    expect(d.dirtyFiles).toContain('a.txt');
    expect(d.untrackedFiles).toContain('b.txt');

    const block = contextBlock(d);
    expect(block).toContain("these are the user's changes, not yours");
    expect(block).toContain('a.txt');
  });

  it('does NOT read the repository contents at startup', async () => {
    await writeFiles(root, {
      'package.json': '{}',
      'src/huge.ts': 'x'.repeat(200_000),
      'src/secret-looking.ts': 'const token = "abc";',
    });
    const d = await discover(root, signal);
    const block = contextBlock(d);
    expect(block).not.toContain('xxxxx');
    expect(block).not.toContain('const token');
    expect(block.length).toBeLessThan(4000);
  });
});

describe('project instructions', () => {
  it('reads VINAX.md', async () => {
    await writeFiles(root, { 'VINAX.md': '# Rules\n\nRun npm test first.\n' });
    const { files, text } = await collectInstructions(root, root);
    expect(files).toEqual(['VINAX.md']);
    expect(text).toContain('Run npm test first.');
  });

  it('reads .vinax/instructions.md', async () => {
    await writeFiles(root, { '.vinax/instructions.md': 'Use tabs.\n' });
    const { files } = await collectInstructions(root, root);
    expect(files).toEqual([join('.vinax', 'instructions.md').split('\\').join('/')]);
  });

  it('also recognises the generic AGENTS.md convention when a project already has one', async () => {
    await writeFiles(root, { 'AGENTS.md': 'House style: no default exports.\n' });
    const { files, text } = await collectInstructions(root, root);
    expect(files).toEqual(['AGENTS.md']);
    expect(text).toContain('no default exports');
  });

  it('layers a nested package file AFTER the root one, so the specific file wins', async () => {
    await writeFiles(root, {
      'VINAX.md': 'Root rule: use LF.\n',
      'packages/app/VINAX.md': 'App rule: this package uses CRLF.\n',
    });
    const { files, text } = await collectInstructions(root, join(root, 'packages', 'app'));
    expect(files).toHaveLength(2);
    expect(text.indexOf('Root rule')).toBeLessThan(text.indexOf('App rule'));
  });

  it('redacts a secret that ended up in an instruction file', async () => {
    await writeFiles(root, { 'VINAX.md': 'Deploy with API_KEY=sk-abcdefghijklmnopqrst\n' });
    const { text } = await collectInstructions(root, root);
    expect(text).not.toContain('sk-abcdefghijklmnopqrst');
  });

  it('writes a starter file that names the project\'s real commands', async () => {
    await writeFiles(root, { 'package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build' } }) });
    const d = await discover(root, signal);
    const starter = starterInstructions(d);
    expect(starter).toContain('# VinaX project instructions');
    expect(starter).toContain('npm test');
    expect(starter).toContain('npm run lint');
    expect(starter).toContain('npm run build');
  });
});

describe('ignore rules and globs', () => {
  it('compiles the glob syntax people type', () => {
    expect(globToRegExp('*.ts').test('a.ts')).toBe(true);
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false);
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true);
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('*.{ts,tsx}').test('a.tsx')).toBe(true);
    expect(globToRegExp('[abc].ts').test('b.ts')).toBe(true);
  });

  it('matches a bare pattern at any depth', () => {
    expect(matchGlob('*.test.ts', 'src/deep/a.test.ts')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/deep/a.ts')).toBe(false);
  });

  it('ignores generated and vendored directories by default', async () => {
    const ig = await loadIgnores(root, { useGitignore: false });
    for (const p of ['node_modules', 'node_modules/pkg/index.js', 'dist/app.js', '.git/config', 'coverage/x', 'target/debug/x']) {
      expect(ig.ignores(p, p.endsWith('/')), p).toBe(true);
    }
    expect(ig.ignores('src/index.ts', false)).toBe(false);
  });

  it('honours .gitignore, including negation', async () => {
    await writeFiles(root, { '.gitignore': '*.log\nbuild/\n!keep.log\n' });
    const ig = await loadIgnores(root);
    expect(ig.ignores('debug.log', false)).toBe(true);
    expect(ig.ignores('build/out.js', false)).toBe(true);
    expect(ig.ignores('keep.log', false)).toBe(false);
    expect(ig.ignores('src/app.ts', false)).toBe(false);
  });

  it('can be told to ignore .gitignore, for the case where the user asks', async () => {
    await writeFiles(root, { '.gitignore': '*.log\n' });
    const ig = await loadIgnores(root, { useGitignore: false });
    expect(ig.ignores('debug.log', false)).toBe(false);
  });
});

describe('terminal rendering', () => {
  const plain = { color: false, width: 80, unicode: true };

  it('turns colour off for NO_COLOR, TERM=dumb and a non-TTY', () => {
    const saved = { ...process.env };
    try {
      process.env.NO_COLOR = '1';
      expect(detectTheme({ stream: { isTTY: true, columns: 100 } as NodeJS.WriteStream }).color).toBe(false);
      delete process.env.NO_COLOR;
      process.env.TERM = 'dumb';
      expect(detectTheme({ stream: { isTTY: true, columns: 100 } as NodeJS.WriteStream }).color).toBe(false);
      delete process.env.TERM;
      expect(detectTheme({ stream: { isTTY: false } as NodeJS.WriteStream }).color).toBe(false);
    } finally {
      process.env = saved;
    }
  });

  it('copes with a narrow terminal', () => {
    const theme = detectTheme({ stream: { isTTY: true, columns: 30 } as NodeJS.WriteStream });
    expect(theme.width).toBeGreaterThanOrEqual(40);
  });

  it('renders headings, code fences and inline code without escape codes when colour is off', () => {
    const out = renderMarkdown('# Title\n\nSome `code` here\n\n```ts\nconst x = 1;\n```\n', plain);
    expect(out).toContain('Title');
    expect(out).toContain('const x = 1;');
    expect(out).not.toContain('\u001b[');
  });

  it('renders a diff without escape codes when colour is off', () => {
    const out = renderDiff('@@ -1 +1 @@\n-old\n+new', plain);
    expect(out).toContain('-old');
    expect(out).toContain('+new');
    expect(out).not.toContain('\u001b[');
  });

  it('shows the exact action, and offers reject as the default', () => {
    const out = renderRequest({
      kind: 'execute', title: 'Run command?', detail: ['  npm test', '', 'Working directory:', '  /home/u/project'],
      risk: 'routine', scopeKey: 'run:npm', scopeLabel: 'Allow npm commands this session',
    }, plain);
    expect(out).toContain('Run command?');
    expect(out).toContain('npm test');
    expect(out).toContain('/home/u/project');
    expect(out).toContain('1. Allow once');
    expect(out).toContain('2. Allow npm commands this session');
    expect(out).toContain('3. Reject');
  });

  it('offers NO session grant for a critical action, and says why it is being asked', () => {
    const out = renderRequest({
      kind: 'execute', title: 'Run command?', detail: ['  sudo rm -rf /'],
      risk: 'critical', scopeKey: 'x', scopeLabel: 'Allow this session',
    }, plain);
    expect(out).toContain('high-impact action');
    expect(out).not.toContain('Allow this session');
    expect(out).toContain('2. Reject');
  });

  it('renders an edit prompt as a real diff', () => {
    const out = renderRequest({
      kind: 'write', title: 'Modify src/api/client.ts?',
      detail: ['+1 −1', '', '@@ -1 +1 @@', '-const timeout = 1000;', '+const timeout = 5000;'],
      risk: 'routine', scopeKey: 'edit:project', scopeLabel: 'Allow project edits this session',
    }, plain);
    expect(out).toContain('Modify src/api/client.ts?');
    expect(out).toContain('-const timeout = 1000;');
    expect(out).toContain('+const timeout = 5000;');
  });
});
