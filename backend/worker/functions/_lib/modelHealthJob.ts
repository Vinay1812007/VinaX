/**
 * 1.2.7 — the `ai-models` job: check the listed AI models with one tiny
 * request each and store the results (modelHealth.ts). Every 30-minute run
 * checks the models that are due — new ones first, then the longest unchecked
 * — within a budget, providers in parallel and one at a time within a
 * provider, so no provider sees a burst.
 *
 *   chat           "Reply with exactly: OK"   every 2 h
 *   speech         one short line             every 6 h
 *   transcription  that line, transcribed     every 6 h (needs a working voice this run)
 *   image          one small picture          every 12 h, at most one per run
 */
import { isMaestroEndpoint, laneEndpoint, PROVIDER_LANE, providerKey, type AiEnv, type AiProvider } from './ai';
import { fullCatalog, fullMedia } from './catalog';
import type { DbEnv } from './db';
import { maestroFetch } from './maestro';
import { generateImage, speak, transcribe, type MediaResult } from './media';
import { classify, healthKey, nextEntry, readHealth, writeHealth, type HealthKind, type HealthMap, type HealthReason } from './modelHealth';
import { isWorkersAiEndpoint, workersAiBinding, workersAiFetch } from './workersai';

type Env = AiEnv & DbEnv;

const HOUR = 60 * 60_000;
export const RECHECK_MS: Record<HealthKind, number> = { chat: 2 * HOUR, speech: 6 * HOUR, transcription: 6 * HOUR, image: 12 * HOUR };
/** Checks per run, and the wall-clock budget after which no new check starts. */
export const RUN_BUDGET = 60;
const SAVE_EVERY = 10;
export const RUN_TIME_MS = 4 * 60_000;
const CHAT_TIMEOUT_MS = 25_000;
const SPEECH_LINE = 'VinaX plays your favourite songs.';

export interface Target {
  kind: HealthKind;
  provider: AiProvider;
  id: string;
}

/** Every model the app lists, as check targets. */
export async function listTargets(env: AiEnv): Promise<Target[]> {
  const [chat, media] = await Promise.all([fullCatalog(env), fullMedia(env)]);
  const out: Target[] = [];
  for (const [provider, list] of Object.entries(chat)) for (const m of list) out.push({ kind: 'chat', provider: provider as AiProvider, id: m.id });
  for (const [provider, list] of Object.entries(media)) {
    for (const m of list) {
      if (m.kind === 'image' || m.kind === 'speech' || m.kind === 'transcription') out.push({ kind: m.kind, provider: provider as AiProvider, id: m.id });
    }
  }
  return out;
}

/** The targets due now: never checked first, then the longest unchecked; at most one image. */
export function dueTargets(targets: Target[], map: HealthMap | null, now: number, budget = RUN_BUDGET): Target[] {
  const due = targets
    .map((t) => ({ t, at: map?.models[healthKey(t.kind, t.provider, t.id)]?.at ?? 0 }))
    .filter(({ t, at }) => now - at >= RECHECK_MS[t.kind])
    .sort((a, b) => a.at - b.at);
  const out: Target[] = [];
  let images = 0;
  for (const { t } of due) {
    if (t.kind === 'image' && images++ >= 1) continue;
    out.push(t);
    if (out.length >= budget) break;
  }
  return out;
}

/** Text out of a chat-completions answer: the reply, or a reasoning model's thinking. */
export function answerText(body: string): string {
  try {
    const j = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown } }> };
    const m = j.choices?.[0]?.message;
    for (const v of [m?.content, m?.reasoning_content, m?.reasoning]) if (typeof v === 'string' && v.trim()) return v;
  } catch {
    /* not JSON */
  }
  return '';
}

async function checkChat(env: AiEnv, provider: AiProvider, model: string): Promise<HealthReason | null> {
  const key = providerKey(env, provider);
  if (!key) return 'refused';
  const base = laneEndpoint(env, PROVIDER_LANE[provider]);
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), CHAT_TIMEOUT_MS);
  try {
    const probe = { model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 16, temperature: 0 };
    const res = isMaestroEndpoint(base)
      ? await maestroFetch(key, model, probe, c.signal, false)
      : isWorkersAiEndpoint(base)
        ? await workersAiFetch(workersAiBinding(env), probe, c.signal)
        : await fetch(base, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify(probe),
          signal: c.signal,
        });
    const body = await res.text().catch(() => '');
    return classify(res.status, !!answerText(body));
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

function mediaReason<T>(r: MediaResult<T>, produced: (v: T) => boolean): HealthReason | null {
  return r.ok ? classify(200, produced(r.value)) : classify(r.status, false);
}

