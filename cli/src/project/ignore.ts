/**
 * What VinaX will and will not walk.
 *
 * Two questions, one module:
 *
 *  - Glob matching. Every file tool takes patterns, and shelling out to a
 *    globber for `src/**\/*.ts` is not worth a dependency.
 *  - Ignore rules. `.gitignore` is respected by default, plus a built-in list
 *    of directories that are always generated, always huge, and never what a
 *    coding question is about. Walking node_modules once is enough to learn
 *    this the hard way.
 *
 * Ignored files are not forbidden — a user can ask for one by name and the
 * normal permission flow applies. They are simply not what a search returns.
 */
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Always skipped when walking: generated, vendored or enormous. */
export const DEFAULT_IGNORES = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.vite',
  '.wrangler',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.gradle',
  '.idea',
  '.vscode-test',
  'Pods',
  'DerivedData',
  '.terraform',
  '.serverless',
];

/** File extensions that are never source text. */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'icns', 'tiff', 'psd',
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'mp4', 'mov', 'avi', 'mkv', 'webm',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'jar', 'war',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'so', 'dylib', 'dll', 'exe', 'bin', 'o', 'a', 'class', 'pyc', 'wasm',
  'db', 'sqlite', 'sqlite3', 'lock',
]);

export function isBinaryExtension(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot > 0 && BINARY_EXT.has(name.slice(dot + 1).toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* Globs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Compile a glob into a regular expression.
 *
 * Supports the syntax people actually type: `*`, `?`, `**`, `{a,b}` and
 * `[abc]`. `*` stops at a separator, `**` crosses them — including the
 * `a/**\/b` case where `**` may also match zero directories, which is the
 * part naive implementations get wrong.
 */
export function globToRegExp(pattern: string, opts: { caseInsensitive?: boolean } = {}): RegExp {
  const p = pattern.replace(/\\/g, '/');
  let re = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      const doubled = p[i + 1] === '*';
      if (doubled) {
        // "a/**/b" must also match "a/b": swallow the following slash.
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 3; continue; }
        re += '.*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') { re += '[^/]'; i += 1; continue; }
    if (c === '[') {
      const close = p.indexOf(']', i + 1);
      if (close === -1) { re += '\\['; i += 1; continue; }
      const body = p.slice(i + 1, close).replace(/^!/, '^');
      re += `[${body}]`;
      i = close + 1;
      continue;
    }
    if (c === '{') {
      const close = p.indexOf('}', i + 1);
      if (close === -1) { re += '\\{'; i += 1; continue; }
      const parts = p.slice(i + 1, close).split(',').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      re += `(?:${parts.join('|')})`;
      i = close + 1;
      continue;
    }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${re}$`, opts.caseInsensitive ? 'i' : '');
}

/** Match a workspace-relative path against a glob. */
export function matchGlob(pattern: string, relPath: string, opts: { caseInsensitive?: boolean } = {}): boolean {
  const normalized = relPath.split(sep).join('/');
  const re = globToRegExp(pattern, opts);
  if (re.test(normalized)) return true;
  // A bare pattern with no separator matches anywhere in the tree, which is
  // what "*.test.ts" is expected to mean.
  if (!pattern.includes('/')) {
    return globToRegExp(`**/${pattern}`, opts).test(normalized);
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* .gitignore                                                                 */
/* -------------------------------------------------------------------------- */

interface Rule {
  re: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

export interface IgnoreSet {
  /** True when this path should be skipped by a walk. */
  ignores(relPath: string, isDir: boolean): boolean;
}

function compileLine(line: string): Rule | null {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith('#')) return null;
  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);
  const dirOnly = pattern.endsWith('/');
  if (dirOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith('/');
  if (anchored) pattern = pattern.slice(1);
  if (!pattern) return null;
  // An unanchored pattern matches at any depth, exactly like git's rule.
  const full = anchored || pattern.includes('/') ? pattern : `**/${pattern}`;
  // A directory rule also covers everything beneath it.
  const re = new RegExp(`${globToRegExp(full).source.slice(0, -1)}(?:/.*)?$`);
  return { re, negated, dirOnly };
}

/**
 * Build the ignore set for a workspace: the built-in list plus every
 * `.gitignore` found at the root (nested ones are read as the walk descends,
 * which is handled by the caller passing extra lines).
 */
export async function loadIgnores(root: string, opts: { useGitignore?: boolean } = {}): Promise<IgnoreSet> {
  const rules: Rule[] = [];
  for (const name of DEFAULT_IGNORES) {
    const r = compileLine(`${name}/`);
    if (r) rules.push(r);
  }
  if (opts.useGitignore !== false) {
    for (const file of ['.gitignore', '.git/info/exclude']) {
      try {
        const text = await readFile(join(root, file), 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const r = compileLine(line);
          if (r) rules.push(r);
        }
      } catch {
        /* no such ignore file — normal */
      }
    }
  }
  return {
    ignores(relPath: string, isDir: boolean): boolean {
      const p = relPath.split(sep).join('/');
      if (!p || p === '.') return false;
      let ignored = false;
      for (const rule of rules) {
        if (rule.dirOnly && !isDir && !rule.re.test(p)) continue;
        if (!rule.re.test(p)) continue;
        ignored = !rule.negated;
      }
      return ignored;
    },
  };
}

/** Relative path in the forward-slash form every pattern is written in. */
export function relPosix(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/');
}
