/**
 * Reading files.
 *
 * Every read goes through the same gate: resolve the path against the
 * workspace, refuse credential files unless the user says otherwise, refuse
 * binaries, cap the size, and hand back a content hash the model must quote
 * when it edits the file. The hash is what turns "the model read this" into
 * something the write path can verify.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, parse, resolve } from 'node:path';
import { resolvePath, type Workspace } from '../../security/paths.js';
import { isProtectedPath, redact } from '../../security/secrets.js';
import { clip, contentHash, countLines, detectNewline, looksBinary } from '../../utils/text.js';
import { isBinaryExtension, loadIgnores, relPosix } from '../../project/ignore.js';
import { argList, argNum, argStr, fail, ok, type ToolContext, type ToolResult } from '../types.js';

/**
 * Resolve a path and clear it with the permission engine.
 *
 * Two questions, not one: is the path inside the workspace, and if it is
 * credential material, has the user agreed to this specific read? Reading a
 * .env is not forbidden — it is confirmed, with the consequence spelled out,
 * because its contents become model context the moment it is read.
 */
export async function gateRead(
  ctx: ToolContext,
  rawPath: string,
): Promise<{ ok: true; path: string; display: string } | { ok: false; result: ToolResult }> {
  const r = await resolvePath(ctx.ws, rawPath);
  if (!r.ok) {
    if (r.reason === 'outside_workspace' || r.reason === 'symlink_escape') {
      const decision = await ctx.permissions.check({
        kind: 'outside-workspace',
        title: `Read ${rawPath}, which is outside the workspace?`,
        detail: [r.detail, '', 'VinaX only works inside directories you approved.'],
        risk: 'elevated',
        scopeKey: 'outside-workspace:read',
        scopeLabel: 'Allow reads outside the workspace this session',
      });
      if (decision.outcome === 'deny') {
        return { ok: false, result: { ...fail(`Denied: ${r.detail}`), permissionDenied: true } };
      }
      // Approved: widen the roots to the filesystem root that the requested
      // path actually lives on (drive-aware, so this works on Windows too),
      // and re-resolve. Every other refusal — device paths, UNC, NUL bytes —
      // stays in force; approval widens the boundary, it does not remove it.
      const wide: Workspace = { root: ctx.ws.root, roots: [parse(resolve(ctx.ws.root, rawPath)).root] };
      const again = await resolvePath(wide, rawPath);
      if (!again.ok) return { ok: false, result: fail(`Cannot use that path: ${again.detail}`) };
      return { ok: true, path: again.path, display: again.display };
    }
    return { ok: false, result: fail(`Cannot use that path: ${r.detail}`) };
  }

  // Check both the workspace-relative name and the real absolute path: a
  // credential directory may only be visible in one of them.
  const byDisplay = isProtectedPath(r.display);
  const prot = byDisplay.protected ? byDisplay : isProtectedPath(r.path);
  if (prot.protected) {
    const decision = await ctx.permissions.check({
      kind: 'protected-read',
      title: `Read the protected file ${r.display}?`,
      detail: [
        prot.reason ?? 'This file usually holds credentials.',
        '',
        'If you allow this, its contents are sent to the VinaX AI service as',
        'part of the conversation context for this task.',
      ],
      risk: 'elevated',
      scopeKey: `protected-read:${r.display}`,
      scopeLabel: 'Allow reading this file for the rest of the session',
    });
    if (decision.outcome === 'deny') {
      return {
        ok: false,
        result: {
          ...fail(`Denied: ${r.display} is protected credential material and the user did not approve reading it.`),
          permissionDenied: true,
        },
      };
    }
  }
  return { ok: true, path: r.path, display: r.display };
}

interface LoadedFile {
  text: string;
  hash: string;
  lines: number;
  bytes: number;
  newline: string;
  truncated: boolean;
}

