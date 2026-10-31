#!/usr/bin/env node
/**
 * VinaX AI model probe — run by the owner with their own keys, never in CI.
 *
 *   cd backend && npm run ai:probe                 # every registry model
 *   npm run ai:probe -- --only gemini              # ids containing "gemini"
 *   npm run ai:probe -- --no-image                 # skip the image check
 *   npm run ai:probe -- --voice-only               # only the voice checks (below)
 *   npm run ai:probe -- --no-voice                 # skip the voice checks
 *
 * Reads keys from worker/.dev.vars (gitignored): GROQ_API_KEY, GEMINI_API_KEY,
 * OPENROUTER_API_KEY, NVIDIA_API_KEY, and for Workers AI over REST
 * CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (optional). For each model in
 * worker/functions/_lib/ai/models.ts it records:
 *
 *   ttft      time to the first streamed token (reasoning or text)
 *   stream    whether the reply streamed in more than one piece
 *   reasoning where reasoning arrived: field | tags | parts | none
 *   system    whether a system message was accepted and followed
 *   image     whether the model read a small test image (vision flag)
 *   ctx / out the context window and output limit, when the provider says
 *
 * One streamed request per model, plus one image request for models flagged
 * vision.
 *
 * Voice (phase 6, worker/functions/_lib/ai/voice.ts; keep the ids in step):
 * dictation on each Whisper model and each Gemini transcription model (a
 * one-second test tone), Read aloud on each Orpheus and Gemini TTS model
 * (which voice field Gemini accepts, and the audio type it returns), which
 * Live token body Google accepts, and a real Live handshake (setup →
 * setupComplete) on each Live model. About 15 small requests. It prints a table and writes nothing; it never prints a key or a
 * response body. Use the results to set the registry flags (docs/ai.md).
 * Needs Node 22.18+ (it imports the TypeScript registry directly).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODELS } from '../worker/functions/_lib/ai/models.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] ?? '' : '';
const withImage = !args.includes('--no-image');
const voiceOnly = args.includes('--voice-only');
const withVoice = !args.includes('--no-voice');

function readDevVars() {
  try {
    const text = readFileSync(`${here}../worker/.dev.vars`, 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...readDevVars() };
const KEYS = { groq: env.GROQ_API_KEY, gemini: env.GEMINI_API_KEY, openrouter: env.OPENROUTER_API_KEY, nvidia: env.NVIDIA_API_KEY };
const OPENAI_URL = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
};
const EXTRA_HEADERS = { openrouter: { 'HTTP-Referer': 'https://www.vinaxmusic.online', 'X-Title': 'VinaX AI' } };

// A 16×16 solid red PNG.
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP4z8BAEmIY1TCqYfhqAACQ+f8B8u7oVwAAAABJRU5ErkJggg==';
const SYSTEM = 'Always end every reply with the single word PINEAPPLE.';
const QUESTION = 'Say hello in five words.';
const TIMEOUT_MS = 60_000;

async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) {
        const d = line.slice(5).trim();
        if (d && d !== '[DONE]') yield d;
      }
    }
  }
}

const parse = (d) => { try { return JSON.parse(d); } catch { return null; } };

/** One streamed probe. Returns { ok, status?, ttft, pieces, text, reasoning }. */
async function streamProbe(spec, { image = false } = {}) {
  const started = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res;
  const question = image ? 'What single colour fills this image? Answer with one word.' : QUESTION;
  try {
    if (spec.provider === 'gemini') {
      const parts = [{ text: question }, ...(image ? [{ inline_data: { mime_type: 'image/png', data: RED_PNG } }] : [])];
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${spec.upstream}:streamGenerateContent?alt=sse`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': KEYS.gemini },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: 512, thinkingConfig: { includeThoughts: true } } }),
      });
    } else if (spec.provider === 'cloudflare') {
      res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${spec.upstream}`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        body: JSON.stringify({ stream: true, max_tokens: 256, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: question }] }),
      });
    } else {
      const content = image ? [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: `data:image/png;base64,${RED_PNG}` } }] : question;
      res = await fetch(`${OPENAI_URL[spec.provider]}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEYS[spec.provider]}`, ...(EXTRA_HEADERS[spec.provider] ?? {}) },
        body: JSON.stringify({ model: spec.upstream, stream: true, max_tokens: 512, ...(spec.params ?? {}), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
      });
    }
  } catch (e) {
    return { ok: false, status: e?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, status: res.status };
  }
  let ttft = null;
  let pieces = 0;
  let text = '';
  const reasoning = new Set();
  try {
    for await (const d of sseLines(res)) {
      const j = parse(d);
      if (!j) continue;
      let gotText = '';
      if (spec.provider === 'gemini') {
        for (const p of j.candidates?.[0]?.content?.parts ?? []) {
          if (p.thought === true && p.text) reasoning.add('parts');
          else if (p.text) gotText += p.text;
        }
      } else if (spec.provider === 'cloudflare') {
        gotText = j.response ?? j.choices?.[0]?.delta?.content ?? '';
        if (j.reasoning_content || j.choices?.[0]?.delta?.reasoning_content) reasoning.add('field');
      } else {
        const delta = j.choices?.[0]?.delta ?? {};
        if (delta.reasoning || delta.reasoning_content) reasoning.add('field');
        gotText = delta.content ?? '';
      }
      if ((gotText || reasoning.size) && ttft === null) ttft = Date.now() - started;
      if (gotText) { pieces += 1; text += gotText; }
    }
  } catch {
    return { ok: false, status: 'stream broke' };
  }
  if (/<think>/.test(text)) reasoning.add('tags');
  const answer = text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
  return { ok: true, ttft, pieces, text: answer, reasoning: reasoning.size ? [...reasoning].join('+') : 'none' };
}

