/**
 * Changing files.
 *
 * Every write in VinaX CLI obeys the same five rules, and the tests hold each
 * of them:
 *
 *  1. RESOLVE FIRST. The path goes through the workspace gate, so a symlink
 *     cannot make a write land somewhere else.
 *  2. SHOW THE DIFF. The permission prompt renders the actual change. Nobody
 *     can approve an edit they have not seen.
 *  3. CHECK THE HASH. If the model read the file, it quotes the hash back.
 *     A mismatch means the file changed underneath it — the write is refused
 *     and the model is told to re-read, rather than silently overwriting
 *     whatever the user did in their editor thirty seconds ago.
 *  4. WRITE ATOMICALLY. Content goes to a temporary file in the same
 *     directory and is renamed over the target, so a crash mid-write leaves
 *     the original intact rather than a half-file.
 *  5. PRESERVE WHAT WAS THERE. File mode and newline style survive the edit;
 *     a CRLF file does not silently become LF because the agent touched it.
 */
import { chmod, mkdir, rename, rm, stat, writeFile as fsWriteFile, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolvePath } from '../../security/paths.js';
import { isProtectedPath } from '../../security/secrets.js';
import { contentHash, detectNewline, looksBinary, withNewline, type Newline } from '../../utils/text.js';
import { diffStat, unifiedDiff } from './diff.js';
import { argStr, fail, ok, type ToolContext, type ToolResult } from '../types.js';

interface WriteTarget {
  path: string;
  display: string;
  /** Null when the file does not exist yet. */
  current: string | null;
  currentHash: string | null;
  newline: Newline;
  mode: number | null;
}

/** Resolve a write target and refuse the ones that are never appropriate. */
async function gateWrite(
  ctx: ToolContext,
  rawPath: string,
): Promise<{ ok: true; target: WriteTarget } | { ok: false; result: ToolResult }> {
  const r = await resolvePath(ctx.ws, rawPath);
  if (!r.ok) {
    if (r.reason === 'outside_workspace' || r.reason === 'symlink_escape') {
      return {
        ok: false,
        result: {
          ...fail(`Denied: ${r.detail}. VinaX only writes inside the approved workspace; ask the user to add that directory with --add-dir if it is genuinely part of this task.`),
          permissionDenied: true,
        },
      };
    }
    return { ok: false, result: fail(`Cannot use that path: ${r.detail}`) };
  }
  const prot = isProtectedPath(r.display).protected ? isProtectedPath(r.display) : isProtectedPath(r.path);
  if (prot.protected) {
    const decision = await ctx.permissions.check({
      kind: 'protected-read',
      title: `Write to the protected file ${r.display}?`,
      detail: [prot.reason ?? 'This file usually holds credentials.', '', 'VinaX does not modify credential files without you saying so.'],
      risk: 'critical',
      scopeKey: `protected-write:${r.display}`,
      scopeLabel: 'Allow writing this file for the rest of the session',
    });
    if (decision.outcome === 'deny') {
      return { ok: false, result: { ...fail(`Denied: ${r.display} is protected credential material.`), permissionDenied: true } };
    }
  }

  let current: string | null = null;
  let currentHash: string | null = null;
  let mode: number | null = null;
  let newline: Newline = '\n';
  try {
    const st = await stat(r.path);
    if (st.isDirectory()) return { ok: false, result: fail(`${r.display} is a directory.`) };
    mode = st.mode & 0o777;
    const buf = await readFile(r.path);
    if (looksBinary(buf)) {
      return { ok: false, result: fail(`${r.display} is a binary file; VinaX does not edit binaries.`) };
    }
    current = buf.toString('utf8');
    currentHash = contentHash(buf);
    newline = detectNewline(current);
  } catch {
    /* new file */
  }
  return { ok: true, target: { path: r.path, display: r.display, current, currentHash, newline, mode } };
}

