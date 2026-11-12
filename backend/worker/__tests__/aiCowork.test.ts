/**
 * VinaX AI Cowork (Claude on Managed Agents): who may use it, the one-time
 * setup of the agent and environment, starting a task with its spend cap,
 * and the task routes (stream and history passed through, the events the
 * page may send, files in and out). A fake Anthropic answers every call.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { onRequestGet as getCowork, onRequestPost as postCowork } from '../functions/api/ai/cowork';
import { onRequestDelete as delPath, onRequestGet as getPath, onRequestPost as postPath } from '../functions/api/ai/cowork/[path]';
import { onRequestGet as getModels } from '../functions/api/ai/models';
import { AGENT_DEFINITION, COWORK_SETTING_KEY, definitionHash, MA_BASE, MA_BETA, MA_VERSION, safeFileName, sanitizeCoworkSetting } from '../functions/_lib/ai/cowork';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';

const OWNER = 'sirimillavinay56@gmail.com';
const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', ANTHROPIC_API_KEY: 'sk-ant-test', ...DB_ENV };
const SID = 'sesn_011ABCdef';
const OTHER = 'sesn_011Elsewhere';

interface Sent { method: string; path: string; headers: Record<string, string>; body: unknown; raw?: BodyInit | null }
let sent: Sent[] = [];
let sessions: Record<string, Record<string, unknown>> = {};
let ip = 0;

/** A JSON request body, or null. */
function parse(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const jsonRes = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

/** A small Anthropic: environments, agents, sessions, events, files. */
function anthropic(url: string, init?: RequestInit): Response {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v1/, '') + u.search;
  const method = init?.method ?? 'GET';
  const body = parse(init?.body);
  sent.push({ method, path, headers: { ...(init?.headers as Record<string, string>) }, body, raw: init?.body as BodyInit | null });
  if (method === 'POST' && path === '/environments') return jsonRes({ id: 'env_011Workspace' });
  if (method === 'POST' && path === '/agents') return jsonRes({ id: 'agent_011Cowork', version: 1 });
  if (method === 'POST' && path.startsWith('/agents/')) return jsonRes({ id: 'agent_011Cowork', version: 2 });
  if (method === 'POST' && path.startsWith('/environments/')) return jsonRes({ id: 'env_011Workspace' });
  if (method === 'POST' && path === '/sessions') {
    const b = body as Record<string, unknown>;
    const s = { id: SID, type: 'session', status: 'idle', title: b.title, metadata: b.metadata, budget: b.budget, agent: { model: { id: 'claude-haiku-5-5' } }, usage: { list_cost: { amount: '0', currency: 'USD' } }, created_at: '2026-11-12T10:00:00Z' };
    sessions[SID] = s;
    return jsonRes(s);
  }
  if (method === 'GET' && path.startsWith('/sessions?')) return jsonRes({ data: Object.values(sessions), next_page: null });
  const m = /^\/sessions\/(sesn_[A-Za-z0-9]+)(\/[^?]*)?/.exec(path);
  if (m) {
    const s = sessions[m[1]];
    if (!s) return jsonRes({ type: 'error', error: { type: 'not_found_error', message: 'no session' } }, 404);
    const rest = m[2] ?? '';
    if (!rest && method === 'GET') return jsonRes(s);
    if (!rest && method === 'POST') { Object.assign(s, body as object); return jsonRes(s); }
    if (!rest && method === 'DELETE') { delete sessions[m[1]]; return jsonRes({ id: m[1], type: 'session_deleted' }); }
    if (rest === '/events/stream') return new Response('event: session.status_running\ndata: {"type":"session.status_running","id":"sevt_1"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    if (rest === '/events' && method === 'GET') return jsonRes({ data: [{ type: 'user.message', id: 'sevt_0', content: [{ type: 'text', text: 'hi' }] }], next_page: null });
    if (rest === '/events' && method === 'POST') return jsonRes({ data: [] });
    if (rest === '/resources' && method === 'POST') return jsonRes({ id: 'sesrsc_1' });
  }
  if (method === 'POST' && path === '/files') return jsonRes({ id: 'file_011Upload', filename: 'notes.pdf', size_bytes: 1234 });
  if (method === 'GET' && path.startsWith('/files?scope_id=')) return jsonRes({ data: [{ id: 'file_011Report', filename: 'report.docx', size_bytes: 2048, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', created_at: '2026-11-12T10:05:00Z' }] });
  if (method === 'GET' && /^\/files\/file_[A-Za-z0-9]+\/content$/.test(path)) return new Response('DOCX-BYTES', { headers: { 'content-type': 'application/octet-stream' } });
  return jsonRes({ type: 'error', error: { type: 'not_found_error', message: path } }, 404);
}

function seed(setting: unknown = null): FakeDb {
  return fakeDb({
    accounts: [{ id: '1001', name: 'Vinay', email: OWNER }, { id: '2002', name: 'Bo', email: 'bo@gmail.com' }],
    settings: setting ? [{ key: COWORK_SETTING_KEY, value: setting, updated_at: 'x', updated_by: 'owner' }] : [],
  }, (url, init) => (url.startsWith(MA_BASE) ? anthropic(url, init) : new Response('ok')));
}

async function req(method: string, path: string, opts: { sub?: string | null; body?: unknown; headers?: Record<string, string>; raw?: BodyInit } = {}): Promise<Request> {
  const sub = opts.sub === undefined ? '1001' : opts.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online/api/ai/cowork${path}`, {
    method,
    headers: { 'cf-connecting-ip': `203.0.113.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : opts.raw !== undefined ? { body: opts.raw, duplex: 'half' } as RequestInit : {}),
  });
}

const ctxOf = (request: Request, path?: string) => ({ request, env: ENV as never, params: path === undefined ? {} : { path } });
const READY = { agentId: 'agent_011Cowork', agentVersion: 1, environmentId: 'env_011Workspace', hash: definitionHash(), budgetCents: 500 };

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  sent = [];
  sessions = {};
});

