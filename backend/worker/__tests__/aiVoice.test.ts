/**
 * VinaX AI voice (phase 6): text split for speech, who reads a reply, the
 * dictation route (Groq Whisper, then Gemini via its Files API), the Read
 * aloud stream and its frames, Live tokens (locked to the setup, the body
 * shapes tried in turn, the key never returned) and saving a Live session
 * into a chat. Every provider is mocked; no key is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as transcribe, looksLikeAudio } from '../functions/api/ai/transcribe';
import { onRequestPost as speak, FRAME_BASE64, FRAME_FILE, FRAME_STOPPED } from '../functions/api/ai/speak';
import { onRequestPost as liveToken, liveCandidates } from '../functions/api/ai/live-token';
import { onRequestPost as liveTranscript, cleanTurns } from '../functions/api/ai/live-transcript';
import { onRequestGet as getModels } from '../functions/api/ai/models';
import { onRequestGet as getConversation } from '../functions/api/ai/conversations/[id]';
import {
  _resetVoiceRests, GEMINI_TTS_CHARS, inlineAudio, isMostlyArabic, liveSetup, noteVoiceFailure, ORPHEUS_MAX_CHARS, planSpeech, splitSpeech, tokenBodies,
} from '../functions/_lib/ai/voice';
import { ProviderError } from '../functions/_lib/ai/errors';
import { VOICE_PROMPT, voicePrompt } from '../functions/_lib/ai/prompt';
import { issueSession } from '../functions/_lib/googleAuth';
import { resetSettingsMemo } from '../functions/_lib/settings';
import { _resetRateLimitsForTests } from '../functions/_lib/ratelimit';
import { DB_ENV, fakeDb, type FakeDb } from './helpers/fakeDb';

const ENV = { GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com', AUTH_SECRET: 'auth-secret', GROQ_API_KEY: 'gsk-test', GEMINI_API_KEY: 'gem-test', ...DB_ENV };
const CONV = '11111111-1111-4111-8111-111111111111';
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const WAV = new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WAVEfmt '), 1, 2, 3]);
let ip = 0;

type Upstream = (url: string, init?: RequestInit) => Response | Promise<Response>;
let upstream: Upstream;
let seen: Array<{ url: string; init?: RequestInit }>;

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}, ai: Record<string, unknown> = { enabled: true }): FakeDb {
  return fakeDb({
    accounts: [{ id: '1001', name: 'Asha Rao' }, { id: '2002', name: 'Bo' }],
    settings: [{ key: 'vinax-ai', value: ai, updated_at: 'x', updated_by: 'owner' }],
    ...extra,
  }, (url, init) => {
    seen.push({ url, init });
    return upstream(url, init);
  });
}

async function req(path: string, init: RequestInit & { sub?: string | null; headers?: Record<string, string> } = {}): Promise<Request> {
  const sub = init.sub === undefined ? '1001' : init.sub;
  const token = sub ? await issueSession(ENV, sub) : null;
  return new Request(`https://www.vinaxmusic.online${path}`, { ...init, headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
}

const clip = async (bytes: Uint8Array, mime = 'audio/webm', env: Record<string, unknown> = ENV, sub?: string | null) =>
  transcribe({ request: await req('/api/ai/transcribe', { method: 'POST', body: new Uint8Array(bytes), sub, headers: { 'content-type': mime, 'content-length': String(bytes.length) } }), env });

const say = async (body: unknown, env: Record<string, unknown> = ENV) =>
  speak({ request: await req('/api/ai/speak', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), env });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const geminiAudio = (data = 'UklGRgAAAABXQVZF', mime = 'audio/wav') => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: mime, data } }] } }] });

/** Read the speech frames of a /api/ai/speak answer. */
async function frames(res: Response): Promise<Array<{ kind: number; mime?: string; text?: string; bytes?: Uint8Array }>> {
  const all = new Uint8Array(await res.arrayBuffer());
  const out: Array<{ kind: number; mime?: string; text?: string; bytes?: Uint8Array }> = [];
  let at = 0;
  while (at < all.length) {
    const kind = all[at];
    const len = new DataView(all.buffer, all.byteOffset + at + 1, 4).getUint32(0);
    const payload = all.slice(at + 5, at + 5 + len);
    at += 5 + len;
    if (kind === FRAME_FILE) {
      const nl = payload.indexOf(10);
      out.push({ kind, mime: new TextDecoder().decode(payload.slice(0, nl)), bytes: payload.slice(nl + 1) });
    } else if (kind === FRAME_BASE64) {
      const t = new TextDecoder().decode(payload);
      out.push({ kind, mime: t.slice(0, t.indexOf('\n')), text: t.slice(t.indexOf('\n') + 1) });
    } else out.push({ kind, text: new TextDecoder().decode(payload) });
  }
  return out;
}

