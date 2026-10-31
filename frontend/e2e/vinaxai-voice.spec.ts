/**
 * VinaX AI voice (phase 6) in a real browser against the built app, with a
 * fake microphone (Chromium's test tone) and /api/ai/* answered by the
 * test. Gemini Live's WebSocket is answered by a stand-in that speaks the
 * real protocol: setup → setupComplete, mic audio in, transcription and
 * audio out. No provider is contacted.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

test.use({
  launchOptions: { args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  permissions: ['microphone'],
});

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const VOICE = { dictation: true, readAloud: true, live: true, voices: ['troy', 'hannah'], liveVoices: ['Kore', 'Puck'] };
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
/** The production CSP (public/_headers), so the mic worklet and the Live socket are held to it. */
const APP_CSP = /Content-Security-Policy: (.+)/.exec(readFileSync(new URL('../public/_headers', import.meta.url), 'utf8'))![1];
const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Half a second of a quiet tone as a 16-bit WAV. */
function wavTone(seconds = 0.5, rate = 24_000): Buffer {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) data.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const frame = (kind: number, payload: Buffer): Buffer => {
  const h = Buffer.alloc(5);
  h[0] = kind;
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
};

interface Server { transcribe: Array<{ type: string; size: number }>; speak: Array<Record<string, unknown>>; chats: number; saved: Array<Record<string, unknown>>; tokens: number }

async function setup(page: Page, opts: { voice?: typeof VOICE | null; csp?: boolean } = {}): Promise<Server> {
  const server: Server = { transcribe: [], speak: [], chats: 0, saved: [], tokens: 0 };
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (opts.csp && r.resourceType() === 'document') {
      const res = await route.fetch();
      return route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': APP_CSP } });
    }
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') {
      return route.fulfill({ json: { enabled: true, configured: true, groups: ['balanced'], models: [{ ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true }], ...(opts.voice === null ? {} : { voice: opts.voice ?? VOICE }) } });
    }
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/transcribe') {
      server.transcribe.push({ type: r.headers()['content-type'], size: r.postDataBuffer()?.length ?? 0 });
      return route.fulfill({ json: { text: 'Say OK' } });
    }
    if (url.pathname === '/api/ai/speak') {
      server.speak.push(r.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: 'application/x-vinax-speech', body: frame(1, Buffer.concat([Buffer.from('audio/wav\n'), wavTone()])) });
    }
    if (url.pathname === '/api/ai/live-token') {
      server.tokens += 1;
      return route.fulfill({ json: { token: 'auth_tokens/test', url: LIVE_URL, setup: { model: 'models/gemini-3.8-live', generationConfig: { responseModalities: ['AUDIO'] } }, model: { id: 'gemini-3.8-live', name: 'Gemini 3.8 Live' }, expiresAt: '2099-01-01T00:00:00Z' } });
    }
    if (url.pathname === '/api/ai/live-transcript') {
      server.saved.push(r.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { conversationId: C1, messageIds: ['b1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222'] } });
    }
    if (url.pathname === `/api/ai/conversations/${C1}`) {
      return route.fulfill({ json: {
        conversation: { id: C1, title: 'What is a raga?', starred: false, activeLeafId: 'b2222222-2222-4222-8222-222222222222' },
        messages: [
          { id: 'b1111111-1111-4111-8111-111111111111', parentId: null, role: 'user', content: [{ type: 'text', text: 'What is a raga?' }], createdAt: '2026-10-31T10:00:00Z' },
          { id: 'b2222222-2222-4222-8222-222222222222', parentId: 'b1111111-1111-4111-8111-111111111111', role: 'assistant', content: [{ type: 'text', text: 'A raga is a melodic framework.' }], model: { id: 'gemini-live:gemini-3.8-live', name: 'Gemini 3.8 Live', provider: 'Google Gemini' }, stopReason: 'end', createdAt: '2026-10-31T10:00:01Z' },
        ],
      } });
    }
    if (url.pathname === '/api/ai/chat') {
      server.chats += 1;
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }], ['text', { delta: 'A **raga** is a melodic framework [1].\n\n```js\nconsole.log(1)\n```' }], ['done', { stopReason: 'end' }]]) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

test('dictation: the mic records, the text lands in the composer to edit, and nothing is sent', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('Please');
  await page.getByRole('button', { name: 'Dictate' }).click();
  const finish = page.getByRole('button', { name: 'Finish dictation' });
  await expect(finish).toBeEnabled();
  await page.waitForTimeout(1200);
  await finish.click();
  await expect(box).toHaveValue('Please Say OK');
  expect(server.transcribe).toHaveLength(1);
  expect(server.transcribe[0].type).toMatch(/^audio\/(webm|ogg|mp4)/);
  expect(server.transcribe[0].size).toBeGreaterThan(500);
  expect(server.chats).toBe(0);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
});

