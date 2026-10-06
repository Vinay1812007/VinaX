/**
 * 10.1 — wake the web search instance before it is needed.
 *
 * The instance sleeps when idle and takes up to a minute to wake, longer than
 * any research lookup waits. The app calls this (fire and forget) the moment
 * someone switches on Web search or Research in VinaX AI, so by the time they
 * have typed their question the instance is up. It pings the instance's
 * token-free /healthz and returns at once; nothing about the caller or the
 * instance is revealed.
 */
import { rateLimit } from '../_lib/ratelimit';
import { warmSearxng, type WebSearchEnv } from '../_lib/websearch';

interface Ctx {
  request: Request;
  env: WebSearchEnv;
  waitUntil?: (p: Promise<unknown>) => void;
}

const HEADERS = { 'cache-control': 'no-store', 'access-control-allow-origin': '*' };

export const onRequestPost = async ({ request, env, waitUntil }: Ctx): Promise<Response> => {
  const limited = rateLimit(request, 'warm-search', { capacity: 6, refillPerMinute: 6 }, env);
  if (limited) return limited;
  const job = warmSearxng(env).catch(() => undefined);
  if (waitUntil) waitUntil(job);
  return new Response(null, { status: 204, headers: HEADERS });
};

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: { ...HEADERS, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
