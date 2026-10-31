#!/usr/bin/env node
/**
 * VinaX AI model probe — run by the owner with their own keys, never in CI.
 *
 *   cd backend && npm run ai:probe                 # every registry model
 *   npm run ai:probe -- --only gemini              # ids containing "gemini"
 *   npm run ai:probe -- --no-image                 # skip the image check
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
 * vision. It prints a table and writes nothing; it never prints a key or a
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

const models = MODELS.filter((m) => !only || m.id.includes(only));
const lim = await limits();
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
console.table(rows);
console.log('Use these to set the registry flags in worker/functions/_lib/ai/models.ts (thinkFormat, systemRole, vision, maxContextChars, maxOutput).');
