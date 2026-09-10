/**
 * The VinaX service client.
 *
 * VinaX CLI is a Node process, not a browser, so it may call the VinaX HTTPS
 * API directly — the same-origin rule that governs the web app does not apply
 * here and no CORS is involved. `VINAX_API_BASE` exists for local development
 * against `wrangler dev`, and exists ONLY for this package.
 *
 * There are no provider credentials anywhere in this file, because there are
 * none anywhere in this package. The CLI talks to VinaX; VinaX talks to the
 * inference services. A user of this tool never needs a key.
 */
import { createSseParser } from './sse.js';
import { toAgentEvent, type AgentEvent, type AgentRequest } from '../protocol/events.js';
import { CLI_VERSION } from '../version.js';

export interface MetaEngine {
  id: string;
  label: string;
  hint: string;
  acceptsModel: boolean;
  catalog?: 'grq' | 'opr';
  available: boolean;
}

export interface Meta {
  service: string;
  protocol: string;
  protocols: string[];
  engines: MetaEngine[];
  catalogEndpoint: string;
  tools: Array<{ name: string; effect: string }>;
  limits: Record<string, number>;
  web: { available: boolean };
  docs: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  context: number | null;
}

export interface CatalogGroup {
  id: string;
  label: string;
  hint: string;
  configured: boolean;
  models: CatalogModel[];
}

/** Every failure the CLI can get from the service, as one typed shape. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfter: number | null;

  constructor(code: string, message: string, status = 0, retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export interface ClientOptions {
  apiBase: string;
  /** Overridable for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class VinaxApi {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: ClientOptions) {
    this.base = opts.apiBase.replace(/\/+$/, '');
    this.doFetch = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  get apiBase(): string {
    return this.base;
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': `VinaX-CLI/${CLI_VERSION} (${process.platform}; node ${process.versions.node})`,
    };
  }

  /** Translate a transport failure into something a user can act on. */
  private static transportError(e: unknown): ApiError {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort/i.test(msg)) return new ApiError('timeout', 'the VinaX service did not answer in time');
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return new ApiError('dns', 'could not resolve the VinaX service host — are you online?');
    if (/ECONNREFUSED/i.test(msg)) return new ApiError('refused', 'the VinaX service refused the connection');
    if (/certificate|self.signed|SSL/i.test(msg)) return new ApiError('tls', `TLS problem talking to the VinaX service: ${msg}`);
    return new ApiError('network', `could not reach the VinaX service: ${msg}`);
  }

  async meta(signal?: AbortSignal): Promise<Meta> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await this.doFetch(this.url('/api/vinaxcli/meta'), { headers: this.headers(), signal: controller.signal });
      if (!res.ok) throw new ApiError('http', `VinaX meta responded ${res.status}`, res.status);
      return (await res.json()) as Meta;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw VinaxApi.transportError(e);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** The live free-model menu for the model-selectable engines. */
  async catalog(signal?: AbortSignal): Promise<CatalogGroup[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await this.doFetch(this.url('/api/aimodels'), { headers: this.headers(), signal: controller.signal });
      if (!res.ok) throw new ApiError('http', `VinaX model catalog responded ${res.status}`, res.status);
      const body = (await res.json()) as { groups?: CatalogGroup[] };
      return Array.isArray(body.groups) ? body.groups : [];
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw VinaxApi.transportError(e);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** The web_search tool's back end. */
  async search(query: string, signal?: AbortSignal): Promise<{ text: string; sources: string[] }> {
    try {
      const res = await this.doFetch(this.url('/api/vinaxcli/search'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ query }),
        signal,
      });
      if (res.status === 429) {
        throw new ApiError('rate_limited', 'VinaX web search is rate limited; try again shortly', 429, retryAfter(res));
      }
      if (!res.ok) throw new ApiError('http', `VinaX web search responded ${res.status}`, res.status);
      const body = (await res.json()) as { text?: string; sources?: string[] };
      return { text: body.text ?? '', sources: body.sources ?? [] };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw VinaxApi.transportError(e);
    }
  }

  /**
   * Run one agent step, yielding normalized events as they arrive.
   *
   * Errors that happen BEFORE any event is yielded are thrown, so the caller
   * can retry a step it knows produced no side effects. Once events start
   * flowing the caller has already seen tool calls and must not blindly retry
   * — see session/journal.ts for why that distinction is not cosmetic.
   */
  async *agent(body: AgentRequest, signal?: AbortSignal): AsyncGenerator<AgentEvent, void, void> {
    let res: Response;
    try {
      res = await this.doFetch(this.url('/api/vinaxcli/agent'), {
        method: 'POST',
        headers: { ...this.headers(), accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw VinaxApi.transportError(e);
    }

    if (res.status === 429) {
      const info = await safeJson(res);
      throw new ApiError('rate_limited', String(info?.message ?? 'VinaX is rate limiting this client'), 429, retryAfter(res));
    }
    if (!res.ok) {
      const info = await safeJson(res);
      const code = String(info?.error ?? 'http');
      const message = String(info?.message ?? `the VinaX agent endpoint responded ${res.status}`);
      throw new ApiError(code, message, res.status);
    }
    if (!res.body) throw new ApiError('empty_stream', 'the VinaX agent endpoint returned no stream', res.status);

    const parser = createSseParser();
    const decoder = new TextDecoder();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const msg of parser.push(decoder.decode(value, { stream: true }))) {
          const ev = decode(msg.data);
          if (ev) yield ev;
        }
      }
      for (const msg of parser.end()) {
        const ev = decode(msg.data);
        if (ev) yield ev;
      }
    } finally {
      // Cancelling the reader is what actually aborts an in-flight generation
      // on Ctrl+C; without it the socket stays open and the run keeps billing.
      await reader.cancel().catch(() => undefined);
    }
  }
}

function decode(data: string): AgentEvent | null {
  try {
    return toAgentEvent(JSON.parse(data));
  } catch {
    return null;
  }
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function retryAfter(res: Response): number | null {
  const h = res.headers.get('retry-after');
  const n = h ? Number(h) : NaN;
  return Number.isFinite(n) ? n : null;
}
