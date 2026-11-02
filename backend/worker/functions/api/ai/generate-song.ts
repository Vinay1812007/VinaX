/**
 * VinaX music AI — song generation: a NEW, ORIGINAL song in the feel of the
 * one playing, made by the music models on the VinaX AI key (see
 * _lib/ai/songGen.ts for the models and the originality rules).
 *
 *   GET  /api/ai/generate-song            → { available, reason?, limit, remaining, ttlHours }
 *   POST /api/ai/generate-song            { mood, energy, tempo, genre, language, durationSec (30–180),
 *                                           instrumental, promptText?, kid? }
 *     → 202 { jobId, status, progress, remaining }
 *     → 400 bad_request · 401 signed_out · 422 prompt_names_artist | prompt_too_long | prompt_not_allowed
 *     → 429 rate_limited | quota_exceeded · 502 gen_failed · 503 gen_not_configured | ai_disabled
 *
 * Built from the playing song's METADATA only: no audio, title, artist or
 * lyrics is ever sent here, and none reaches the music model. A device makes at
 * most the owner's daily quota (5 by default; header `x-vinax-device`), an
 * account at most three devices' worth, and the owner's `ai-music.generate`
 * switch must be on. Kid mode forces an instrumental and safe words.
 */
import { CORS, json } from '../../_lib/authShared';
import { readJsonCapped } from '../../_lib/body';
import { bearer, readSession } from '../../_lib/googleAuth';
import { bindingAllows, rateLimitAsync } from '../../_lib/ratelimit';
import { musicSettings } from '../../_lib/ai/music';
import {
  deviceDayKey, fallbackTitle, fetchFinishedAudio, genConfigured, GENERATED_TTL_SEC, namesRealWork, quotaUsed, sanitizeGenInput, startProviderJob, storageOf, takeQuota, writeJob, audioKey,
  type GenEnv, type JobRecord,
} from '../../_lib/ai/songGen';

const MAX_BODY = 4 * 1024;
const ACCOUNT_DEVICES = 3;

const tooMany = (error: string, extra: Record<string, unknown> = {}): Response =>
  new Response(JSON.stringify({ error, ...extra }), { status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60', ...CORS } });

const deviceOf = (request: Request): string => (request.headers.get('x-vinax-device') ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);

interface Ctx { request: Request; env: GenEnv }

/** Is generation available to this listener, and how many are left today? */
export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  const settings = await musicSettings(env);
  const limit = settings.generate.dailyQuota;
  if (!genConfigured(env)) return json({ available: false, reason: 'gen_not_configured', limit, remaining: 0, ttlHours: GENERATED_TTL_SEC / 3_600 });
  if (!settings.enabled || !settings.generate.enabled) return json({ available: false, reason: 'ai_disabled', limit, remaining: 0, ttlHours: GENERATED_TTL_SEC / 3_600 });
  const used = await quotaUsed(env, await deviceDayKey(deviceOf(request), sub));
  return json({ available: true, limit, remaining: Math.max(0, limit - used), ttlHours: GENERATED_TTL_SEC / 3_600 });
};

export const onRequestPost = async ({ request, env }: Ctx): Promise<Response> => {
  const limited = await rateLimitAsync(request, 'ai-generate', { capacity: 3, refillPerMinute: 2 }, env);
  if (limited) return limited;
  const sub = await readSession(env, bearer(request));
  if (!sub) return json({ error: 'signed_out' }, 401);
  if ((await bindingAllows(env, 'RATE_LIMIT_10', `ai-generate|account|${sub}`)) === false) return tooMany('rate_limited', { retryAfter: 60 });
  if (!genConfigured(env)) return json({ error: 'gen_not_configured' }, 503);
  const settings = await musicSettings(env);
  if (!settings.enabled || !settings.generate.enabled) return json({ error: 'ai_disabled' }, 503);

  const read = await readJsonCapped<Record<string, unknown> | null>(request, MAX_BODY);
  if (!read.ok) return json({ error: 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const parsed = sanitizeGenInput(read.value);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.error === 'bad_request' ? 400 : 422);
  const input = parsed.input;
  // A second look at the listener's own words, when the music AI can answer.
  if (input.promptText && (await namesRealWork(env, input.promptText))) return json({ error: 'prompt_names_artist' }, 422);

  const limit = settings.generate.dailyQuota;
  const deviceKey = await deviceDayKey(deviceOf(request), sub);
  const accountKey = `acct:${await deviceDayKey('', sub)}`;
  const [used, accountUsed] = await Promise.all([quotaUsed(env, deviceKey), quotaUsed(env, accountKey)]);
  if (used >= limit || accountUsed >= limit * ACCOUNT_DEVICES) return tooMany('quota_exceeded', { limit, remaining: 0 });

  const started = await startProviderJob(env, input);
  if (!started || started.status === 'failed') {
    console.log(JSON.stringify({ route: 'ai-generate', ok: false, stage: 'start' }));
    return json({ error: 'gen_failed' }, 502);
  }
  const jobId = crypto.randomUUID();
  const job: JobRecord = {
    owner: sub,
    status: started.status === 'done' ? 'running' : started.status,
    ...(started.providerId ? { providerId: started.providerId } : {}),
    createdAt: Date.now(),
    durationSec: started.durationSec ?? input.durationSec,
    instrumental: input.instrumental,
    language: input.language,
    mood: input.mood,
    ...(started.title ? { title: started.title.slice(0, 60) } : {}),
  };
  if (started.status === 'done') {
    // The song came back in the one call: keep it now.
    const audio = await fetchFinishedAudio(env, started);
    if (!audio) return json({ error: 'gen_failed' }, 502);
    await storageOf(env)!.put(audioKey(jobId), audio.bytes, { expirationTtl: GENERATED_TTL_SEC, metadata: { mime: audio.mime } });
    job.status = 'done';
    job.mime = audio.mime;
    job.title = job.title ?? fallbackTitle(job);
  }
  await Promise.all([writeJob(env, jobId, job), takeQuota(env, deviceKey, used), takeQuota(env, accountKey, accountUsed)]);
  console.log(JSON.stringify({ route: 'ai-generate', ok: true, status: job.status, kid: input.kid, instrumental: input.instrumental }));
  return json({ jobId, status: job.status, progress: job.status === 'done' ? 1 : started.progress, remaining: Math.max(0, limit - used - 1) }, 202);
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
