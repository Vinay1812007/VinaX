/** VinaX AI — the artifact parser, the prompt switch, and artifacts saved with a reply. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactsOf, parseArtifacts } from '../functions/_lib/ai/artifacts';
import { onRequestPost } from '../functions/api/ai/chat';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { _resetCooldowns } from '../functions/_lib/ai/cooldown';
import { DB_ENV, fakeDb } from './helpers/fakeDb';
import { openAiSse, readEvents, sseResponse } from './helpers/aiStreams';

describe('parseArtifacts', () => {
  it('splits text and artifacts, reading attributes in any order and either quotes', () => {
    const segs = parseArtifacts('Here is a page.\n<artifact title=\'Hello page\' type="html" id="hello-page">\n<h1>Hi</h1>\n</artifact>\nEnjoy.');
    expect(segs.map((s) => s.kind)).toEqual(['text', 'artifact', 'text']);
    expect(segs[1]).toEqual({ kind: 'artifact', artifact: { id: 'hello-page', type: 'html', title: 'Hello page', language: null, content: '<h1>Hi</h1>', incomplete: false } });
  });

  it('closes an artifact the reply never closed, dropping a half-written </artifact>', () => {
    const a = artifactsOf('<artifact id="x" type="code" language="python" title="Script">\nprint(1)\n</artifa');
    expect(a).toEqual([{ id: 'x', type: 'code', title: 'Script', language: 'python', content: 'print(1)', incomplete: true }]);
  });

  it('a tag still arriving is a placeholder; an unknown type is code; ids come from titles when missing', () => {
    expect(parseArtifacts('Making it <artifact id="a" ty')[1]).toMatchObject({ kind: 'artifact', artifact: { incomplete: true, content: '' } });
    expect(artifactsOf('<artifact type="docx" title="My Notes!">x</artifact>')[0]).toMatchObject({ id: 'my-notes', type: 'code' });
  });

  it('leaves tags inside code fences and look-alike tags alone', () => {
    const text = 'Use it like this:\n```html\n<artifact id="a" type="html">x</artifact>\n```\n<artifacts> is not a tag.';
    expect(artifactsOf(text)).toEqual([]);
    expect(parseArtifacts(text)).toEqual([{ kind: 'text', text }]);
  });

  it('keeps several artifacts in order', () => {
    expect(artifactsOf('<artifact id="a" type="svg" title="A"><svg/></artifact> and <artifact id="b" type="mermaid" title="B">graph TD</artifact>').map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('artifacts in the chat', () => {
  const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk', ...DB_ENV };
  let ip = 0;
  let pending: Array<Promise<unknown>> = [];
  beforeEach(() => { resetSettingsMemo(); _resetRateLimitsForTests(); _resetCooldowns(); pending = []; });
  afterEach(() => vi.unstubAllGlobals());

  async function send(body: Record<string, unknown>, reply: string) {
    let system = '';
    const fake = fakeDb({
      accounts: [{ id: '1001', name: 'Asha' }],
      settings: [{ key: 'vinax-ai', value: { enabled: true }, updated_at: 'x', updated_by: 'o' }],
    }, (_url, init) => {
      const b = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      if (!b.messages[0].content.includes('You write titles')) system = b.messages[0].content;
      return sseResponse(openAiSse(reply));
    });
    const token = await issueSession(ENV, '1001');
    const res = await onRequestPost({
      request: new Request('https://x/api/ai/chat', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'cf-connecting-ip': `203.0.113.${++ip}` }, body: JSON.stringify({ conversationId: null, mode: 'model', model: 'groq:openai/gpt-oss-120b', content: [{ type: 'text', text: 'Make a page' }], ...body }) }),
      env: ENV as never,
      waitUntil: (p) => { pending.push(p); },
    });
    await readEvents(res);
    await Promise.all(pending);
    return { fake, system };
  }

  it('capable models get the artifacts contract; the page can turn it off', async () => {
    expect((await send({}, 'ok')).system).toContain('# Artifacts');
    expect((await send({ artifacts: false }, 'ok')).system).not.toContain('# Artifacts');
  });

  it('a reply\'s artifacts are saved with it', async () => {
    const { fake } = await send({}, 'A page. <artifact id="page" type="html" title="Page"><p>Hi</p></artifact>');
    expect(fake.rows('ai_messages')[1].artifacts).toEqual([{ id: 'page', type: 'html', title: 'Page', language: null, content: '<p>Hi</p>', incomplete: false }]);
  });
});