test('dictation can be cancelled without sending anything', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Dictate' }).click();
  await expect(page.getByRole('button', { name: 'Finish dictation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel dictation' }).click();
  await expect(page.getByRole('button', { name: 'Dictate' })).toBeVisible();
  expect(server.transcribe).toHaveLength(0);
});

test('read aloud: the reply’s words (no markup or code) are read, and the button stops it', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('What is a raga?');
  await box.press('Enter');
  await expect(page.locator('.vx-ai-md')).toContainText('melodic framework');
  await page.getByRole('button', { name: 'Read aloud' }).click();
  const stop = page.getByRole('button', { name: 'Stop reading' });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  expect(server.speak[0]).toMatchObject({ text: 'A raga is a melodic framework.\n\n(There’s a code block here.)', voice: 'troy', liveVoice: 'Kore' });
  // Half a second of audio, then it ends by itself.
  await expect(page.getByRole('button', { name: 'Read aloud' })).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await page.getByRole('button', { name: 'Stop reading' }).click();
  await expect(page.getByRole('button', { name: 'Read aloud' })).toHaveAttribute('aria-pressed', 'false');
});

test('voice settings: the chosen voices go with Read aloud', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'More options' }).click();
  await page.getByRole('menuitem', { name: /Voice settings/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Voice' });
  await dialog.getByLabel('Read aloud voice').selectOption('hannah');
  await dialog.getByLabel('Live voice').selectOption('Puck');
  await dialog.getByRole('button', { name: 'Done' }).click();
  const box = page.getByRole('textbox', { name: 'Message VinaX AI' });
  await box.fill('Hi');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await expect.poll(() => server.speak.length).toBe(1);
  expect(server.speak[0]).toMatchObject({ voice: 'hannah', liveVoice: 'Puck' });
});

test('Live voice: talks over Gemini Live’s protocol, shows captions, and saves the session into the chat', async ({ page }) => {
  // Under the production CSP: the mic worklet must load from the app and the socket must be allowed.
  const server = await setup(page, { csp: true });
  const blocked: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) blocked.push(m.text()); });
  const fromPage: Array<Record<string, unknown>> = [];
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    expect(ws.url()).toContain('access_token=auth_tokens%2Ftest');
    let answered = false;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      fromPage.push(msg);
      if (msg.setup) { ws.send(JSON.stringify({ setupComplete: {} })); return; }
      const audio = (msg.realtimeInput as { audio?: unknown } | undefined)?.audio;
      if (audio && !answered) {
        answered = true;
        ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'What is a raga?' } } }));
        ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: wavTone(0.3).subarray(44).toString('base64') } }] }, outputTranscription: { text: 'A raga is a melodic framework.' } } }));
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
    });
  });
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Start Live voice' }).click();
  const live = page.getByRole('dialog', { name: 'Live voice' });
  await expect(live).toBeVisible();
  await expect(live.getByText('A raga is a melodic framework.')).toBeVisible({ timeout: 10_000 });
  await expect(live.getByText('What is a raga?')).toBeVisible();
  // The page sent the setup first, then mic audio in the format Live reads.
  expect(fromPage[0]).toMatchObject({ setup: { model: 'models/gemini-3.8-live' } });
  const audio = fromPage.find((m) => (m.realtimeInput as { audio?: unknown } | undefined)?.audio) as { realtimeInput: { audio: { mimeType: string; data: string } } };
  expect(audio.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
  expect(audio.realtimeInput.audio.data.length).toBeGreaterThan(100);
  await expect(live.getByText('Gemini 3.8 Live')).toBeVisible();

  await live.getByRole('button', { name: 'End' }).click();
  await expect(live).toHaveCount(0);
  expect(server.saved[0]).toEqual({ conversationId: null, model: 'gemini-3.8-live', turns: [{ role: 'user', text: 'What is a raga?' }, { role: 'assistant', text: 'A raga is a melodic framework.' }] });
  await expect(page).toHaveURL(new RegExp(`/vinaxai/c/${C1}$`));
  await expect(page.locator('.vx-ai-md')).toContainText('A raga is a melodic framework.');
  await expect(page.getByText('Gemini 3.8 Live · Google Gemini')).toBeVisible();
  expect(blocked.filter((b) => /micTap|generativelanguage|script-src|connect-src/i.test(b))).toEqual([]);
});

