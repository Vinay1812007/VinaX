/**
 * POST /api/vinaxcli/search — the web_search tool's back end.
 *
 * VinaX CLI runs on a developer's laptop and holds no keys of any kind. When
 * the agent asks for a web search, the CLI asks VinaX, and VinaX runs the
 * same shared research path the assistant uses (_lib/websearch.ts).
 *
 * The result is external text from arbitrary pages. It goes back to the CLI,
 * which feeds it to the model inside the untrusted-tool-result fence — a page
 * that says "ignore your instructions" is a page, not an instruction.
 */
import { methodNotAllowed, rateLimit } from '../../_lib/ratelimit';
import { liveSearch, type WebSearchEnv } from '../../_lib/websearch';

type Env = WebSearchEnv & { TELEMETRY_PEPPER?: string };

export const onRequestGet = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  // Each miss costs several upstream fetches, so this is tighter than the
  // agent endpoint's own budget.
  const limited = rateLimit(request, 'vinaxcli-search', { capacity: 10, refillPerMinute: 10 }, env);
  if (limited) return limited;

  let body: { query?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'bad_request', message: 'body must be JSON' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 300) : '';
  if (!query) return json({ error: 'bad_request', message: 'query is required' }, 400);

  const hit = await liveSearch(env, query);
  if (!hit) return json({ ok: true, query, text: '', sources: [] });
  return json({ ok: true, query, text: hit.text, sources: hit.sources });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