beforeEach(() => {
  resetSettingsMemo();
  _resetRateLimitsForTests();
  _resetVoiceRests();
  seen = [];
  upstream = () => new Response('{}', { status: 500 });
});
afterEach(() => vi.unstubAllGlobals());

describe('text for speech', () => {
  it('splits at sentence ends, never past the limit, and cuts a run-on sentence at commas or spaces', () => {
    const text = 'Short one. ' + 'This sentence, which goes on and on, keeps adding clauses, and more clauses, and still more clauses until it is far too long for one request to the speech model. '.repeat(2) + 'The end!';
    const pieces = splitSpeech(text, ORPHEUS_MAX_CHARS);
    expect(pieces.every((p) => p.length <= ORPHEUS_MAX_CHARS)).toBe(true);
    expect(pieces[0].startsWith('Short one.')).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim());
    expect(splitSpeech('x'.repeat(450), 200).map((p) => p.length)).toEqual([200, 200, 50]);
    expect(splitSpeech('   ', 200)).toEqual([]);
  });

  it('packs short sentences together up to the limit', () => {
    expect(splitSpeech('One. Two. Three.', 200)).toEqual(['One. Two. Three.']);
    expect(splitSpeech('One. Two. Three.', 9)).toEqual(['One. Two.', 'Three.']);
  });

  it('tells Arabic text from Latin text', () => {
    expect(isMostlyArabic('مرحبا، كيف حالك اليوم؟')).toBe(true);
    expect(isMostlyArabic('Hello, how are you today?')).toBe(false);
    expect(isMostlyArabic('123 456')).toBe(false);
  });

  it('pulls the audio out of a Gemini reply without parsing all of it', () => {
    expect(inlineAudio(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: 'AAEC' } }] } }] })))
      .toEqual({ data: 'AAEC', mime: 'audio/L16;codec=pcm;rate=24000' });
    expect(inlineAudio('{"candidates":[]}')).toBeNull();
  });
});

describe('who reads a reply', () => {
  const voices = { read: 'diana', live: 'Puck' };
  it('Orpheus reads a short reply in the chosen voice; Arabic gets the Arabic model and voice', () => {
    expect(planSpeech(ENV, 'Hello there.', voices)).toMatchObject({ engine: 'orpheus', model: 'canopylabs/orpheus-v1-english', voice: 'diana', pieces: ['Hello there.'] });
    expect(planSpeech(ENV, 'مرحبا بك في فيناكس', voices)).toMatchObject({ engine: 'orpheus', model: 'canopylabs/orpheus-arabic-saudi', voice: 'abdullah' });
  });

  it('a long reply is read by one Gemini voice throughout, in Gemini-sized pieces', () => {
    const long = 'A sentence that is long enough to count. '.repeat(40);
    const plan = planSpeech(ENV, long, voices);
    expect(plan).toMatchObject({ engine: 'gemini', model: 'gemini-3.8-flash-tts', voice: 'Puck' });
    expect(plan!.pieces.every((p) => p.length <= GEMINI_TTS_CHARS)).toBe(true);
  });

  it('a resting Orpheus hands short replies to Gemini; without Gemini a long reply still goes to Orpheus', () => {
    noteVoiceFailure('canopylabs/orpheus-v1-english', new ProviderError('quota'));
    expect(planSpeech(ENV, 'Hi.', voices)?.engine).toBe('gemini');
    _resetVoiceRests();
    expect(planSpeech({ ...ENV, GEMINI_API_KEY: '' }, 'Words here. '.repeat(100), voices)?.engine).toBe('orpheus');
    expect(planSpeech({ ...ENV, GROQ_API_KEY: '', GEMINI_API_KEY: '' }, 'Hi.', voices)).toBeNull();
  });
});