test('Live voice in an open chat continues it after its last reply, and the chat shows the new turns', async ({ page }) => {
  const server = await setup(page);
  const A = 'c1111111-1111-4111-8111-111111111111';
  const B = 'c2222222-2222-4222-8222-222222222222';
  const base = [
    { id: A, parentId: null, role: 'user', content: [{ type: 'text', text: 'Earlier question' }], createdAt: '2026-10-31T09:00:00Z' },
    { id: B, parentId: A, role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }], model: MODEL, stopReason: 'end', createdAt: '2026-10-31T09:00:01Z' },
  ];
  let saved = false;
  // This chat's own address answers before and after the session.
  await page.route(`**/api/ai/conversations/${C1}`, (route) => route.fulfill({ json: {
    conversation: { id: C1, title: 'Earlier', starred: false, activeLeafId: saved ? 'b2222222-2222-4222-8222-222222222222' : B },
    messages: saved ? [...base,
      { id: 'b1111111-1111-4111-8111-111111111111', parentId: B, role: 'user', content: [{ type: 'text', text: 'Spoken question' }], createdAt: '2026-10-31T10:00:00Z' },
      { id: 'b2222222-2222-4222-8222-222222222222', parentId: 'b1111111-1111-4111-8111-111111111111', role: 'assistant', content: [{ type: 'text', text: 'Spoken answer' }], model: { id: 'gemini-live:gemini-3.8-live', name: 'Gemini 3.8 Live', provider: 'Google Gemini' }, stopReason: 'end', createdAt: '2026-10-31T10:00:01Z' },
    ] : base,
  } }));
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    let answered = false;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg.setup) { ws.send(JSON.stringify({ setupComplete: {} })); return; }
      if (!answered) {
        answered = true;
        ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'Spoken question' }, outputTranscription: { text: 'Spoken answer' } } }));
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }));
      }
    });
  });
  await page.goto(`/vinaxai/c/${C1}`);
  await expect(page.locator('.vx-ai-md')).toContainText('Earlier answer');
  await page.getByRole('button', { name: 'Start Live voice' }).click();
  const live = page.getByRole('dialog', { name: 'Live voice' });
  await expect(live.getByText('Spoken answer')).toBeVisible({ timeout: 10_000 });
  saved = true;
  await live.getByRole('button', { name: 'End' }).click();
  await expect(live).toHaveCount(0);
  expect(server.saved[0]).toMatchObject({ conversationId: C1, parentMessageId: B, model: 'gemini-3.8-live' });
  await expect(page.locator('.vx-ai-md').last()).toContainText('Spoken answer');
  await expect(page.locator('.vx-ai-md').first()).toContainText('Earlier answer');
});

test('Live voice: a model that will not start is replaced by the next one', async ({ page }) => {
  const server = await setup(page);
  let sockets = 0;
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    sockets += 1;
    if (sockets === 1) { ws.close({ code: 1008, reason: 'model not found' }); return; }
    ws.onMessage((raw) => { if (JSON.parse(String(raw)).setup) ws.send(JSON.stringify({ setupComplete: {} })); });
  });
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Start Live voice' }).click();
  const live = page.getByRole('dialog', { name: 'Live voice' });
  await expect(live.getByRole('status')).toHaveText('Listening', { timeout: 10_000 });
  expect(server.tokens).toBe(2);
  await page.keyboard.press('Escape');
  await expect(live).toHaveCount(0);
  expect(server.saved).toHaveLength(0); // nothing was said
});

test('without voice keys there is no mic and no Live button', async ({ page }) => {
  await setup(page, { voice: null });
  await page.goto('/vinaxai');
  await expect(page.getByRole('textbox', { name: 'Message VinaX AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dictate' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start Live voice' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

for (const theme of ['dark', 'light'] as const) {
  test(`the voice controls and the Live view have no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await setup(page);
    await page.addInitScript((t) => {
      localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: t, pinnedLanguages: ['telugu'] }, version: 5 }));
    }, theme);
    await page.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
      ws.onMessage((raw) => { if (JSON.parse(String(raw)).setup) ws.send(JSON.stringify({ setupComplete: {} })); });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/vinaxai');
    await page.getByRole('button', { name: 'Dictate' }).click();
    await expect(page.getByRole('button', { name: 'Finish dictation' })).toBeEnabled();
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    let results = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    await page.getByRole('button', { name: 'Cancel dictation' }).click();
    await page.getByRole('button', { name: 'Start Live voice' }).click();
    await expect(page.getByRole('dialog', { name: 'Live voice' }).getByRole('status')).toHaveText('Listening', { timeout: 10_000 });
    results = await new AxeBuilder({ page }).withTags(tags).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  });
}
