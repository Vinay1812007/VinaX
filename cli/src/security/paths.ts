/**
 * Workspace boundary enforcement.
 *
 * Every filesystem tool in VinaX CLI resolves its path through this module,
 * and nothing else is allowed to touch the disk. The rule it enforces is
 * simple to state and easy to get wrong: a path is usable only if the place
 * it REALLY points at, after every symlink has been followed, lives inside a
 * root the user approved.
 *
 * A string-prefix test is not that check, which is why there isn't one here.
 * `/home/u/project-secrets` starts with `/home/u/project`. A `link` inside
 * the workspace pointing at `/etc` starts with the workspace prefix and ends
 * up in /etc. Both of those pass a prefix test and both are escapes.
 *
 * So: resolve lexically, then resolve the longest ancestor that actually
 * exists through realpath (which follows every symlink in the chain,
 * including nested ones), re-attach the components that do not exist yet, and
 * compare by path SEGMENTS against roots that were themselves realpath'd.
 */
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';

export interface Workspace {
  /** Primary root — the git root, or the working directory when there is none. */
  root: string;
  /** Every root the user has approved, realpath'd and deduplicated. */
  roots: string[];
}

export type PathDenyReason =
  | 'empty'
  | 'null_byte'
  | 'device_path'
  | 'unc_path'
  | 'outside_workspace'
  | 'symlink_escape';

export type PathResolution =
  | { ok: true; path: string; /** Path relative to the root that allowed it. */ display: string; root: string }
  | { ok: false; reason: PathDenyReason; detail: string };

/** Windows device namespaces (\\?\, \\.\) and UNC shares (\\server\share). */
function windowsSpecial(p: string): 'device' | 'unc' | null {
  if (!/^[\\/]{2}/.test(p)) return null;
  const rest = p.slice(2);
  if (rest.startsWith('?') || rest.startsWith('.')) return 'device';
  return 'unc';
}

/**
 * realpath the deepest existing ancestor of `abs`, then re-attach the tail.
 *
 * Doing it this way is what makes `write_file` to a not-yet-existing path
 * safe: the file does not exist, so realpath would throw, but its PARENT
 * exists and may well be a symlink out of the workspace. Resolving the parent
 * catches that; resolving only what exists would not.
 */
async function realpathDeep(abs: string): Promise<string> {
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = resolve(cur, '..');
      // Reached the filesystem root without finding anything real: nothing to
      // resolve, so the lexical answer is the best available one.
      if (parent === cur) return abs;
      tail.push(cur.slice(parent.length).replace(/^[\\/]+/, ''));
      cur = parent;
    }
  }
}

/** True when `child` is `root` or lives under it, compared by segments. */
export function containedIn(root: string, child: string): boolean {
  const rel = relative(root, child);
  if (rel === '') return true;
  if (isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * Resolve one caller-supplied path against the workspace.
 *
 * `input` may be workspace-relative or absolute; either way it must land
 * inside an approved root once symlinks are followed.
 */
export async function resolvePath(
  ws: Workspace,
  input: string,
  opts: { base?: string } = {},
): Promise<PathResolution> {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: false, reason: 'empty', detail: 'no path given' };
  if (raw.includes('\0')) return { ok: false, reason: 'null_byte', detail: 'path contains a NUL byte' };

  if (process.platform === 'win32') {
    const special = windowsSpecial(raw);
    if (special === 'device') {
      return { ok: false, reason: 'device_path', detail: 'Windows device paths (\\\\?\\, \\\\.\\) are never accepted' };
    }
    if (special === 'unc') {
      return { ok: false, reason: 'unc_path', detail: 'UNC network paths are outside any approved workspace' };
    }
  } else if (raw.startsWith('/dev/') || raw.startsWith('/proc/')) {
    // Not a traversal, but not a project file either: reading these has no
    // legitimate place in a coding task and /proc leaks process environments.
    return { ok: false, reason: 'device_path', detail: 'device and kernel paths are not part of a workspace' };
  }

  const base = opts.base ?? ws.root;
  const abs = normalize(resolve(base, raw));
  const real = await realpathDeep(abs);

  for (const root of ws.roots) {
    if (containedIn(root, real)) {
      const display = relative(root, real) || '.';
      return { ok: true, path: real, display, root };
    }
  }

  // Distinguish the two failures, because they mean different things to a
  // user: "you asked for a path outside the workspace" versus "a path inside
  // the workspace turned out to point outside it".
  const lexicallyInside = ws.roots.some((r) => containedIn(r, abs));
  return lexicallyInside
    ? { ok: false, reason: 'symlink_escape', detail: `${raw} resolves through a link to ${real}, outside the workspace` }
    : { ok: false, reason: 'outside_workspace', detail: `${raw} is outside the approved workspace` };
}

/** Build a workspace from a primary root plus any extra approved directories. */
export async function makeWorkspace(root: string, extra: string[] = []): Promise<Workspace> {
  const canonical = async (p: string): Promise<string> => {
    try {
      return await realpath(resolve(p));
    } catch {
      return resolve(p);
    }
  };
  const primary = await canonical(root);
  const roots = [primary];
  for (const e of extra) {
    const r = await canonical(e);
    // A root already covered by another root adds nothing but confusion.
    if (!roots.some((existing) => containedIn(existing, r))) roots.push(r);
  }
  return { root: primary, roots };
}

/** Human-readable label for a path, relative to the workspace when possible. */
export function displayPath(ws: Workspace, abs: string): string {
  for (const root of ws.roots) {
    if (containedIn(root, abs)) {
      const rel = relative(root, abs);
      return rel || parse(root).base;
    }
  }
  return abs;
}