describe('POST /api/ai/transcribe', () => {
  it('needs a session, a known audio type, a length, and audio bytes', async () => {
    seed();
    expect((await clip(WEBM, 'audio/webm', ENV, null)).status).toBe(401);
    expect((await clip(WEBM, 'application/pdf')).status).toBe(415);
    expect((await clip(new TextEncoder().encode('<html>not audio at all</html>'))).status).toBe(415);
    const noLength = await transcribe({ request: await req('/api/ai/transcribe', { method: 'POST', body: new Uint8Array(WEBM), headers: { 'content-type': 'audio/webm' } }), env: ENV });
    expect([400, 411, 415]).toContain(noLength.status);
    const huge = await transcribe({ request: await req('/api/ai/transcribe', { method: 'POST', body: new Uint8Array(WEBM), headers: { 'content-type': 'audio/webm', 'content-length': String(26 * 1024 * 1024) } }), env: ENV });
    expect(huge.status).toBe(413);
  });

  it('is off without a voice key, and while VinaX AI is switched off', async () => {
    seed();
    expect(await (await clip(WEBM, 'audio/webm', { ...ENV, GROQ_API_KEY: '', GEMINI_API_KEY: '' })).json()).toEqual({ error: 'ai_not_configured' });
    seed({}, { enabled: false });
    expect(await (await clip(WEBM)).json()).toEqual({ error: 'ai_disabled' });
  });

  it('sends the clip to Groq Whisper turbo as a file and answers its text', async () => {
    seed();
    upstream = (url) => (url.endsWith('/audio/transcriptions') ? json({ text: '  Say OK  ' }) : new Response('', { status: 500 }));
    const res = await clip(WEBM);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Say OK' });
    const call = seen.find((s) => s.url.endsWith('/audio/transcriptions'))!;
    const form = call.init!.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect((form.get('file') as File).name).toBe('clip.webm');
    expect((call.init!.headers as Record<string, string>).authorization).toBe('Bearer gsk-test');
  });

  it('moves to whisper-large-v3, then to Gemini (upload, then the transcription model) when Groq is busy', async () => {
    seed();
    upstream = (url) => {
      if (url.endsWith('/audio/transcriptions')) return json({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '20' });
      if (url.endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://upload.test/session-1' } });
      if (url === 'https://upload.test/session-1') return json({ file: { uri: 'https://files.test/abc' } });
      if (url.includes('gemini-3.5-transcribe:generateContent')) return json({ candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }] });
      return new Response('', { status: 500 });
    };
    const res = await clip(new Uint8Array([...new TextEncoder().encode('OggS'), ...WEBM]), 'audio/ogg');
    expect(await res.json()).toEqual({ text: 'Hello from Gemini' });
    const models = seen.filter((s) => s.url.endsWith('/audio/transcriptions')).map((s) => (s.init!.body as FormData).get('model'));
    expect(models).toEqual(['whisper-large-v3-turbo', 'whisper-large-v3']);
    const ask = seen.find((s) => s.url.includes(':generateContent'))!;
    expect(JSON.parse(String(ask.init!.body)).contents[0].parts[0]).toEqual({ fileData: { mimeType: 'audio/ogg', fileUri: 'https://files.test/abc' } });
    // The key travels in a header, never in a URL.
    expect(seen.every((s) => !s.url.includes('gem-test') && !s.url.includes('gsk-test'))).toBe(true);
    // Resting now: the next clip skips Groq.
    seen = [];
    await clip(new Uint8Array([...new TextEncoder().encode('OggS'), ...WEBM]), 'audio/ogg');
    expect(seen.some((s) => s.url.endsWith('/audio/transcriptions'))).toBe(false);
  });

  it('asks Flash with a prompt when the transcription model answers empty', async () => {
    seed({}, { enabled: true });
    upstream = (url) => {
      if (url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.test/s' } });
      if (url === 'https://upload.test/s') return json({ file: { uri: 'https://files.test/x' } });
      if (url.includes('gemini-3.5-transcribe')) return json({ candidates: [{ content: { parts: [] } }] });
      if (url.includes('gemini-3.8-flash:generateContent')) return json({ candidates: [{ content: { parts: [{ text: 'Flash heard this' }] } }] });
      return new Response('', { status: 500 });
    };
    expect(await (await clip(WEBM, 'audio/webm', { ...ENV, GROQ_API_KEY: '' })).json()).toEqual({ text: 'Flash heard this' });
  });

  it('answers voice_busy when every engine is out of allowance, and never echoes a provider body', async () => {
    seed();
    upstream = () => json({ error: { message: 'secret upstream detail tokens per day exceeded' } }, 429);
    const res = await clip(WEBM);
    expect(res.status).toBe(429);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'voice_busy' });
    expect(text).not.toContain('secret');
  });

  it('is held to the account’s 10-a-minute tier', async () => {
    seed();
    const env = { ...ENV, RATE_LIMIT_10: { limit: async () => ({ success: false }) } };
    expect((await clip(WEBM, 'audio/webm', env)).status).toBe(429);
  });

  it('recognises the clip formats by their first bytes', () => {
    expect(looksLikeAudio(WEBM)).toBe(true);
    expect(looksLikeAudio(WAV)).toBe(true);
    expect(looksLikeAudio(new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode('ftypM4A ')]))).toBe(true);
    expect(looksLikeAudio(new TextEncoder().encode('%PDF-1.7 hello'))).toBe(false);
  });
});

