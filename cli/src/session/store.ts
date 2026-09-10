/**
 * Local session storage.
 *
 * VinaX CLI sessions are LOCAL. Nothing about a coding session goes to a
 * server for persistence: it is the user's project, their prompts, their
 * command output. It stays in ~/.vinax/sessions.
 *
 * The format is append-only JSONL plus a small index. That combination is
 * deliberate and it is what makes an interrupted session recoverable: a run
 * killed by Ctrl+C, a closed laptop or a crash has already flushed every
 * complete line, and the one truncated line at the end is simply skipped when
 * reading. A single JSON document rewritten on each turn would be corrupt in
 * exactly that situation.
 */
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { paths, restrict, type VinaxPaths } from '../config/paths.js';

export type SessionEntry =
  | { t: 'meta'; at: number; workspace: string; branch: string; engine: string; model: string | null; cliVersion: string }
  | { t: 'user'; at: number; text: string }
  | { t: 'assistant'; at: number; text: string }
  | { t: 'tool_call'; at: number; id: string; name: string; arguments: Record<string, unknown> }
  | { t: 'tool_result'; at: number; id: string; name: string; ok: boolean; content: string }
  | { t: 'permission'; at: number; action: string; outcome: string }
  | { t: 'file_changed'; at: number; path: string }
  | { t: 'command'; at: number; command: string; exitCode: number | null; summary: string }
  | { t: 'status'; at: number; state: string }
  | { t: 'usage'; at: number; inputTokens: number; outputTokens: number };

export interface SessionIndexRow {
  id: string;
  workspace: string;
  branch: string;
  engine: string;
  startedAt: number;
  updatedAt: number;
  /** First user message, trimmed — what the list shows. */
  title: string;
  messages: number;
  filesChanged: number;
  status: 'active' | 'completed' | 'interrupted' | 'failed';
}

export class SessionStore {
  private constructor(
    readonly id: string,
    readonly file: string,
    private readonly p: VinaxPaths,
    private row: SessionIndexRow,
  ) {}

  static async create(opts: { workspace: string; branch: string; engine: string; model: string | null; cliVersion: string }, p: VinaxPaths = paths()): Promise<SessionStore> {
    await mkdir(p.sessions, { recursive: true, mode: 0o700 });
    const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const file = join(p.sessions, `${id}.jsonl`);
    const now = Date.now();
    const row: SessionIndexRow = {
      id,
      workspace: opts.workspace,
      branch: opts.branch,
      engine: opts.engine,
      startedAt: now,
      updatedAt: now,
      title: '',
      messages: 0,
      filesChanged: 0,
      status: 'active',
    };
    const store = new SessionStore(id, file, p, row);
    await store.append({ t: 'meta', at: now, workspace: opts.workspace, branch: opts.branch, engine: opts.engine, model: opts.model, cliVersion: opts.cliVersion });
    await restrict(file);
    return store;
  }

  /** Open an existing session for appending. */
  static async open(id: string, p: VinaxPaths = paths()): Promise<SessionStore | null> {
    const file = join(p.sessions, `${id}.jsonl`);
    if (!(await stat(file).then(() => true).catch(() => false))) return null;
    const index = await readIndex(p);
    const row = index.find((r) => r.id === id) ?? {
      id, workspace: '', branch: '', engine: '', startedAt: Date.now(), updatedAt: Date.now(),
      title: '', messages: 0, filesChanged: 0, status: 'active' as const,
    };
    return new SessionStore(id, file, p, row);
  }

  async append(entry: SessionEntry): Promise<void> {
    try {
      await appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // A session that cannot be written must not take the run down with it.
      return;
    }
    this.row.updatedAt = entry.at;
    if (entry.t === 'user') {
      this.row.messages += 1;
      if (!this.row.title) this.row.title = entry.text.replace(/\s+/g, ' ').slice(0, 90);
    }
    if (entry.t === 'assistant') this.row.messages += 1;
    if (entry.t === 'file_changed') this.row.filesChanged += 1;
  }