describe('who may use Cowork', () => {
  it('anyone else (or signed out) gets allowed: false, and Anthropic is never called', async () => {
    seed(READY);
    for (const sub of ['2002', null]) {
      const r = await getCowork(ctxOf(await req('GET', '', { sub })));
      expect(await r.json()).toMatchObject({ allowed: false, tasks: [] });
    }
    expect(sent).toHaveLength(0);
  });

  it('every write route answers 403 model_locked to anyone else', async () => {
    seed(READY);
    expect((await postCowork(ctxOf(await req('POST', '', { sub: '2002', body: { title: 'x' } })))).status).toBe(403);
    expect((await postPath(ctxOf(await req('POST', '/setup', { sub: '2002', body: {} }), 'setup'))).status).toBe(403);
    expect((await getPath(ctxOf(await req('GET', `/tasks/${SID}/stream`, { sub: '2002' }), `tasks/${SID}/stream`))).status).toBe(403);
    expect((await delPath(ctxOf(await req('DELETE', `/tasks/${SID}`, { sub: '2002' }), `tasks/${SID}`))).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('the models route tells the page whether Cowork is open', async () => {
    seed(READY);
    const open = async (sub: string | null) => {
      const token = sub ? await issueSession(ENV, sub) : null;
      const r = await getModels({ request: new Request('https://www.vinaxmusic.online/api/ai/models', { headers: { 'cf-connecting-ip': `198.51.100.${++ip}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } }), env: ENV as never });
      return ((await r.json()) as { cowork: unknown }).cowork;
    };
    expect(await open('1001')).toEqual({ allowed: true, configured: true });
    expect(await open('2002')).toEqual({ allowed: false, configured: false });
    expect(await open(null)).toEqual({ allowed: false, configured: false });
  });

  it('without the key the owner is told Cowork is not configured', async () => {
    seed(READY);
    const noKey = { ...ENV, ANTHROPIC_API_KEY: '' };
    const r = await postCowork({ request: await req('POST', '', { body: { title: 'x' } }), env: noKey as never });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'cowork_not_configured' });
  });
});

describe('setup', () => {
  it('creates the environment and the agent once, with the managed-agents headers, and keeps their ids', async () => {
    const fake = seed();
    const r = await postPath(ctxOf(await req('POST', '/setup', { body: {} }), 'setup'));
    expect(await r.json()).toEqual({ ok: true, created: true, updated: false });
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /environments', 'POST /agents']);
    for (const c of sent) {
      expect(c.headers['x-api-key']).toBe('sk-ant-test');
      expect(c.headers['anthropic-version']).toBe(MA_VERSION);
      expect(c.headers['anthropic-beta']).toBe(MA_BETA);
    }
    const agent = sent[1].body as typeof AGENT_DEFINITION;
    expect(agent.model).toEqual({ id: 'claude-haiku-5-5', effort: 'high' });
    expect(agent.tools[0]).toMatchObject({ type: 'agent_toolset_20260401', default_config: { permission_policy: { type: 'auto' } } });
    expect(agent.skills.map((s) => s.skill_id)).toEqual(['docx', 'xlsx', 'pptx', 'pdf']);
    expect(fake.rows('settings').find((s) => s.key === COWORK_SETTING_KEY)?.value).toMatchObject({ agentId: 'agent_011Cowork', environmentId: 'env_011Workspace', hash: definitionHash() });

    sent = [];
    resetSettingsMemo();
    expect(await (await postPath(ctxOf(await req('POST', '/setup', { body: {} }), 'setup'))).json()).toEqual({ ok: true, created: false, updated: false });
    expect(sent).toHaveLength(0);
  });

  it('a changed definition updates the agent and environment in place (no new ones)', async () => {
    const fake = seed({ ...READY, hash: 'old' });
    expect(await (await postPath(ctxOf(await req('POST', '/setup', { body: {} }), 'setup'))).json()).toEqual({ ok: true, created: false, updated: true });
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /environments/env_011Workspace', 'POST /agents/agent_011Cowork']);
    expect(fake.rows('settings').find((s) => s.key === COWORK_SETTING_KEY)?.value).toMatchObject({ agentVersion: 2, hash: definitionHash() });
  });

  it('the setting is sanitised', () => {
    expect(sanitizeCoworkSetting({ agentId: 'nope', environmentId: 'env_011Workspace', budgetCents: 999_999 })).toEqual({ agentId: null, agentVersion: null, environmentId: 'env_011Workspace', hash: null, budgetCents: 20_000 });
    expect(sanitizeCoworkSetting(null).budgetCents).toBe(500);
  });
});

describe('a task', () => {
  it('starts idle with a spend cap, the Cowork tag, the account and mounted files; another effort is a session override', async () => {
    seed(READY);
    const r = await postCowork(ctxOf(await req('POST', '', { body: { title: '  Research   songs ', model: 'claude-haiku-5-5', effort: 'medium', budgetCents: 250, files: [{ id: 'file_011Upload', name: 'notes.pdf' }, { id: 'file_011Second', name: 'notes.pdf' }] } })));
    expect(r.status).toBe(200);
    const { task } = (await r.json()) as { task: Record<string, unknown> };
    expect(task).toMatchObject({ id: SID, title: 'Research songs', status: 'idle', budgetCents: 250, model: 'claude-haiku-5-5' });
    const create = sent.find((c) => c.path === '/sessions')!.body as Record<string, unknown>;
    expect(create.agent).toEqual({ type: 'agent_with_overrides', id: 'agent_011Cowork', version: 1, model: { id: 'claude-haiku-5-5', effort: 'medium' } });
    expect(create.environment_id).toBe('env_011Workspace');
    expect(create.budget).toEqual({ type: 'limit', max_list_cost: { amount: '250', currency: 'USD' } });
    expect(create.metadata).toEqual({ app: 'vinax-cowork', account: '1001', effort: 'medium' });
    expect(create.resources).toEqual([
      { type: 'file', file_id: 'file_011Upload', mount_path: '/notes.pdf' },
      { type: 'file', file_id: 'file_011Second', mount_path: '/2-notes.pdf' },
    ]);
    expect(create).not.toHaveProperty('initial_events');
  });

  it('the default model and effort use the agent as it is, and the cap is clamped', async () => {
    seed(READY);
    // Opus is no longer offered (Haiku only): asking for it runs on the agent's own Haiku.
    await postCowork(ctxOf(await req('POST', '', { body: { title: 'x', model: 'claude-opus-5-5', effort: 'ultra', budgetCents: 1 } })));
    const create = sent.find((c) => c.path === '/sessions')!.body as Record<string, unknown>;
    expect(create.agent).toEqual({ type: 'agent', id: 'agent_011Cowork', version: 1 });
    expect((create.budget as { max_list_cost: { amount: string } }).max_list_cost.amount).toBe('50');
  });

  it('a bad file id is refused before anything is created', async () => {
    seed(READY);
    expect((await postCowork(ctxOf(await req('POST', '', { body: { title: 'x', files: [{ id: '../etc', name: 'x' }] } })))).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('the list shows only Cowork’s own sessions', async () => {
    seed(READY);
    sessions[SID] = { id: SID, title: 'Mine', status: 'idle', metadata: { app: 'vinax-cowork' }, usage: { list_cost: { amount: '42' } }, budget: { max_list_cost: { amount: '500' } } };
    sessions[OTHER] = { id: OTHER, title: 'Not Cowork', status: 'idle', metadata: { app: 'something-else' } };
    const body = (await (await getCowork(ctxOf(await req('GET', '')))).json()) as { allowed: boolean; ready: boolean; tasks: Array<Record<string, unknown>> };
    expect(body.allowed).toBe(true);
    expect(body.ready).toBe(true);
    expect(body.tasks).toEqual([expect.objectContaining({ id: SID, title: 'Mine', costCents: 42, budgetCents: 500 })]);
  });
});

describe('task routes', () => {
  beforeEach(() => {
    sessions[SID] = { id: SID, title: 'Mine', status: 'idle', metadata: { app: 'vinax-cowork' } };
    sessions[OTHER] = { id: OTHER, title: 'Not Cowork', status: 'idle', metadata: { app: 'other' } };
  });

  it('a session that is not Cowork’s is not found, whatever the route', async () => {
    seed(READY);
    for (const sub of ['', '/stream', '/events', '/outputs']) {
      expect((await getPath(ctxOf(await req('GET', `/tasks/${OTHER}${sub}`), `tasks/${OTHER}${sub}`))).status, sub).toBe(404);
    }
    expect((await postPath(ctxOf(await req('POST', `/tasks/${OTHER}/events`, { body: { type: 'interrupt' } }), `tasks/${OTHER}/events`))).status).toBe(404);
    expect((await getPath(ctxOf(await req('GET', '/tasks/not-an-id'), 'tasks/not-an-id'))).status).toBe(404);
  });

  it('the stream is Anthropic’s, passed through untouched, with live text previews asked for', async () => {
    seed(READY);
    const r = await getPath(ctxOf(await req('GET', `/tasks/${SID}/stream`), `tasks/${SID}/stream`));
    expect(r.headers.get('content-type')).toBe('text/event-stream');
    expect(await r.text()).toBe('event: session.status_running\ndata: {"type":"session.status_running","id":"sevt_1"}\n\n');
    const call = sent.find((c) => c.path.includes('/events/stream'))!;
    expect(call.path).toBe(`/sessions/${SID}/events/stream?event_deltas[]=agent.message`);
    expect(call.headers.accept).toBe('text/event-stream');
  });

  it('history passes through, with a checked cursor', async () => {
    seed(READY);
    const r = await getPath(ctxOf(await req('GET', `/tasks/${SID}/events?page=abc_123`), `tasks/${SID}/events`));
    expect(await r.json()).toEqual({ data: [{ type: 'user.message', id: 'sevt_0', content: [{ type: 'text', text: 'hi' }] }], next_page: null });
    expect(sent.at(-1)!.path).toBe(`/sessions/${SID}/events?limit=1000&page=abc_123`);
    expect((await getPath(ctxOf(await req('GET', `/tasks/${SID}/events?page=${encodeURIComponent('a b')}`), `tasks/${SID}/events`))).status).toBe(400);
  });

  it('only a message, an interrupt or a tool decision can be sent, in Anthropic’s shape', async () => {
    seed(READY);
    const send = async (b: unknown) => postPath(ctxOf(await req('POST', `/tasks/${SID}/events`, { body: b }), `tasks/${SID}/events`));
    expect((await send({ type: 'message', text: '  Make it shorter ' })).status).toBe(200);
    expect((await send({ type: 'interrupt' })).status).toBe(200);
    expect((await send({ type: 'confirm', toolUseId: 'sevt_011Tool', allow: false, denyMessage: 'Not that file' })).status).toBe(200);
    const events = sent.filter((c) => c.method === 'POST' && c.path === `/sessions/${SID}/events`).map((c) => (c.body as { events: unknown[] }).events[0]);
    expect(events).toEqual([
      { type: 'user.message', content: [{ type: 'text', text: 'Make it shorter' }] },
      { type: 'user.interrupt' },
      { type: 'user.tool_confirmation', tool_use_id: 'sevt_011Tool', result: 'deny', deny_message: 'Not that file' },
    ]);
    for (const b of [{ type: 'user.custom_tool_result' }, { type: 'message', text: '   ' }, { type: 'confirm', toolUseId: 'toolu_1', allow: true }, { type: 'system.message', text: 'x' }]) {
      expect((await send(b)).status, JSON.stringify(b)).toBe(400);
    }
  });

  it('a new cap goes on the session; outputs are listed; a file downloads as an attachment', async () => {
    seed(READY);
    const b = await postPath(ctxOf(await req('POST', `/tasks/${SID}/budget`, { body: { cents: 1000 } }), `tasks/${SID}/budget`));
    expect(b.status).toBe(200);
    expect(sent.at(-1)!.body).toEqual({ budget: { type: 'limit', max_list_cost: { amount: '1000', currency: 'USD' } } });

    const o = (await (await getPath(ctxOf(await req('GET', `/tasks/${SID}/outputs`), `tasks/${SID}/outputs`))).json()) as { files: unknown[] };
    expect(o.files).toEqual([{ id: 'file_011Report', name: 'report.docx', size: 2048, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', createdAt: '2026-11-12T10:05:00Z' }]);
    expect(sent.at(-1)!.headers['anthropic-beta']).toBe(MA_BETA);

    const d = await getPath(ctxOf(await req('GET', '/files/file_011Report?name=re%2Fport.docx'), 'files/file_011Report'));
    expect(await d.text()).toBe('DOCX-BYTES');
    expect(d.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''re_port.docx");
    expect(d.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('an upload goes to the Files API as it came, within the size cap', async () => {
    seed(READY);
    const form = new FormData();
    form.append('file', new Blob(['%PDF-1.7 test']), 'notes.pdf');
    const probe = new Request('https://x.test', { method: 'POST', body: form });
    const type = probe.headers.get('content-type')!;
    const bytes = new Uint8Array(await probe.arrayBuffer());
    const r = await postPath(ctxOf(await req('POST', '/upload', { raw: bytes, headers: { 'content-type': type, 'content-length': String(bytes.length) } }), 'upload'));
    expect(await r.json()).toEqual({ file: { id: 'file_011Upload', name: 'notes.pdf', size: 1234 } });
    const up = sent.find((c) => c.path === '/files')!;
    expect(up.headers['content-type']).toBe(type);
    expect(up.headers['anthropic-beta']).toBeUndefined();
    const big = await postPath(ctxOf(await req('POST', '/upload', { raw: bytes, headers: { 'content-type': type, 'content-length': String(40 * 1024 * 1024) } }), 'upload'));
    expect(big.status).toBe(413);
    expect((await postPath(ctxOf(await req('POST', '/upload', { raw: 'x', headers: { 'content-type': 'text/plain' } }), 'upload'))).status).toBe(400);
  });

  it('a file is added to a running task under /mnt/session/uploads; delete removes the task', async () => {
    seed(READY);
    const a = await postPath(ctxOf(await req('POST', `/tasks/${SID}/files`, { body: { fileId: 'file_011Upload', name: 'data.csv' } }), `tasks/${SID}/files`));
    expect(await a.json()).toEqual({ ok: true, path: '/mnt/session/uploads/data.csv' });
    expect(sent.at(-1)!.body).toEqual({ type: 'file', file_id: 'file_011Upload', mount_path: '/data.csv' });
    const d = await delPath(ctxOf(await req('DELETE', `/tasks/${SID}`), `tasks/${SID}`));
    expect(await d.json()).toEqual({ ok: true });
    expect(sessions[SID]).toBeUndefined();
  });
});

describe('file names', () => {
  it('keep what a mount path and a header can hold', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('report "final".docx')).toBe('report _final_.docx');
    expect(safeFileName('', 'fallback')).toBe('fallback');
    expect(safeFileName('a'.repeat(300))).toHaveLength(120);
  });
});