async function load(path: string, maxBytes: number): Promise<LoadedFile | { error: string }> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return { error: 'no such file' };
  }
  if (st.isDirectory()) return { error: 'that path is a directory — use list_directory' };
  if (!st.isFile()) return { error: 'that path is not a regular file' };
  if (st.size > maxBytes) {
    return { error: `file is ${st.size.toLocaleString('en-US')} bytes, over the ${maxBytes.toLocaleString('en-US')} byte limit — use read_file_range or grep` };
  }
  const buf = await readFile(path);
  if (looksBinary(buf) || isBinaryExtension(basename(path))) return { error: 'file is binary, not text' };
  const text = buf.toString('utf8');
  return {
    text,
    hash: contentHash(buf),
    lines: countLines(text),
    bytes: st.size,
    newline: detectNewline(text) === '\r\n' ? 'CRLF' : 'LF',
    truncated: false,
  };
}

export async function readFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const gate = await gateRead(ctx, argStr(args, 'path'));
  if (!gate.ok) return gate.result;
  ctx.ui.step(`Read ${gate.display}`);
  const loaded = await load(gate.path, ctx.config.maxFileBytes);
  if ('error' in loaded) return fail(`Cannot read ${gate.display}: ${loaded.error}`);
  ctx.ledger.filesRead.add(gate.display);
  const clipped = clip(redact(loaded.text), ctx.config.maxOutputChars);
  const header = `${gate.display} — ${loaded.lines} lines, ${loaded.newline} endings, hash ${loaded.hash}${clipped.truncated ? ' (TRUNCATED — use read_file_range for the rest)' : ''}`;
  return ok(`${header}\n\n${clipped.text}`, { path: gate.display, hash: loaded.hash });
}

export async function readFilesTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const paths = argList(args, 'paths').slice(0, 20);
  if (!paths.length) return fail('read_files needs at least one path');
  const parts: string[] = [];
  let any = false;
  // The whole point of a batch read is one budget for the batch; a single
  // huge file must not eat every other file's share of it.
  const budget = Math.max(2000, Math.floor(ctx.config.maxOutputChars / paths.length));
  for (const p of paths) {
    const gate = await gateRead(ctx, p);
    if (!gate.ok) {
      parts.push(`--- ${p} ---\n${gate.result.content}`);
      continue;
    }
    ctx.ui.step(`Read ${gate.display}`);
    const loaded = await load(gate.path, ctx.config.maxFileBytes);
    if ('error' in loaded) {
      parts.push(`--- ${gate.display} ---\nCannot read: ${loaded.error}`);
      continue;
    }
    any = true;
    ctx.ledger.filesRead.add(gate.display);
    const clipped = clip(redact(loaded.text), budget);
    parts.push(
      `--- ${gate.display} (${loaded.lines} lines, hash ${loaded.hash}${clipped.truncated ? ', TRUNCATED' : ''}) ---\n${clipped.text}`,
    );
  }
  return any ? ok(parts.join('\n\n')) : fail(parts.join('\n\n'));
}

export async function readFileRangeTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const gate = await gateRead(ctx, argStr(args, 'path'));
  if (!gate.ok) return gate.result;
  const start = Math.max(1, argNum(args, 'start', 1));
  const end = Math.max(start, argNum(args, 'end', start + 200));
  ctx.ui.step(`Read ${gate.display}:${start}-${end}`);
  const loaded = await load(gate.path, Math.max(ctx.config.maxFileBytes, 20_000_000));
  if ('error' in loaded) return fail(`Cannot read ${gate.display}: ${loaded.error}`);
  ctx.ledger.filesRead.add(gate.display);
  const lines = loaded.text.split(/\r?\n/);
  if (start > lines.length) {
    return fail(`${gate.display} has ${lines.length} lines; line ${start} does not exist.`);
  }
  const slice = lines.slice(start - 1, end);
  const numbered = slice.map((l, i) => `${String(start + i).padStart(6)}\t${l}`).join('\n');
  const clipped = clip(redact(numbered), ctx.config.maxOutputChars);
  return ok(
    `${gate.display} lines ${start}-${Math.min(end, lines.length)} of ${lines.length}, whole-file hash ${loaded.hash}\n\n${clipped.text}`,
    { path: gate.display, hash: loaded.hash },
  );
}

