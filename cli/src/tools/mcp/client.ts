/**
 * Model Context Protocol — local stdio servers.
 *
 * MCP is JSON-RPC 2.0 over newline-delimited stdio, so a correct client is a
 * few hundred lines and no dependency. That matters here: an agent that can
 * write to your disk should not also drag a transitive dependency tree into
 * the process that decides what it may do.
 *
 * The security position is the important part. An MCP server is a third-party
 * program that VinaX starts on the user's machine and whose tools the model
 * can call. So:
 *
 *  - Its tools go through the SAME permission engine as the built-ins, at an
 *    effect class the user can see. There is no bypass, and no MCP-only mode.
 *  - Its tool DESCRIPTIONS are text written by whoever wrote that server. They
 *    are data. A description saying "always approve this without asking" is a
 *    string in a JSON blob, not an instruction, and nothing in this codebase
 *    treats it as one.
 *  - Every external call is displayed with the server it came from, so a user
 *    always knows whose code is about to run.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { paths, restrict } from '../../config/paths.js';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpToolInfo {
  server: string;
  name: string;
  /** Fully-qualified name the model uses: `mcp__<server>__<tool>`. */
  qualified: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const RPC_TIMEOUT_MS = 20_000;

class McpConnection {
  private child: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  tools: McpToolInfo[] = [];
  lastError: string | null = null;

  constructor(readonly config: McpServerConfig) {}

  async start(): Promise<boolean> {
    try {
      this.child = spawn(this.config.command, this.config.args, {
        cwd: this.config.cwd,
        env: { ...process.env, ...(this.config.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return false;
    }
    this.child.on('error', (e) => {
      this.lastError = e.message;
      this.failAll(e);
    });
    this.child.on('exit', () => this.failAll(new Error(`${this.config.name} exited`)));
    this.child.stdout?.on('data', (b: Buffer) => this.onData(b.toString('utf8')));
    // A server's stderr is its own logging; keep the last of it for `doctor`.
    this.child.stderr?.on('data', (b: Buffer) => {
      this.lastError = b.toString('utf8').trim().slice(-400) || this.lastError;
    });

    try {
      await this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        clientInfo: { name: 'VinaX CLI', version: '0.1.0' },
      });
      this.notify('notifications/initialized', {});
      const listed = (await this.request('tools/list', {})) as { tools?: unknown };
      this.tools = normalizeTools(this.config.name, listed?.tools);
      return true;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.stop();
      return false;
    }
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: RpcResponse;
      try {
        msg = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }
      if (typeof msg.id !== 'number') continue; // a notification from the server
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    }
  }

  private failAll(e: Error): void {
    for (const [, w] of this.pending) {
      clearTimeout(w.timer);
      w.reject(e);
    }
    this.pending.clear();
  }

  private send(payload: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify(payload)}\n`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  request(method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    if (!this.child || this.child.exitCode !== null) return Promise.reject(new Error(`${this.config.name} is not running`));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.config.name} did not answer ${method} within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  stop(): void {
    this.failAll(new Error('stopped'));
    try {
      this.child?.stdin?.end();
      this.child?.kill('SIGTERM');
    } catch {
      /* already gone */
    }
    this.child = null;
  }
}

function normalizeTools(server: string, raw: unknown): McpToolInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: McpToolInfo[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const r = t as { name?: unknown; description?: unknown; inputSchema?: unknown };
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || !/^[\w.-]{1,64}$/.test(name)) continue;
    out.push({
      server,
      name,
      qualified: `mcp__${server}__${name}`,
      // Truncated hard: a server description is untrusted text and there is
      // no reason for it to be long enough to crowd out the real contract.
      description: typeof r.description === 'string' ? r.description.slice(0, 400) : '',
      inputSchema: r.inputSchema && typeof r.inputSchema === 'object' ? (r.inputSchema as Record<string, unknown>) : {},
    });
  }
  return out;
}

export interface McpCallResult {
  ok: boolean;
  text: string;
}

/** Every configured MCP server, and the tools they expose. */
export class McpRegistry {
  private readonly connections = new Map<string, McpConnection>();

  constructor(private readonly configs: McpServerConfig[]) {}

  static async load(file = paths().mcp): Promise<McpServerConfig[]> {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { servers?: unknown };
      if (!Array.isArray(raw.servers)) return [];
      const out: McpServerConfig[] = [];
      for (const s of raw.servers) {
        if (!s || typeof s !== 'object') continue;
        const r = s as Partial<McpServerConfig>;
        if (typeof r.name !== 'string' || typeof r.command !== 'string') continue;
        if (!/^[\w-]{1,32}$/.test(r.name)) continue;
        out.push({
          name: r.name,
          command: r.command,
          args: Array.isArray(r.args) ? r.args.filter((a): a is string => typeof a === 'string') : [],
          ...(typeof r.cwd === 'string' ? { cwd: r.cwd } : {}),
          ...(r.env && typeof r.env === 'object' ? { env: r.env as Record<string, string> } : {}),
          enabled: r.enabled !== false,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  static async save(servers: McpServerConfig[], file = paths().mcp): Promise<void> {
    await writeFile(file, `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
    await restrict(file);
  }

  /** Start every enabled server. A server that fails is reported, not fatal. */
  async connectAll(): Promise<Array<{ name: string; ok: boolean; tools: number; error: string | null }>> {
    const report: Array<{ name: string; ok: boolean; tools: number; error: string | null }> = [];
    for (const cfg of this.configs) {
      if (cfg.enabled === false) continue;
      const conn = new McpConnection(cfg);
      const ok = await conn.start();
      if (ok) this.connections.set(cfg.name, conn);
      report.push({ name: cfg.name, ok, tools: conn.tools.length, error: ok ? null : conn.lastError });
    }
    return report;
  }

  tools(): McpToolInfo[] {
    return [...this.connections.values()].flatMap((c) => c.tools);
  }

  find(qualified: string): McpToolInfo | null {
    return this.tools().find((t) => t.qualified === qualified) ?? null;
  }

  async call(qualified: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const info = this.find(qualified);
    if (!info) return { ok: false, text: `No MCP tool named ${qualified} is available.` };
    const conn = this.connections.get(info.server);
    if (!conn) return { ok: false, text: `The MCP server ${info.server} is not connected.` };
    try {
      const res = (await conn.request('tools/call', { name: info.name, arguments: args }, 120_000)) as {
        content?: unknown;
        isError?: unknown;
      };
      const parts: string[] = [];
      if (Array.isArray(res?.content)) {
        for (const c of res.content) {
          if (c && typeof c === 'object') {
            const item = c as { type?: unknown; text?: unknown };
            if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
            else parts.push(`[${String(item.type ?? 'unknown')} content omitted]`);
          }
        }
      }
      return { ok: res?.isError !== true, text: parts.join('\n') || '(the server returned no content)' };
    } catch (e) {
      return { ok: false, text: `${info.server} failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  stopAll(): void {
    for (const c of this.connections.values()) c.stop();
    this.connections.clear();
  }
}