describe('POST /api/ai/speak', () => {
  it('reads a short reply with Orpheus and streams WAV frames, one per piece', async () => {
    seed();
    upstream = (url) => (url.endsWith('/audio/speech') ? new Response(WAV, { headers: { 'content-type': 'audio/wav' } }) : new Response('', { status: 500 }));
    const text = 'First sentence here. '.repeat(12).trim(); // ~250 chars: two Orpheus pieces
    const res = await say({ text, voice: 'hannah' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-vinax-speech');
    const got = await frames(res);
    expect(got.map((f) => f.kind)).toEqual([FRAME_FILE, FRAME_FILE]);
    expect(got[0].mime).toBe('audio/wav');
    expect([...got[0].bytes!]).toEqual([...WAV]);
    const bodies = seen.filter((s) => s.url.endsWith('/audio/speech')).map((s) => JSON.parse(String(s.init!.body)));
    expect(bodies[0]).toMatchObject({ model: 'canopylabs/orpheus-v1-english', voice: 'hannah', response_format: 'wav' });
    expect(bodies.every((b) => b.input.length <= ORPHEUS_MAX_CHARS)).toBe(true);
  });

  it('an unknown voice falls back to Troy', async () => {
    seed();
    upstream = () => new Response(WAV);
    await frames(await say({ text: 'Hi.', voice: 'nobody' }));
    expect(JSON.parse(String(seen[0].init!.body)).voice).toBe('troy');
  });

  it('a long reply is read by Gemini: base64 frames with the voice in the new field', async () => {
    seed();
    upstream = (url) => (url.includes('gemini-3.8-flash-tts:generateContent') ? geminiAudio() : new Response('', { status: 500 }));
    const res = await say({ text: 'This is a long reply that goes on. '.repeat(30), liveVoice: 'Puck' });
    const got = await frames(res);
    expect(got.length).toBeGreaterThan(1);
    expect(got.every((f) => f.kind === FRAME_BASE64 && f.mime === 'audio/wav' && f.text === 'UklGRgAAAABXQVZF')).toBe(true);
    const body = JSON.parse(String(seen[0].init!.body));
    expect(body.generationConfig).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Puck' } } });
  });

  it('Gemini refusing the new voice field is asked again with the older one', async () => {
    seed();
    upstream = (_url, init) => {
      const b = JSON.parse(String(init?.body));
      return b.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig ? geminiAudio() : json({ error: { message: 'Unknown field voice' } }, 400);
    };
    const got = await frames(await say({ text: 'Hi.' }, { ...ENV, GROQ_API_KEY: '' }));
    expect(got).toHaveLength(1);
    expect(JSON.parse(String(seen[1].init!.body)).generationConfig.speechConfig.voiceConfig).toEqual({ prebuiltVoiceConfig: { voiceName: 'Kore' } });
  });

  it('when Orpheus fails part-way, the rest is read by Gemini', async () => {
    seed();
    let orpheus = 0;
    upstream = (url) => {
      if (url.endsWith('/audio/speech')) return (orpheus += 1) === 1 ? new Response(WAV) : json({ error: { message: 'Rate limit reached for model' } }, 429, { 'retry-after': '30' });
      if (url.includes('gemini-3.8-flash-tts')) return geminiAudio();
      return new Response('', { status: 500 });
    };
    const got = await frames(await say({ text: 'Sentence number one is here. '.repeat(20).slice(0, 700) }));
    expect(got[0].kind).toBe(FRAME_FILE);
    expect(got.slice(1).every((f) => f.kind === FRAME_BASE64)).toBe(true);
  });

  it('a piece that fails after the first ends the stream with a stopped frame', async () => {
    seed();
    let n = 0;
    upstream = (url) => (url.includes('gemini') ? json({}, 500) : (n += 1) === 1 ? new Response(WAV) : json({}, 500));
    const got = await frames(await say({ text: 'One sentence that is here. '.repeat(10) }));
    expect(got[0].kind).toBe(FRAME_FILE);
    expect(got[got.length - 1]).toEqual({ kind: FRAME_STOPPED, text: JSON.stringify({ error: 'voice_unavailable' }) });
  });

  it('when nothing can read the first piece, answers an error (no stream)', async () => {
    seed();
    upstream = () => json({ error: { message: 'tokens per day' } }, 429);
    const res = await say({ text: 'Hello.' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'voice_busy' });
  });

  it('refuses empty and over-long text', async () => {
    seed();
    expect((await say({ text: '   ' })).status).toBe(400);
    expect((await say({ text: 'x'.repeat(7_000) })).status).toBe(413);
    expect((await say({})).status).toBe(400);
  });
});

describe('POST /api/ai/live-token', () => {
  const ask = async (body: unknown = {}, env: Record<string, unknown> = ENV) =>
    liveToken({ request: await req('/api/ai/live-token', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), env });

  it('mints a one-use token locked to the Live setup, and never returns the key', async () => {
    seed();
    upstream = (url) => (url.endsWith('/v1beta/auth_tokens') ? json({ name: 'auth_tokens/one-use-token' }) : new Response('', { status: 500 }));
    const res = await ask({ voice: 'Aoede', timezone: 'Asia/Kolkata' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('gem-test');
    const body = JSON.parse(text);
    expect(body).toMatchObject({ token: 'auth_tokens/one-use-token', model: { id: 'gemini-3.8-live' } });
    expect(body.url).toBe('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained');
    expect(body.setup.model).toBe('models/gemini-3.8-live');
    expect(body.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');
    expect(body.setup.inputAudioTranscription).toEqual({});
    expect(body.setup.systemInstruction.parts[0].text).toContain('Live voice');
    expect(body.setup.systemInstruction.parts[0].text).toContain('Asha');
    const sent = JSON.parse(String(seen[0].init!.body));
    expect(sent.uses).toBe(1);
    expect(sent.liveConnectConstraints.model).toBe('models/gemini-3.8-live');
    expect((seen[0].init!.headers as Record<string, string>)['x-goog-api-key']).toBe('gem-test');
  });

  it('tries the next body shape when Google refuses one', async () => {
    seed();
    upstream = (_url, init) => (JSON.parse(String(init?.body)).bidiGenerateContentSetup ? json({ name: 'tok-2' }) : json({ error: { message: 'Invalid JSON payload' } }, 400));
    expect((await (await ask()).json()).token).toBe('tok-2');
  });

  it('Extended thinking puts the thinking Live model first; skipped models are left out', () => {
    expect(liveCandidates(true, [])[0].id).toBe('gemini-3.8-live-extended-thinking');
    expect(liveCandidates(false, ['gemini-3.8-live'])[0].id).toBe('gemini-3.1-flash-live-preview');
    expect(liveCandidates(false, ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.5-flash-native-audio-preview-09-2025'])).toEqual([]);
    // A model picked in settings goes first, once; the others stay as fallbacks.
    const picked = liveCandidates(true, [], Date.now(), 'gemini-2.5-flash-native-audio-latest').map((m) => m.id);
    expect(picked.slice(0, 3)).toEqual(['gemini-2.5-flash-native-audio-latest', 'gemini-3.8-live-extended-thinking', 'gemini-3.8-live']);
    expect(new Set(picked).size).toBe(picked.length);
    // An unknown pick is ignored.
    expect(liveCandidates(false, [], Date.now(), 'gpt-5')[0].id).toBe('gemini-3.8-live');
  });

  it('needs a Gemini key, and a refused key is a calm 503', async () => {
    seed();
    expect(await (await ask({}, { ...ENV, GEMINI_API_KEY: '' })).json()).toEqual({ error: 'ai_not_configured' });
    upstream = () => json({ error: { message: 'API key not valid' } }, 401);
    const res = await ask();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'voice_unavailable' });
    expect(seen).toHaveLength(1); // a refused key is not tried on every model
  });

  it('builds the token bodies from the setup, with a start window and a lifetime', () => {
    const setup = liveSetup('gemini-3.8-live', 'Kore', 'prompt');
    const bodies = tokenBodies(setup, Date.parse('2026-10-31T10:00:00Z'));
    expect(bodies.map((b) => b.shape)).toEqual(['constraints', 'setup', 'plain']);
    expect(bodies[0].body).toMatchObject({ uses: 1, expireTime: '2026-10-31T10:30:00.000Z', newSessionExpireTime: '2026-10-31T10:02:00.000Z' });
  });
});

describe('POST /api/ai/live-transcript', () => {
  const save = async (body: unknown, sub?: string | null) =>
    liveTranscript({ request: await req('/api/ai/live-transcript', { method: 'POST', body: JSON.stringify(body), sub, headers: { 'content-type': 'application/json' } }), env: ENV });
  const turns = [{ role: 'user', text: 'What is a raga?' }, { role: 'assistant', text: 'A raga is a melodic framework.' }, { role: 'assistant', text: 'It guides improvisation.' }, { role: 'user', text: ' ' }];

  it('starts a chat with the session as messages, each hanging on the one before', async () => {
    const db = seed();
    const res = await save({ conversationId: null, model: 'gemini-3.8-live', turns });
    expect(res.status).toBe(200);
    const out = await res.json() as { conversationId: string; messageIds: string[] };
    expect(out.messageIds).toHaveLength(2);
    const msgs = db.rows('ai_messages');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0].parent_id).toBeNull();
    expect(msgs[1].parent_id).toBe(msgs[0].id);
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'A raga is a melodic framework. It guides improvisation.' }]);
    expect(msgs[1].model_id).toBe('gemini-live:gemini-3.8-live');
    const conv = db.rows('ai_conversations')[0];
    expect(conv).toMatchObject({ account_id: '1001', title: 'What is a raga?', active_leaf_id: out.messageIds[1] });
  });

  it('continues an existing chat after its active leaf; another account’s chat is not found', async () => {
    const db = seed({
      ai_conversations: [{ id: CONV, account_id: '1001', title: 'Old', starred: false, active_leaf_id: 'a1', deleted_at: null }],
      ai_messages: [{ id: 'u1', conversation_id: CONV, parent_id: null, role: 'user', content: [{ type: 'text', text: 'hi' }] }, { id: 'a1', conversation_id: CONV, parent_id: 'u1', role: 'assistant', content: [{ type: 'text', text: 'hello' }] }],
    });
    const res = await save({ conversationId: CONV, model: 'gemini-3.8-live', turns: turns.slice(0, 2) });
    expect(res.status).toBe(200);
    const added = db.rows('ai_messages').slice(2);
    expect(added[0].parent_id).toBe('a1');
    expect((await save({ conversationId: CONV, model: 'gemini-3.8-live', turns }, '2002')).status).toBe(404);
  });

  it('refuses unknown models, bad turns and missing sessions', async () => {
    seed();
    expect((await save({ conversationId: null, model: 'gpt-x', turns })).status).toBe(400);
    expect((await save({ conversationId: null, model: 'gemini-3.8-live', turns: [] })).status).toBe(400);
    expect((await save({ conversationId: null, model: 'gemini-3.8-live', turns: [{ role: 'system', text: 'x' }] })).status).toBe(400);
    expect((await save({ conversationId: null, model: 'gemini-3.8-live', turns }, null)).status).toBe(401);
  });

  it('cleanTurns drops empty turns and joins a speaker’s run', () => {
    expect(cleanTurns([{ role: 'user', text: 'a' }, { role: 'user', text: ' b ' }, { role: 'assistant', text: '' }])).toEqual([{ role: 'user', text: 'a b' }]);
    expect(cleanTurns([{ role: 'user', text: '' }])).toBeNull();
  });

  it('a saved Live reply is labelled with its Live model', async () => {
    seed({
      ai_conversations: [{ id: CONV, account_id: '1001', title: 'Voice', starred: false, active_leaf_id: 'a1', deleted_at: null }],
      ai_messages: [{ id: 'a1', conversation_id: CONV, parent_id: null, role: 'assistant', content: [{ type: 'text', text: 'hi' }], model_id: 'gemini-live:gemini-3.8-live', provider: 'gemini' }],
    });
    const res = await getConversation({ request: await req(`/api/ai/conversations/${CONV}`), env: ENV, params: { id: CONV } } as never);
    const body = await res.json() as { messages: Array<{ model: unknown }> };
    expect(body.messages[0].model).toEqual({ id: 'gemini-live:gemini-3.8-live', name: 'Gemini 3.8 Live', provider: 'Google Gemini' });
  });
});

describe('the voice prompt and the model list', () => {
  it('the Live prompt is spoken-style and names the model', () => {
    const p = voicePrompt({ now: new Date('2026-10-31T10:00:00Z'), timezone: 'UTC', locale: 'en', firstName: null, modelName: 'Gemini 3.8 Live', providerName: 'Google' });
    expect(p).toContain('running on Gemini 3.8 Live');
    expect(p).toContain("User's first name: not known");
    expect(p).not.toMatch(/\{\{/);
    expect(VOICE_PROMPT).toContain('No Markdown');
  });

  it('GET /api/ai/models says which voice features work and lists the voices', async () => {
    seed();
    const body = await (await getModels({ request: await req('/api/ai/models'), env: ENV })).json() as { voice: Record<string, unknown> };
    expect(body.voice).toMatchObject({ dictation: true, readAloud: true, live: true });
    expect(body.voice.voices).toContain('troy');
    expect(body.voice.liveVoices).toContain('Kore');
    const groqOnly = await (await getModels({ request: await req('/api/ai/models'), env: { ...ENV, GEMINI_API_KEY: '' } })).json() as { voice: Record<string, unknown> };
    expect(groqOnly.voice).toMatchObject({ dictation: true, readAloud: true, live: false });
  });
});