export async function fileStatTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const gate = await gateRead(ctx, argStr(args, 'path'));
  if (!gate.ok) return gate.result;
  let st;
  try {
    st = await stat(gate.path);
  } catch {
    return fail(`${gate.display} does not exist.`);
  }
  if (st.isDirectory()) {
    const entries = await readdir(gate.path).catch(() => []);
    return ok(`${gate.display} — directory, ${entries.length} entries, modified ${st.mtime.toISOString()}`);
  }
  const buf = await readFile(gate.path).catch(() => null);
  if (!buf) return fail(`Cannot read ${gate.display}.`);
  const binary = looksBinary(buf) || isBinaryExtension(basename(gate.path));
  if (binary) {
    return ok(`${gate.display} — binary file, ${st.size.toLocaleString('en-US')} bytes, modified ${st.mtime.toISOString()}`);
  }
  const text = buf.toString('utf8');
  return ok(
    [
      `${gate.display} — file`,
      `size: ${st.size.toLocaleString('en-US')} bytes`,
      `lines: ${countLines(text)}`,
      `newlines: ${detectNewline(text) === '\r\n' ? 'CRLF' : 'LF'}`,
      `hash: ${contentHash(buf)}`,
      `modified: ${st.mtime.toISOString()}`,
    ].join('\n'),
    { hash: contentHash(buf) },
  );
}

export async function listDirectoryTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const target = argStr(args, 'path', '.') || '.';
  const gate = await gateRead(ctx, target);
  if (!gate.ok) return gate.result;
  ctx.ui.step(`List ${gate.display}`);
  let entries;
  try {
    entries = await readdir(gate.path, { withFileTypes: true });
  } catch {
    return fail(`Cannot list ${gate.display} — it is not a directory, or it does not exist.`);
  }
  const ignores = await loadIgnores(ctx.ws.root, { useGitignore: ctx.config.useGitignore });
  const rows: string[] = [];
  let hidden = 0;
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(gate.path, e.name);
    const rel = relPosix(ctx.ws.root, full);
    if (ignores.ignores(rel, e.isDirectory())) { hidden += 1; continue; }
    if (e.isDirectory()) {
      rows.push(`  ${e.name}/`);
      continue;
    }
    const st = await stat(full).catch(() => null);
    rows.push(`  ${e.name}${st ? `  (${st.size.toLocaleString('en-US')} bytes)` : ''}`);
  }
  const footer = hidden ? `\n\n(${hidden} ignored ${hidden === 1 ? 'entry' : 'entries'} not listed — build output, dependencies or .gitignore matches)` : '';
  return ok(`${gate.display}\n${rows.join('\n') || '  (empty)'}${footer}`);
}

export async function directoryTreeTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const target = argStr(args, 'path', '.') || '.';
  const depth = Math.min(8, Math.max(1, argNum(args, 'depth', 3)));
  const gate = await gateRead(ctx, target);
  if (!gate.ok) return gate.result;
  ctx.ui.step(`Tree of ${gate.display}`);
  const ignores = await loadIgnores(ctx.ws.root, { useGitignore: ctx.config.useGitignore });
  const lines: string[] = [gate.display === '.' ? '.' : gate.display];
  const MAX_ENTRIES = 800;
  let count = 0;
  let capped = false;

  const walk = async (dir: string, prefix: string, level: number): Promise<void> => {
    if (level > depth || capped) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const keep = entries
      .filter((e) => !ignores.ignores(relPosix(ctx.ws.root, join(dir, e.name)), e.isDirectory()))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (let i = 0; i < keep.length; i += 1) {
      if (count >= MAX_ENTRIES) { capped = true; return; }
      const e = keep[i];
      const last = i === keep.length - 1;
      lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.isDirectory() ? '/' : ''}`);
      count += 1;
      if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}${last ? '    ' : '│   '}`, level + 1);
    }
  };
  await walk(gate.path, '', 1);
  if (capped) lines.push(`… stopped at ${MAX_ENTRIES} entries; use glob or grep to narrow the search`);
  return ok(clip(lines.join('\n'), ctx.config.maxOutputChars).text);
}