/** Write `content` to `path` atomically, preserving mode where there was one. */
export async function atomicWrite(path: string, content: string, mode: number | null): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  // Same directory, so the rename is a true atomic replace rather than a
  // cross-device copy.
  const tmp = join(dir, `.vinax-${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await fsWriteFile(tmp, content, 'utf8');
    if (mode !== null) await chmod(tmp, mode).catch(() => undefined);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** The permission prompt + journal + write that every edit shares. */
async function applyEdit(
  ctx: ToolContext,
  target: WriteTarget,
  nextRaw: string,
  opts: { verb: string; scopeKey: string; scopeLabel: string },
): Promise<ToolResult> {
  const before = target.current ?? '';
  const next = withNewline(nextRaw, target.newline);
  if (target.current !== null && next === before) {
    return ok(`${target.display} already has exactly that content; nothing to change.`);
  }
  if (next.length > ctx.config.maxPatchChars && target.current !== null) {
    return fail(`That change would write ${next.length.toLocaleString('en-US')} characters, over the ${ctx.config.maxPatchChars.toLocaleString('en-US')} limit for one edit.`);
  }

  const diff = unifiedDiff(before, next, { context: 3, maxLines: 200 });
  const stat = diffStat(before, next);
  const decision = await ctx.permissions.check({
    kind: 'write',
    title: `${opts.verb} ${target.display}?`,
    detail: [
      target.current === null ? 'This creates a new file.' : `+${stat.added} −${stat.removed}`,
      '',
      ...(diff ? diff.split('\n') : ['(no textual difference)']),
    ],
    risk: 'routine',
    scopeKey: opts.scopeKey,
    scopeLabel: opts.scopeLabel,
  });
  if (decision.outcome === 'deny') {
    return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };
  }

  // Re-read immediately before writing. Between the prompt appearing and the
  // user answering it, a save in their editor is entirely possible.
  if (target.current !== null) {
    const nowBuf = await readFile(target.path).catch(() => null);
    if (nowBuf && contentHash(nowBuf) !== target.currentHash) {
      return fail(
        `${target.display} changed while VinaX was waiting for approval. Nothing was written. Re-read the file and redo the edit against its current content.`,
      );
    }
  }

  await atomicWrite(target.path, next, target.mode);
  ctx.journal.recordEdit({
    path: target.path,
    display: target.display,
    before: target.current,
    after: next,
    hashAfter: contentHash(next),
    at: Date.now(),
    group: ctx.editGroup,
  });
  ctx.ledger.filesChanged.add(target.display);
  ctx.ui.diff(target.display, diff);
  ctx.ui.step(`Updated ${target.display}`);
  return ok(
    `${target.display} written (+${stat.added} −${stat.removed}). New hash ${contentHash(next)}.`,
    { path: target.display, added: stat.added, removed: stat.removed },
  );
}

export async function writeFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const gate = await gateWrite(ctx, argStr(args, 'path'));
  if (!gate.ok) return gate.result;
  const target = gate.target;
  const content = argStr(args, 'content');
  const expected = argStr(args, 'expectedHash');

  if (target.current !== null) {
    if (!expected) {
      return fail(
        `${target.display} already exists. Read it first and pass its expectedHash, or use apply_patch to change part of it — VinaX will not overwrite a file the model has not read.`,
      );
    }
    if (expected !== target.currentHash) {
      return fail(
        `${target.display} has changed since it was read (expected ${expected}, found ${target.currentHash}). Nothing was written. Re-read the file and retry.`,
      );
    }
  }
  return applyEdit(ctx, target, content, {
    verb: target.current === null ? 'Create' : 'Overwrite',
    scopeKey: 'edit:project',
    scopeLabel: 'Allow project edits this session',
  });
}

export async function applyPatchTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const gate = await gateWrite(ctx, argStr(args, 'path'));
  if (!gate.ok) return gate.result;
  const target = gate.target;
  if (target.current === null) return fail(`${target.display} does not exist; use write_file to create it.`);

  const oldText = argStr(args, 'oldText');
  const newText = argStr(args, 'newText');
  const expected = argStr(args, 'expectedHash');
  if (!oldText) return fail('apply_patch needs oldText — the exact snippet to replace.');
  if (expected && expected !== target.currentHash) {
    return fail(
      `${target.display} has changed since it was read (expected ${expected}, found ${target.currentHash}). Nothing was written. Re-read the file and redo the patch.`,
    );
  }

  // Match on the file's own newline style so a model that emits \n still
  // matches a CRLF file.
  const haystack = target.current.replace(/\r\n/g, '\n');
  const needle = oldText.replace(/\r\n/g, '\n');
  const first = haystack.indexOf(needle);
  if (first === -1) {
    return fail(
      `oldText was not found in ${target.display}. Read the file again and copy the snippet exactly, including indentation.`,
    );
  }
  if (haystack.indexOf(needle, first + 1) !== -1) {
    const count = haystack.split(needle).length - 1;
    return fail(
      `oldText appears ${count} times in ${target.display}, so the patch is ambiguous. Include more surrounding lines to make it unique.`,
    );
  }
  const next = haystack.slice(0, first) + newText.replace(/\r\n/g, '\n') + haystack.slice(first + needle.length);
  return applyEdit(ctx, target, next, {
    verb: 'Modify',
    scopeKey: 'edit:project',
    scopeLabel: 'Allow project edits this session',
  });
}

export async function createDirectoryTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const r = await resolvePath(ctx.ws, argStr(args, 'path'));
  if (!r.ok) return { ...fail(`Cannot use that path: ${r.detail}`), permissionDenied: r.reason === 'outside_workspace' };
  const decision = await ctx.permissions.check({
    kind: 'write',
    title: `Create the directory ${r.display}?`,
    detail: [r.path],
    risk: 'routine',
    scopeKey: 'edit:project',
    scopeLabel: 'Allow project edits this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };
  await mkdir(r.path, { recursive: true });
  ctx.ui.step(`Created ${r.display}/`);
  return ok(`${r.display}/ created.`);
}

export async function moveFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return relocate(args, ctx, 'move');
}

export async function copyFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  return relocate(args, ctx, 'copy');
}

async function relocate(args: Record<string, unknown>, ctx: ToolContext, kind: 'move' | 'copy'): Promise<ToolResult> {
  const fromR = await resolvePath(ctx.ws, argStr(args, 'from'));
  if (!fromR.ok) return { ...fail(`Cannot use the source path: ${fromR.detail}`), permissionDenied: true };
  const toR = await resolvePath(ctx.ws, argStr(args, 'to'));
  if (!toR.ok) return { ...fail(`Cannot use the destination path: ${toR.detail}`), permissionDenied: true };

  const src = await readFile(fromR.path).catch(() => null);
  if (src === null) return fail(`${fromR.display} does not exist or cannot be read.`);
  const exists = await stat(toR.path).then(() => true).catch(() => false);

  const decision = await ctx.permissions.check({
    kind: 'write',
    title: `${kind === 'move' ? 'Move' : 'Copy'} ${fromR.display} to ${toR.display}?`,
    detail: exists ? [`${toR.display} already exists and will be overwritten.`] : [],
    risk: exists ? 'elevated' : 'routine',
    scopeKey: 'edit:project',
    scopeLabel: 'Allow project edits this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };

  await mkdir(dirname(toR.path), { recursive: true });
  const previous = exists ? (await readFile(toR.path, 'utf8').catch(() => null)) : null;
  if (kind === 'move') {
    await rename(fromR.path, toR.path);
    ctx.journal.recordEdit({ path: fromR.path, display: fromR.display, before: src.toString('utf8'), after: null, hashAfter: null, at: Date.now(), group: ctx.editGroup });
  } else {
    await fsWriteFile(toR.path, src);
  }
  ctx.journal.recordEdit({
    path: toR.path,
    display: toR.display,
    before: previous,
    after: src.toString('utf8'),
    hashAfter: contentHash(src),
    at: Date.now(),
    group: ctx.editGroup,
  });
  ctx.ledger.filesChanged.add(toR.display);
  if (kind === 'move') ctx.ledger.filesChanged.add(fromR.display);
  ctx.ui.step(`${kind === 'move' ? 'Moved' : 'Copied'} ${fromR.display} → ${toR.display}`);
  return ok(`${fromR.display} ${kind === 'move' ? 'moved' : 'copied'} to ${toR.display}.`);
}

export async function deleteFileTool(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const r = await resolvePath(ctx.ws, argStr(args, 'path'));
  if (!r.ok) return { ...fail(`Cannot use that path: ${r.detail}`), permissionDenied: true };
  let st;
  try {
    st = await stat(r.path);
  } catch {
    return fail(`${r.display} does not exist.`);
  }
  if (st.isDirectory()) {
    return fail(`${r.display} is a directory. VinaX deletes files one at a time, never directory trees.`);
  }
  const before = await readFile(r.path, 'utf8').catch(() => null);
  const decision = await ctx.permissions.check({
    kind: 'delete',
    title: `Delete ${r.display}?`,
    detail: [`${st.size.toLocaleString('en-US')} bytes`, 'This cannot be undone through Git if the file was never committed.'],
    risk: 'elevated',
    scopeKey: 'delete:project',
    scopeLabel: 'Allow deleting project files this session',
  });
  if (decision.outcome === 'deny') return { ...fail(`Denied: ${decision.message}`), permissionDenied: true };
  await rm(r.path, { force: true });
  if (before !== null) {
    ctx.journal.recordEdit({ path: r.path, display: r.display, before, after: null, hashAfter: null, at: Date.now(), group: ctx.editGroup });
  }
  ctx.ledger.filesChanged.add(r.display);
  ctx.ui.step(`Deleted ${r.display}`);
  return ok(`${r.display} deleted.`);
}