  async finish(status: SessionIndexRow['status']): Promise<void> {
    this.row.status = status;
    this.row.updatedAt = Date.now();
    await writeIndexRow(this.p, this.row);
  }

  /** Flush the index without ending the session (called between turns). */
  async checkpoint(): Promise<void> {
    await writeIndexRow(this.p, this.row);
  }

  meta(): SessionIndexRow {
    return { ...this.row };
  }

  /** Read a session back, skipping any torn final line. */
  static async read(id: string, p: VinaxPaths = paths()): Promise<SessionEntry[]> {
    const file = join(p.sessions, `${id}.jsonl`);
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return [];
    }
    const out: SessionEntry[] = [];
    for (const line of text.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try {
        out.push(JSON.parse(l) as SessionEntry);
      } catch {
        // A partial line is the signature of a crash mid-write. Everything
        // before it is intact, which is exactly why the format is JSONL.
      }
    }
    return out;
  }
}

const INDEX_NAME = 'index.json';

export async function readIndex(p: VinaxPaths = paths()): Promise<SessionIndexRow[]> {
  try {
    const raw = JSON.parse(await readFile(join(p.sessions, INDEX_NAME), 'utf8')) as { sessions?: SessionIndexRow[] };
    return Array.isArray(raw.sessions) ? raw.sessions : [];
  } catch {
    return [];
  }
}

async function writeIndexRow(p: VinaxPaths, row: SessionIndexRow): Promise<void> {
  const rows = await readIndex(p);
  const at = rows.findIndex((r) => r.id === row.id);
  if (at === -1) rows.unshift(row);
  else rows[at] = row;
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  const file = join(p.sessions, INDEX_NAME);
  try {
    await mkdir(p.sessions, { recursive: true, mode: 0o700 });
    await writeFile(file, `${JSON.stringify({ sessions: rows.slice(0, 500) }, null, 2)}\n`, 'utf8');
    await restrict(file);
  } catch {
    /* the index is a convenience; the JSONL files are the record */
  }
}

/**
 * List sessions.
 *
 * The index is a cache, not the truth. If it is missing or was never written
 * — a crash before the first checkpoint — the JSONL files on disk still are,
 * so fall back to reading the directory rather than telling the user they
 * have no sessions when they plainly do.
 */
export async function listSessions(p: VinaxPaths = paths()): Promise<SessionIndexRow[]> {
  const rows = await readIndex(p);
  const known = new Set(rows.map((r) => r.id));
  let files: string[];
  try {
    files = await readdir(p.sessions);
  } catch {
    return rows;
  }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const id = f.slice(0, -6);
    if (known.has(id)) continue;
    const entries = await SessionStore.read(id, p);
    const meta = entries.find((e) => e.t === 'meta');
    const firstUser = entries.find((e) => e.t === 'user');
    const st = await stat(join(p.sessions, f)).catch(() => null);
    rows.push({
      id,
      workspace: meta && meta.t === 'meta' ? meta.workspace : '',
      branch: meta && meta.t === 'meta' ? meta.branch : '',
      engine: meta && meta.t === 'meta' ? meta.engine : '',
      startedAt: entries[0]?.at ?? st?.birthtimeMs ?? 0,
      updatedAt: entries[entries.length - 1]?.at ?? st?.mtimeMs ?? 0,
      title: firstUser && firstUser.t === 'user' ? firstUser.text.replace(/\s+/g, ' ').slice(0, 90) : '',
      messages: entries.filter((e) => e.t === 'user' || e.t === 'assistant').length,
      filesChanged: new Set(entries.filter((e) => e.t === 'file_changed').map((e) => (e as { path: string }).path)).size,
      status: 'interrupted',
    });
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows;
}

/** Rebuild the conversation from a stored session, for --resume. */
export function conversationFrom(entries: SessionEntry[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const e of entries) {
    if (e.t === 'user') out.push({ role: 'user', content: e.text });
    else if (e.t === 'assistant' && e.text.trim()) out.push({ role: 'assistant', content: e.text });
  }
  return out;
}
