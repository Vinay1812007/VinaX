/**
 * Finding things.
 *
 * A coding agent's first move on an unfamiliar repository is always a search,
 * so these three tools decide how quickly it gets useful and how much of the
 * user's token budget it burns getting there. Two rules shape them:
 *
 *  - Never walk what nobody asked about. node_modules and dist are skipped by
 *    default; so is anything .gitignore lists.
 *  - Bound everything. A grep over a monorepo can match tens of thousands of
 *    lines; the caps here are what stop that becoming a wall of context.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolvePath } from '../../security/paths.js';
import { isProtectedPath, redact } from '../../security/secrets.js';
import { isBinaryExtension, loadIgnores, matchGlob, relPosix, type IgnoreSet } from '../../project/ignore.js';
import { looksBinary } from '../../utils/text.js';
import { argBool, argStr, fail, ok, type ToolContext, type ToolResult } from '../types.js';

const MAX_WALK = 40_000;

interface Walked {
  abs: string;
  rel: string;
  mtime: number;
  size: number;
}

/** Walk the workspace, honouring ignores and a hard entry ceiling. */
async function walk(root: string, ignores: IgnoreSet, signal: AbortSignal): Promise<{ files: Walked[]; capped: boolean }> {
  const files: Walked[] = [];
  let capped = false;
  const queue: string[] = [root];
  while (queue.length) {
    if (signal.aborted) break;
    const dir = queue.shift() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relPosix(root, abs);
      if (ignores.ignores(rel, e.isDirectory())) continue;
      if (e.isSymbolicLink()) continue; // a walk must not follow links out of the tree
      if (e.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      if (files.length >= MAX_WALK) { capped = true; return { files, capped }; }
      const st = await stat(abs).catch(() => null);
      files.push({ abs, rel, mtime: st?.mtimeMs ?? 0, size: st?.size ?? 0 });
    }
  }
  return { files, capped };
}

async function searchRoot(ctx: ToolContext, rawPath: string): Promise<{ ok: true; root: string; display: string } | { ok: false; result: ToolResult }> {
  const target = rawPath || '.';
  const r = await resolvePath(ctx.ws, target);
  if (!r.ok) return { ok: false, result: { ...fail(`Cannot search there: ${r.detail}`), permissionDenied: true } };
  return { ok: true, root: r.path, display: r.display };
}

export async function globTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = argStr(args, 'pattern');
  if (!pattern) return fail('glob needs a pattern.');
  const base = await searchRoot(ctx, argStr(args, 'path', '.'));
  if (!base.ok) return base.result;
  ctx.ui.step(`Find ${pattern}`);
  const ignores = await loadIgnores(ctx.ws.root, { useGitignore: ctx.config.useGitignore });
  const { files, capped } = await walk(base.root, ignores, ctx.signal);
  const matched = files
    .filter((f) => matchGlob(pattern, f.rel))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 300);
  if (!matched.length) {
    return ok(`No files match ${pattern}${capped ? ' (the search stopped early — the tree is very large)' : ''}.`);
  }
  const rows = matched.map((f) => `${f.rel}  (${f.size.toLocaleString('en-US')} bytes)`);
  return ok(`${matched.length} match${matched.length === 1 ? '' : 'es'} for ${pattern}, newest first:\n${rows.join('\n')}`);
}

export async function searchFilesTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = argStr(args, 'query');
  if (!query) return fail('search_files needs a query.');
  const base = await searchRoot(ctx, argStr(args, 'path', '.'));
  if (!base.ok) return base.result;
  ctx.ui.step(`Find files named like ${query}`);
  const ignores = await loadIgnores(ctx.ws.root, { useGitignore: ctx.config.useGitignore });
  const { files } = await walk(base.root, ignores, ctx.signal);
  const lower = query.toLowerCase();
  const looksGlob = /[*?[\]{}]/.test(query);
  const matched = files
    .filter((f) => (looksGlob ? matchGlob(query, f.rel, { caseInsensitive: true }) : f.rel.toLowerCase().includes(lower)))
    .sort((a, b) => a.rel.length - b.rel.length)
    .slice(0, 200);
  if (!matched.length) return ok(`No file names match "${query}".`);
  return ok(`${matched.length} file${matched.length === 1 ? '' : 's'} matching "${query}":\n${matched.map((f) => f.rel).join('\n')}`);
}

export async function grepTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const pattern = argStr(args, 'pattern');
  if (!pattern) return fail('grep needs a pattern.');
  let re: RegExp;
  try {
    re = new RegExp(pattern, argBool(args, 'ignoreCase') ? 'i' : '');
  } catch (e) {
    return fail(`That is not a valid regular expression: ${e instanceof Error ? e.message : String(e)}`);
  }
  const base = await searchRoot(ctx, argStr(args, 'path', '.'));
  if (!base.ok) return base.result;
  const globFilter = argStr(args, 'glob');
  ctx.ui.step(`Search for /${pattern}/${globFilter ? ` in ${globFilter}` : ''}`);

  const ignores = await loadIgnores(ctx.ws.root, { useGitignore: ctx.config.useGitignore });
  // A single file is a legitimate grep target, not only a directory.
  const st = await stat(base.root).catch(() => null);
  const candidates: Walked[] = st?.isFile()
    ? [{ abs: base.root, rel: base.display, mtime: 0, size: st.size }]
    : (await walk(base.root, ignores, ctx.signal)).files;

  const MAX_MATCHES = 200;
  const MAX_PER_FILE = 20;
  const out: string[] = [];
  let total = 0;
  let filesWithMatches = 0;
  let scanned = 0;

  for (const f of candidates) {
    if (ctx.signal.aborted) break;
    if (total >= MAX_MATCHES) break;
    if (globFilter && !matchGlob(globFilter, f.rel)) continue;
    if (isBinaryExtension(f.rel)) continue;
    // Credential files are never searched implicitly — a grep for "token"
    // must not become a way around the protected-file prompt.
    if (isProtectedPath(f.rel).protected) continue;
    if (f.size > ctx.config.maxFileBytes) continue;
    const buf = await readFile(f.abs).catch(() => null);
    if (!buf || looksBinary(buf)) continue;
    scanned += 1;
    const lines = buf.toString('utf8').split(/\r?\n/);
    let inFile = 0;
    for (let i = 0; i < lines.length && total < MAX_MATCHES; i += 1) {
      re.lastIndex = 0;
      if (!re.test(lines[i])) continue;
      if (inFile === 0) { out.push(`\n${f.rel}`); filesWithMatches += 1; }
      if (inFile < MAX_PER_FILE) {
        out.push(`  ${String(i + 1).padStart(5)}: ${redact(lines[i].trim().slice(0, 300))}`);
      } else if (inFile === MAX_PER_FILE) {
        out.push('  … more matches in this file');
      }
      inFile += 1;
      total += 1;
    }
  }

  if (!total) return ok(`No matches for /${pattern}/ across ${scanned} files.`);
  const capped = total >= MAX_MATCHES ? `\n\n(stopped at ${MAX_MATCHES} matches — narrow the pattern or pass a glob)` : '';
  return ok(`${total} match${total === 1 ? '' : 'es'} in ${filesWithMatches} file${filesWithMatches === 1 ? '' : 's'}:${out.join('\n')}${capped}`);
}