/** Context and output limits, from each provider's model list (one request per provider). */
async function limits() {
  const out = {};
  const get = async (url, headers) => {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      return r.ok ? r.json() : null;
    } catch {
      return null;
    }
  };
  if (KEYS.groq) for (const m of (await get(`${OPENAI_URL.groq}/models`, { authorization: `Bearer ${KEYS.groq}` }))?.data ?? []) out[`groq:${m.id}`] = { ctx: m.context_window, out: m.max_completion_tokens };
  if (KEYS.openrouter) for (const m of (await get(`${OPENAI_URL.openrouter}/models`, {}))?.data ?? []) out[`openrouter:${m.id}`] = { ctx: m.context_length, out: m.top_provider?.max_completion_tokens };
  if (KEYS.gemini) {
    let page = '';
    for (let i = 0; i < 5; i++) {
      const j = await get(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${page ? `&pageToken=${page}` : ''}`, { 'x-goog-api-key': KEYS.gemini });
      for (const m of j?.models ?? []) out[`gemini:${String(m.name).replace(/^models\//, '')}`] = { ctx: m.inputTokenLimit, out: m.outputTokenLimit };
      page = j?.nextPageToken ?? '';
      if (!page) break;
    }
  }
  return out;
}

const configured = (spec) => (spec.provider === 'cloudflare' ? !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) : !!KEYS[spec.provider]);

const models = voiceOnly ? [] : MODELS.filter((m) => !only || m.id.includes(only));
const lim = models.length ? await limits() : {};
const rows = [];
for (const spec of models) {
  if (!configured(spec)) {
    rows.push({ model: spec.id, ok: 'skip', note: 'no key' });
    continue;
  }
  const r = await streamProbe(spec);
  const row = {
    model: spec.id,
    ok: r.ok ? 'yes' : `no (${r.status})`,
    ttft: r.ttft != null ? `${(r.ttft / 1000).toFixed(2)}s` : '',
    stream: r.ok ? (r.pieces > 1 ? 'yes' : 'one piece') : '',
    reasoning: r.reasoning ?? '',
    system: r.ok ? (/pineapple/i.test(r.text) ? 'yes' : 'ignored') : r.status === 400 ? 'maybe refused' : '',
    image: '',
    ctx: lim[spec.id]?.ctx ?? '',
    out: lim[spec.id]?.out ?? '',
    flags: `think=${spec.flags.thinkFormat} vision=${spec.flags.vision}`,
  };
  if (withImage && spec.flags.vision) {
    const img = await streamProbe(spec, { image: true });
    row.image = img.ok ? (/red/i.test(img.text) ? 'yes' : 'wrong answer') : `no (${img.status})`;
  }
  rows.push(row);
}
if (rows.length) {
  console.table(rows);
  console.log('Use these to set the registry flags in worker/functions/_lib/ai/models.ts (thinkFormat, systemRole, vision, maxContextChars, maxOutput).');
}

// ---------------------------------------------------------------- voice

/** One second of a 440 Hz tone as a 16 kHz 16-bit WAV. */
function toneWav(seconds = 1, rate = 16_000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i += 1) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

const GEMINI = 'https://generativelanguage.googleapis.com';
const timed = async (fn) => { const t0 = Date.now(); try { const r = await fn(); return { ...r, ms: Date.now() - t0 }; } catch (e) { return { ok: false, note: e?.name === 'TimeoutError' ? 'timeout' : 'network error', ms: Date.now() - t0 }; } };
const sig = () => AbortSignal.timeout(TIMEOUT_MS);

async function voiceChecks() {
  const out = [];
  const add = (check, model, r) => out.push({ check, model, ok: r.ok ? 'yes' : 'no', ms: r.ms ?? '', note: r.note ?? '' });
  const wav = toneWav();

  if (KEYS.groq) {
    for (const model of ['whisper-large-v3-turbo', 'whisper-large-v3']) {
      add('dictation', model, await timed(async () => {
        const form = new FormData();
        form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
        form.append('model', model);
        form.append('response_format', 'json');
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${KEYS.groq}` }, body: form, signal: sig() });
        const j = res.ok ? await res.json().catch(() => null) : null;
        return { ok: res.ok && typeof j?.text === 'string', note: res.ok ? 'text field present' : `HTTP ${res.status}` };
      }));
    }
    for (const [model, voice, text] of [['canopylabs/orpheus-v1-english', 'troy', 'Hello from VinaX.'], ['canopylabs/orpheus-arabic-saudi', 'abdullah', 'مرحبا من فيناكس']]) {
      add('read aloud', model, await timed(async () => {
        const res = await fetch('https://api.groq.com/openai/v1/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${KEYS.groq}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: text, voice, response_format: 'wav' }), signal: sig() });
        const b = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
        return { ok: !!b && b.subarray(0, 4).toString() === 'RIFF', note: b ? `${(b.length / 1024).toFixed(0)} KB WAV` : `HTTP ${res.status}` };
      }));
    }
  } else out.push({ check: 'dictation / read aloud', model: 'Groq', ok: 'skip', ms: '', note: 'no GROQ_API_KEY' });

  if (KEYS.gemini) {
    const g = { 'x-goog-api-key': KEYS.gemini };
    // Dictation fallback: upload once, then each transcription model.
    let uri = null;
    add('dictation upload', 'Files API', await timed(async () => {
      const start = await fetch(`${GEMINI}/upload/v1beta/files`, { method: 'POST', headers: { ...g, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(wav.length), 'X-Goog-Upload-Header-Content-Type': 'audio/wav', 'content-type': 'application/json' }, body: JSON.stringify({ file: { display_name: 'probe' } }), signal: sig() });
      const url = start.headers.get('x-goog-upload-url');
      if (!start.ok || !url) return { ok: false, note: `HTTP ${start.status}` };
      const done = await fetch(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: wav, signal: sig() });
      uri = done.ok ? (await done.json().catch(() => null))?.file?.uri ?? null : null;
      return { ok: !!uri, note: uri ? 'uploaded' : `HTTP ${done.status}` };
    }));
    if (uri) {
      for (const model of ['gemini-3.5-transcribe', 'gemini-3.8-flash']) {
        add('dictation', model, await timed(async () => {
          const parts = [{ fileData: { mimeType: 'audio/wav', fileUri: uri } }];
          if (model !== 'gemini-3.5-transcribe') parts.push({ text: 'Transcribe this audio. Reply with the transcript only.' });
          const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { ...g, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts }] }), signal: sig() });
          return { ok: res.ok, note: res.ok ? 'answered' : `HTTP ${res.status}` };
        }));
      }
    }
    for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-flash-preview-tts']) {
      add('read aloud', model, await timed(async () => {
        const notes = [];
        for (const [shape, voiceConfig] of [['voice', { voice: 'Kore' }], ['prebuiltVoiceConfig', { prebuiltVoiceConfig: { voiceName: 'Kore' } }]]) {
          const res = await fetch(`${GEMINI}/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { ...g, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hello from VinaX.' }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig } } }), signal: sig() });
          if (res.ok) {
            const text = await res.text();
            const mime = /"mimeType"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? '?';
            return { ok: true, note: `${shape} field accepted · ${mime}` };
          }
          notes.push(`${shape}: HTTP ${res.status}`);
          if (res.status !== 400) break;
        }
        return { ok: false, note: notes.join(', ') };
      }));
    }
    // Live: which token body is accepted, then a real handshake per model.
    const liveModels = ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025'];
    for (const model of liveModels) {
      const setup = { model: `models/${model}`, generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } }, systemInstruction: { parts: [{ text: 'You are a test. Say OK.' }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: { slidingWindow: {} } };
      const now = Date.now();
      const times = { uses: 1, expireTime: new Date(now + 30 * 60_000).toISOString(), newSessionExpireTime: new Date(now + 2 * 60_000).toISOString() };
      const config = { responseModalities: ['AUDIO'], speechConfig: setup.generationConfig.speechConfig, systemInstruction: setup.systemInstruction, inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: setup.contextWindowCompression };
      let token = null;
      add('live token', model, await timed(async () => {
        const tried = [];
        for (const [shape, body] of [['constraints', { ...times, liveConnectConstraints: { model: setup.model, config } }], ['setup', { ...times, bidiGenerateContentSetup: setup }], ['plain', times]]) {
          const res = await fetch(`${GEMINI}/v1beta/auth_tokens`, { method: 'POST', headers: { ...g, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: sig() });
          if (res.ok) {
            token = (await res.json().catch(() => null))?.name ?? null;
            return { ok: !!token, note: `"${shape}" body accepted${tried.length ? ` (refused: ${tried.join(', ')})` : ''}` };
          }
          tried.push(`${shape} ${res.status}`);
          if (res.status !== 400) break;
        }
        return { ok: false, note: tried.join(', ') };
      }));
      if (!token || typeof WebSocket === 'undefined') continue;
      add('live handshake', model, await timed(() => new Promise((resolve) => {
        const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`);
        const timer = setTimeout(() => { ws.close(); resolve({ ok: false, note: 'no setupComplete in 15 s' }); }, 15_000);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => ws.send(JSON.stringify({ setup }));
        ws.onmessage = (e) => {
          const raw = typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8');
          if (raw.includes('setupComplete')) { clearTimeout(timer); ws.close(1000); resolve({ ok: true, note: 'setupComplete' }); }
        };
        ws.onclose = (e) => { clearTimeout(timer); resolve({ ok: false, note: `closed ${e.code}${e.reason ? `: ${String(e.reason).slice(0, 60)}` : ''}` }); };
      })));
    }
  } else out.push({ check: 'voice', model: 'Gemini', ok: 'skip', ms: '', note: 'no GEMINI_API_KEY' });
  return out;
}

if (withVoice) {
  console.table(await voiceChecks());
  console.log('Voice: send this table with the model table. Ids live in worker/functions/_lib/ai/voice.ts.');
}
