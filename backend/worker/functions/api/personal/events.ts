/**
 * The personal engine's learning input (Authorization: Bearer <session>).
 *
 *   POST /api/personal/events { events: [...], songs: [...], mode? }
 *     → 200 { accepted, duplicates, version }   what was new, what the device had sent before, the model's version
 *     → 413 too_large                            more than 64 KB
 *   401 signed_out · 503 unavailable (no database) · 503 personal_disabled (the owner's switch)
 *
 * The shapes are in docs/personalisation.md "Learning: events". A repeated
 * event id counts once however often it is retried.
 */
import { readJsonCapped } from '../../_lib/body';
import { json } from '../../_lib/authShared';
import { cleanBatch, MAX_BATCH_BYTES } from '../../_lib/personal/events';
import { ingestEvents, type PersonalEnv } from '../../_lib/personal/engine';
import { gate, options, personalJson } from '../../_lib/personal/route';

export const onRequestOptions = options('POST, OPTIONS');

export const onRequestPost = async (ctx: { request: Request; env: PersonalEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const g = await gate(ctx.env, ctx.request, 'personal-events', { capacity: 60, refillPerMinute: 60, perAccount: 'RATE_LIMIT_300' });
  if ('fail' in g) return g.fail;
  const read = await readJsonCapped<unknown>(ctx.request, MAX_BATCH_BYTES);
  if (!read.ok) return json({ error: read.reason === 'too_large' ? 'too_large' : 'bad_request' }, read.reason === 'too_large' ? 413 : 400);
  const batch = cleanBatch(read.value);
  const mode = read.value && typeof read.value === 'object' ? (read.value as { mode?: unknown }).mode : undefined;
  if (!batch.events.length && !mode) return personalJson({ accepted: 0, duplicates: 0, version: null, dropped: batch.dropped });
  const r = await ingestEvents(ctx.env, g.sub, batch.events, batch.songs, { mode, waitUntil: ctx.waitUntil, config: g.config });
  if ('fail' in r) return json({ error: 'unavailable' }, 503);
  return personalJson({ ...r, dropped: batch.dropped });
};
