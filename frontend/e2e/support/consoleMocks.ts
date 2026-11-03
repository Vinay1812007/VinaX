/**
 * Console rebuild — one mocked server for every console spec.
 *
 * The handlers live in e2e/support/console-mocks/*.mjs (one file per area of
 * the console; the same files drive the local preview server), each
 * exporting `{ 'GET /api/admin/x': (url, body) => answer }`. An answer may
 * carry `__status` for a non-200 reply.
 *
 *   await mockConsole(page, { role: 'owner', mode: 'full' });
 *
 * mode 'empty' answers every admin GET with `{ configured: true }`;
 * mode 'fail' answers every admin GET (except the session) with a 502.
 * Every request the console sends is recorded in the returned `posts` list.
 * All non-localhost network is aborted.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from './test';

type Handler = (url: URL, body: unknown, req: { headers: Record<string, string> }) => unknown;
const DIR = join(dirname(fileURLToPath(import.meta.url)), 'console-mocks');

let cache: Record<string, Handler> | null = null;
async function handlers(): Promise<Record<string, Handler>> {
  if (cache) return cache;
  const out: Record<string, Handler> = {};
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.mjs')).sort()) {
    const m = (await import(pathToFileURL(join(DIR, f)).href)) as { default?: Record<string, Handler> };
    Object.assign(out, m.default ?? {});
  }
  cache = out;
  return out;
}

export interface ConsoleMockOptions {
  role?: 'owner' | 'editor' | 'viewer';
  mode?: 'full' | 'empty' | 'fail';
  /** Password the recovery sign-in accepts (session GET answers `me` only with it or an adm1 token). */
  password?: string;
  schema?: number;
}

export interface Sent { method: string; path: string; body: unknown }

export async function mockConsole(page: Page, o: ConsoleMockOptions = {}): Promise<{ sent: Sent[] }> {
  const hs = await handlers();
  const role = o.role ?? 'owner';
  const password = o.password ?? 'owner-pass';
  const sent: Sent[] = [];
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let body: unknown = null;
    if (method === 'POST') { try { body = req.postDataJSON(); } catch { body = null; } }
    sent.push({ method, path: url.pathname + url.search, body });
    const send = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const token = req.headers()['x-admin-token'] ?? '';
    const signedIn = token === password || token.startsWith('adm1.');
    if (url.pathname === '/api/version') return send({ version: '1.8.3' });
    if (url.pathname === '/api/admin/session' && method === 'GET') {
      return send({
        googleClientId: null, googleReady: false, passwordAllowed: true, databaseConfigured: true,
        schema: o.schema ?? 10, schemaWanted: 10,
        me: signedIn ? { email: `${role}@example.com`, name: `Test ${role}`, picture: null, role: token === password ? 'owner' : role, via: token === password ? 'password' : 'google' } : null,
      });
    }
    if (url.pathname.startsWith('/api/admin/') && !signedIn) return send({ error: 'unauthorized' }, 401);
    if (method === 'GET' && o.mode === 'empty') return send({ configured: true });
    if (method === 'GET' && o.mode === 'fail') return send({ configured: true, error: 'db_unavailable' }, 502);
    const fn = hs[`${method} ${url.pathname}`];
    if (!fn) return send(method === 'GET' ? { configured: true } : { ok: true });
    const out = (await fn(url, body, { headers: req.headers() })) as Record<string, unknown> | null;
    if (out && typeof out === 'object' && '__status' in out) {
      const { __status, ...rest } = out;
      return send(rest, Number(__status));
    }
    return send(out);
  });
  return { sent };
}

/** Start signed in (an adm1 token in sessionStorage) before the first load. */
export async function signedIn(page: Page): Promise<void> {
  await page.addInitScript(() => { try { sessionStorage.setItem('vinax_admin_token', 'adm1.e2e.e2e'); } catch { /* storage blocked */ } });
}

export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}
