/**
 * The VinaX API as a plain Node server: worker/index.ts's `fetch` and
 * `scheduled` handlers, unchanged, behind node:http. main.ts wires the real
 * Worker and settings; the tests wire fakes.
 */
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { RATE_LIMIT_TIERS } from '../worker/functions/_lib/ratelimit';
import { fileKv, fixedWindowLimiter, workersAiRest } from './bindings';
import { sendWebResponse, toWebRequest } from './http';

export interface ExecCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerLike {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecCtx): Response | Promise<Response>;
  scheduled?(event: { scheduledTime: number }, env: Record<string, unknown>, ctx: ExecCtx): void | Promise<void>;
}

/** The ADMIN_AUTH_FAILS binding's numbers (wrangler.toml). */
const ADMIN_AUTH_FAILS = { limit: 15, period: 60 };

/**
 * The Worker's env on Node: the plain values, then a stand-in for each
 * binding. AI is there only when CF_ACCOUNT_ID and CF_AI_TOKEN are set,
 * like the binding was there only on Cloudflare.
 */
export function buildEnv(values: Record<string, string>, dataDir: string): Record<string, unknown> {
  const env: Record<string, unknown> = { ...values };
  env.HANDOFF = fileKv(join(dataDir, 'kv-handoff.json'));
  for (const tier of RATE_LIMIT_TIERS) env[tier.binding] = fixedWindowLimiter(tier.limit, 60);
  env.ADMIN_AUTH_FAILS = fixedWindowLimiter(ADMIN_AUTH_FAILS.limit, ADMIN_AUTH_FAILS.period);
  if (values.CF_ACCOUNT_ID && values.CF_AI_TOKEN) env.AI = workersAiRest(values.CF_ACCOUNT_ID, values.CF_AI_TOKEN);
  return env;
}

export interface App {
  server: Server;
  ctx: ExecCtx;
  /** Wait for waitUntil work (at most `ms`), for a clean stop. */
  drain(ms: number): Promise<void>;
}

export function createApp(opts: {
  worker: WorkerLike;
  env: Record<string, unknown>;
  protocol: 'http' | 'https';
  logRequests?: boolean;
}): App {
  const pending = new Set<Promise<unknown>>();
  const ctx: ExecCtx = {
    waitUntil(promise) {
      const p = Promise.resolve(promise)
        .catch((e) => console.error('[waitUntil]', e))
        .finally(() => pending.delete(p));
      pending.add(p);
    },
  };

  const server = createServer(async (req, res) => {
    const started = Date.now();
    if (req.url === '/__health') {
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('ok');
      return;
    }
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let response: Response;
    try {
      const request = toWebRequest(req, { protocol: opts.protocol, signal: abort.signal });
      response = await opts.worker.fetch(request, opts.env, ctx);
    } catch (e) {
      console.error(`[error] ${req.method} ${req.url}`, e);
      response = new Response('Internal Server Error', { status: 500, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }
    try {
      await sendWebResponse(res, response, (req.method ?? 'GET').toUpperCase());
    } catch (e) {
      console.error(`[error] sending ${req.method} ${req.url}`, e);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      } else res.destroy();
    }
    if (opts.logRequests) console.log(`${req.method} ${req.url} ${response.status} ${Date.now() - started}ms`);
  });
  // AI replies can run for minutes; Node's default 5-minute request timeout
  // would cut them. Cloudflare's own limits sit in front anyway.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;
  server.keepAliveTimeout = 65_000;

  return {
    server,
    ctx,
    async drain(ms) {
      if (!pending.size) return;
      await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, ms))]);
    },
  };
}

const FIVE_MIN = 5 * 60_000;

/**
 * The Cron Trigger ("*\/5 * * * *"): fire `scheduled` on every 5-minute
 * boundary, with that boundary as scheduledTime, as Cloudflare does.
 * Answers a stop function.
 */
export function startCron(worker: WorkerLike, env: Record<string, unknown>, ctx: ExecCtx, now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const schedule = (): void => {
    if (stopped) return;
    const t = now();
    const next = Math.floor(t / FIVE_MIN) * FIVE_MIN + FIVE_MIN;
    timer = setTimeout(() => {
      try {
        const r = worker.scheduled?.({ scheduledTime: next }, env, ctx);
        if (r) ctx.waitUntil(r);
      } catch (e) {
        console.error('[cron]', e);
      }
      schedule();
    }, next - t);
  };
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