async function readAll(body: ReadableStream<Uint8Array> | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Run the checks for one provider, one at a time. */
async function checkProvider(
  env: AiEnv,
  targets: Target[],
  sample: { audio: Uint8Array; mime: string } | null,
  deadline: number,
  record: (t: Target, reason: HealthReason | null) => Promise<void>,
): Promise<{ audio: Uint8Array; mime: string } | null> {
  let heard = sample;
  for (const t of targets) {
    if (Date.now() > deadline) break;
    let reason: HealthReason | null;
    if (t.kind === 'chat') reason = await checkChat(env, t.provider, t.id);
    else if (t.kind === 'image') reason = mediaReason(await generateImage(env, t.provider, t.id, 'A small red guitar on a wooden table, simple illustration'), (v) => v.length > 100);
    else if (t.kind === 'speech') {
      const r = await speak(env, t.provider, t.id, null, SPEECH_LINE);
      let bytes: Uint8Array | null = null;
      if (r.ok) bytes = await readAll(r.value.body).catch(() => null);
      reason = r.ok ? classify(200, !!bytes && bytes.length > 2000) : classify(r.status, false);
      if (r.ok && bytes && bytes.length > 2000 && !heard) heard = { audio: bytes, mime: r.value.type.split(';')[0] || 'audio/wav' };
    } else {
      // Transcription needs real speech; without a working voice this run, it waits.
      if (!heard) continue;
      reason = mediaReason(await transcribe(env, t.provider, t.id, heard.audio, heard.mime, 'en'), (v) => v.trim().length > 0);
    }
    await record(t, reason);
  }
  return heard;
}

/** The job body: check what is due, write the merged record, answer a summary. */
export async function runModelHealth(env: Env, now = Date.now()): Promise<Record<string, unknown>> {
  const targets = await listTargets(env);
  if (!targets.length) return { skipped: 'no models listed (no AI keys, or the providers did not answer)' };
  const prev = await readHealth(env, now);
  const due = dueTargets(targets, prev, now);
  const models = { ...(prev?.models ?? {}) };
  const counts = { checked: 0, passed: 0, failed: 0 };
  // Saved every few checks as well as at the end, so a run that is cut off
  // keeps what it learned and the next run moves on to other models.
  const snapshot = (): HealthMap => ({ v: 1, checkedAt: Date.now(), fullPassAt: prev?.fullPassAt ?? null, models });
  const record = async (t: Target, reason: HealthReason | null): Promise<void> => {
    const k = healthKey(t.kind, t.provider, t.id);
    models[k] = nextEntry(models[k], reason, Date.now());
    counts.checked += 1;
    if (models[k].ok) counts.passed += 1;
    else counts.failed += 1;
    if (counts.checked % SAVE_EVERY === 0) await writeHealth(env, snapshot());
  };
  const deadline = now + RUN_TIME_MS;
  // 1. Voices first, one at a time: their audio is what transcription checks hear.
  let sample: { audio: Uint8Array; mime: string } | null = null;
  const speech = due.filter((t) => t.kind === 'speech');
  for (const t of speech) sample = await checkProvider(env, [t], sample, deadline, record);
  // No voice was due: borrow one that passed before, so due transcription checks can run.
  if (!sample && due.some((t) => t.kind === 'transcription')) {
    const voices = targets.filter((t) => t.kind === 'speech').sort((a, b) => Number(!!models[healthKey(b.kind, b.provider, b.id)]?.ok) - Number(!!models[healthKey(a.kind, a.provider, a.id)]?.ok));
    for (const t of voices) {
      sample = await checkProvider(env, [t], null, deadline, record);
      if (sample) break;
    }
  }
  // 2. Everything else: providers side by side, one check at a time within each.
  const byProvider = new Map<AiProvider, Target[]>();
  for (const t of due) if (t.kind !== 'speech') byProvider.set(t.provider, [...(byProvider.get(t.provider) ?? []), t]);
  await Promise.all([...byProvider.values()].map((list) => checkProvider(env, list, sample, deadline, record)));
  // Forget models no longer listed; note the first time every listed model has a result.
  const listed = new Set(targets.map((t) => healthKey(t.kind, t.provider, t.id)));
  for (const k of Object.keys(models)) if (!listed.has(k)) delete models[k];
  const covered = targets.every((t) => models[healthKey(t.kind, t.provider, t.id)]);
  const map: HealthMap = { v: 1, checkedAt: Date.now(), fullPassAt: prev?.fullPassAt ?? (covered ? Date.now() : null), models };
  const saved = await writeHealth(env, map);
  if (!saved) throw new Error('ai-models: could not save the results');
  const usable = Object.values(models).filter((e) => e.ok).length;
  return { ...counts, due: due.length, listed: targets.length, usable, fullPass: map.fullPassAt !== null };
}
