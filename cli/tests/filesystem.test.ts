/**
 * The filesystem tools: reading, editing, and the guarantees that make an
 * agent safe to point at a real project.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  directoryTreeTool, fileStatTool, listDirectoryTool,
  readFileRangeTool, readFileTool, readFilesTool,
} from '../src/tools/filesystem/read.js';
import {
  applyPatchTool, copyFileTool, createDirectoryTool, deleteFileTool, moveFileTool, writeFileTool,
} from '../src/tools/filesystem/write.js';
import { globTool, grepTool, searchFilesTool } from '../src/tools/filesystem/search.js';
import { unifiedDiff, diffStat } from '../src/tools/filesystem/diff.js';
import { contentHash } from '../src/utils/text.js';
import { cleanup, tempDir, testContext, writeFiles, type TestContext } from './helpers.js';

let root = '';
let ctx: TestContext;

beforeEach(async () => {
  root = await tempDir('vinax-fs-');
  await writeFiles(root, {
    'package.json': '{\n  "name": "demo",\n  "scripts": { "test": "vitest run" }\n}\n',
    'src/index.ts': 'export const version = 1;\nexport function add(a: number, b: number) {\n  return a + b;\n}\n',
    'src/util.ts': 'export const NAME = "demo";\n',
    'tests/add.test.ts': 'import { add } from "../src/index";\nadd(1, 2);\n',
    '.env': 'API_KEY=super-secret-value\n',
    'docs/readme.md': '# Demo\n',
    'crlf.txt': 'one\r\ntwo\r\nthree\r\n',
    '.gitignore': 'ignored/\n*.log\n',
    'ignored/hidden.ts': 'export const hidden = true;\n',
    'debug.log': 'noise\n',
  });
  ctx = await testContext({ root });
});
afterEach(async () => { await cleanup(root); });

const args = (o: Record<string, unknown>): Record<string, unknown> => o;

describe('reading', () => {
  it('reads a file and returns a stable content hash', async () => {
    const r = await readFileTool(args({ path: 'src/index.ts' }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('export const version = 1;');
    expect(r.content).toMatch(/hash sha256:[0-9a-f]{32}/);
    expect(r.meta?.hash).toBe(contentHash(await readFile(join(root, 'src/index.ts'))));
  });

  it('reports line count and newline style', async () => {
    expect((await readFileTool(args({ path: 'crlf.txt' }), ctx)).content).toContain('CRLF');
    expect((await readFileTool(args({ path: 'src/util.ts' }), ctx)).content).toContain('LF');
  });

  it('reads a line range with 1-indexed numbers', async () => {
    const r = await readFileRangeTool(args({ path: 'src/index.ts', start: 2, end: 3 }), ctx);
    expect(r.content).toContain('     2\texport function add');
    expect(r.content).not.toContain('export const version');
  });

  it('says so honestly when the range starts past the end of the file', async () => {
    const r = await readFileRangeTool(args({ path: 'src/util.ts', start: 500, end: 600 }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('does not exist');
  });

  it('reads several files in one call, sharing the output budget', async () => {
    const r = await readFilesTool(args({ paths: ['src/index.ts', 'src/util.ts'] }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('src/index.ts');
    expect(r.content).toContain('src/util.ts');
  });

  it('reports a missing file per entry rather than failing the batch', async () => {
    const r = await readFilesTool(args({ paths: ['src/index.ts', 'nope.ts'] }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('no such file');
  });

  it('REFUSES a binary file', async () => {
    await writeFile(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]));
    const r = await readFileTool(args({ path: 'blob.bin' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('binary');
  });

  it('REFUSES a file over the size limit and points at a better tool', async () => {
    await writeFile(join(root, 'big.txt'), 'x'.repeat(20_000));
    const small = await testContext({ root, config: { maxFileBytes: 1000 } });
    const r = await readFileTool(args({ path: 'big.txt' }), small);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('read_file_range');
  });

  it('reports truncation instead of silently cutting content', async () => {
    await writeFile(join(root, 'long.txt'), 'line\n'.repeat(5000));
    const tight = await testContext({ root, config: { maxOutputChars: 2000 } });
    const r = await readFileTool(args({ path: 'long.txt' }), tight);
    expect(r.content).toContain('TRUNCATED');
    expect(r.content).toContain('omitted by VinaX');
  });

  it('ASKS before reading a protected credential file, and says where it goes', async () => {
    await readFileTool(args({ path: '.env' }), ctx);
    expect(ctx.asked).toHaveLength(1);
    expect(ctx.asked[0].kind).toBe('protected-read');
    expect(ctx.asked[0].detail.join(' ')).toContain('sent to the VinaX AI service');
  });

  it('REFUSES a protected file when the user says no', async () => {
    const strict = await testContext({ root, answer: () => 'reject' });
    const r = await readFileTool(args({ path: '.env' }), strict);
    expect(r.ok).toBe(false);
    expect(r.permissionDenied).toBe(true);
  });

  it('redacts a secret even out of a file the user approved', async () => {
    const r = await readFileTool(args({ path: '.env' }), ctx);
    expect(r.ok).toBe(true);
    expect(r.content).not.toContain('super-secret-value');
    expect(r.content).toContain('[redacted by VinaX]');
  });

  it('never reads outside the workspace without asking', async () => {
    const outside = join(root, '..', 'outside.txt');
    await writeFile(outside, 'not yours', 'utf8').catch(() => undefined);
    const strict = await testContext({ root, answer: () => 'reject' });
    const r = await readFileTool(args({ path: '../outside.txt' }), strict);
    expect(r.ok).toBe(false);
    expect(strict.asked[0].kind).toBe('outside-workspace');
  });

  it('lists a directory and hides ignored entries, saying how many', async () => {
    const r = await listDirectoryTool(args({ path: '.' }), ctx);
    expect(r.content).toContain('src/');
    expect(r.content).not.toContain('ignored/');
    expect(r.content).toMatch(/ignored (entry|entries) not listed/);
  });

  it('renders a bounded tree', async () => {
    const r = await directoryTreeTool(args({ path: '.', depth: 2 }), ctx);
    expect(r.content).toContain('src/');
    expect(r.content).toContain('index.ts');
    expect(r.content).not.toContain('hidden.ts');
  });

  it('stats a file with hash, lines and newline style', async () => {
    const r = await fileStatTool(args({ path: 'src/index.ts' }), ctx);
    expect(r.content).toContain('lines: 4');
    expect(r.content).toContain('newlines: LF');
    expect(r.content).toContain('hash: sha256:');
  });
});

describe('searching', () => {
  it('finds files by glob, newest first', async () => {
    const r = await globTool(args({ pattern: 'src/**/*.ts' }), ctx);
    expect(r.content).toContain('src/index.ts');
    expect(r.content).toContain('src/util.ts');
  });

  it('respects .gitignore by default', async () => {
    const r = await globTool(args({ pattern: '**/*.ts' }), ctx);
    expect(r.content).not.toContain('hidden.ts');
    const l = await globTool(args({ pattern: '**/*.log' }), ctx);
    expect(l.content).not.toContain('debug.log');
  });

  it('greps contents and reports file and line', async () => {
    const r = await grepTool(args({ pattern: 'export function' }), ctx);
    expect(r.content).toContain('src/index.ts');
    expect(r.content).toMatch(/\s+2: export function add/);
  });

  it('supports case-insensitive grep and a glob filter', async () => {
    expect((await grepTool(args({ pattern: 'EXPORT CONST', ignoreCase: true }), ctx)).content).toContain('src/');
    const filtered = await grepTool(args({ pattern: 'export', glob: 'tests/**' }), ctx);
    expect(filtered.content).not.toContain('src/index.ts');
  });

  it('reports an invalid regular expression instead of throwing', async () => {
    const r = await grepTool(args({ pattern: '([unclosed' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('not a valid regular expression');
  });

  it('never greps a credential file, so grep cannot route around the prompt', async () => {
    const r = await grepTool(args({ pattern: 'API_KEY' }), ctx);
    expect(r.content).not.toContain('super-secret-value');
    expect(ctx.asked).toHaveLength(0);
  });

  it('finds files by name', async () => {
    const r = await searchFilesTool(args({ query: 'util' }), ctx);
    expect(r.content).toContain('src/util.ts');
  });
});

describe('editing', () => {
  it('applies a patch, keeping the rest of the file', async () => {
    const r = await applyPatchTool(args({ path: 'src/util.ts', oldText: '"demo"', newText: '"vinax"' }), ctx);
    expect(r.ok).toBe(true);
    expect(await readFile(join(root, 'src/util.ts'), 'utf8')).toBe('export const NAME = "vinax";\n');
  });

  it('shows the real diff in the approval prompt', async () => {
    await applyPatchTool(args({ path: 'src/util.ts', oldText: '"demo"', newText: '"vinax"' }), ctx);
    const detail = ctx.asked[0].detail.join('\n');
    expect(detail).toContain('-export const NAME = "demo";');
    expect(detail).toContain('+export const NAME = "vinax";');
  });

  it('REFUSES an ambiguous patch rather than guessing which one', async () => {
    await writeFile(join(root, 'dup.ts'), 'const a = 1;\nconst a = 1;\n', 'utf8');
    const r = await applyPatchTool(args({ path: 'dup.ts', oldText: 'const a = 1;', newText: 'const a = 2;' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('ambiguous');
  });

  it('REFUSES a patch whose oldText is not there, and says what to do', async () => {
    const r = await applyPatchTool(args({ path: 'src/util.ts', oldText: 'not present', newText: 'x' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('Read the file again');
  });

  it('DETECTS a race: the file changed since the model read it', async () => {
    const read = await readFileTool(args({ path: 'src/util.ts' }), ctx);
    await writeFile(join(root, 'src/util.ts'), 'someone else edited this\n', 'utf8');
    const r = await applyPatchTool(
      args({ path: 'src/util.ts', oldText: 'x', newText: 'y', expectedHash: String(read.meta?.hash) }),
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain('changed since it was read');
    expect(await readFile(join(root, 'src/util.ts'), 'utf8')).toBe('someone else edited this\n');
  });

  it('preserves CRLF line endings through an edit', async () => {
    await applyPatchTool(args({ path: 'crlf.txt', oldText: 'two', newText: 'TWO' }), ctx);
    const after = await readFile(join(root, 'crlf.txt'), 'utf8');
    expect(after).toBe('one\r\nTWO\r\nthree\r\n');
  });

  it('preserves the file mode', async () => {
    if (process.platform === 'win32') return;
    await chmod(join(root, 'src/util.ts'), 0o640);
    await applyPatchTool(args({ path: 'src/util.ts', oldText: '"demo"', newText: '"x"' }), ctx);
    expect((await stat(join(root, 'src/util.ts'))).mode & 0o777).toBe(0o640);
  });

  it('leaves no temporary file behind after an atomic write', async () => {
    await applyPatchTool(args({ path: 'src/util.ts', oldText: '"demo"', newText: '"x"' }), ctx);
    const entries = await globTool(args({ pattern: 'src/*' }), ctx);
    expect(entries.content).not.toContain('.tmp');
    expect(entries.content).not.toContain('.vinax-');
  });

  it('creates a new file with write_file', async () => {
    const r = await writeFileTool(args({ path: 'src/new.ts', content: 'export const n = 1;\n' }), ctx);
    expect(r.ok).toBe(true);
    expect(await readFile(join(root, 'src/new.ts'), 'utf8')).toBe('export const n = 1;\n');
  });

  it('REFUSES to overwrite a file the model has not read', async () => {
    const r = await writeFileTool(args({ path: 'src/util.ts', content: 'wiped\n' }), ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('expectedHash');
    expect(await readFile(join(root, 'src/util.ts'), 'utf8')).toContain('demo');
  });

  it('allows an overwrite when the hash matches', async () => {
    const read = await readFileTool(args({ path: 'src/util.ts' }), ctx);
    const r = await writeFileTool(args({ path: 'src/util.ts', content: 'ok\n', expectedHash: String(read.meta?.hash) }), ctx);
    expect(r.ok).toBe(true);
  });

  it('REFUSES to write outside the workspace, in any mode', async () => {
    const auto = await testContext({ root, config: { approval: 'full-auto' } });
    const r = await writeFileTool(args({ path: '../escaped.txt', content: 'nope' }), auto);
    expect(r.ok).toBe(false);
    expect(r.permissionDenied).toBe(true);
  });

  it('REFUSES to write through a symlink that leaves the workspace', async () => {
    await symlink(join(root, '..'), join(root, 'out'), 'dir');
    const r = await writeFileTool(args({ path: 'out/escaped.txt', content: 'nope' }), ctx);
    expect(r.ok).toBe(false);
  });

  it('ASKS with critical risk before writing a credential file', async () => {
    const strict = await testContext({ root, answer: () => 'reject' });
    const read = await readFileTool(args({ path: '.env' }), await testContext({ root }));
    const r = await writeFileTool(args({ path: '.env', content: 'X=1\n', expectedHash: String(read.meta?.hash) }), strict);
    expect(r.ok).toBe(false);
    expect(strict.asked[0].risk).toBe('critical');
  });

  it('moves, copies and creates directories', async () => {
    expect((await createDirectoryTool(args({ path: 'src/deep/nested' }), ctx)).ok).toBe(true);
    expect((await copyFileTool(args({ from: 'src/util.ts', to: 'src/deep/copy.ts' }), ctx)).ok).toBe(true);
    expect((await moveFileTool(args({ from: 'src/deep/copy.ts', to: 'src/deep/moved.ts' }), ctx)).ok).toBe(true);
    expect(await readFile(join(root, 'src/deep/moved.ts'), 'utf8')).toContain('demo');
  });

  it('deletes one file but never a directory tree', async () => {
    expect((await deleteFileTool(args({ path: 'docs/readme.md' }), ctx)).ok).toBe(true);
    const dir = await deleteFileTool(args({ path: 'docs' }), ctx);
    expect(dir.ok).toBe(false);
    expect(dir.content).toContain('never directory trees');
  });

  it('records every change in the journal for undo', async () => {
    await applyPatchTool(args({ path: 'src/util.ts', oldText: '"demo"', newText: '"x"' }), ctx);
    await writeFileTool(args({ path: 'src/added.ts', content: 'export {};\n' }), ctx);
    expect(ctx.journal.changedFiles()).toEqual([join('src', 'util.ts'), join('src', 'added.ts')]);
  });
});

describe('diffs', () => {
  it('produces a unified diff with hunk headers', () => {
    const d = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n');
    expect(d).toContain('@@');
    expect(d).toContain('-b');
    expect(d).toContain('+B');
  });

  it('counts added and removed lines', () => {
    expect(diffStat('a\nb\n', 'a\nb\nc\nd\n')).toEqual({ added: 2, removed: 0 });
    expect(diffStat('a\nb\nc\n', 'a\n')).toEqual({ added: 0, removed: 2 });
  });

  it('handles a one-line change in a large file without exploding', () => {
    const before = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 2000', 'line TWO THOUSAND');
    const d = unifiedDiff(before, after);
    expect(d).toContain('+line TWO THOUSAND');
    expect(d.split('\n').length).toBeLessThan(30);
  });

  it('truncates a very large diff rather than printing forever', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `a${i}`).join('\n');
    const after = Array.from({ length: 2000 }, (_, i) => `b${i}`).join('\n');
    expect(unifiedDiff(before, after, { maxLines: 50 })).toContain('diff truncated');
  });
});
