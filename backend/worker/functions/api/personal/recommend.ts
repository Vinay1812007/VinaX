/**
 * A ranked list from the personal engine (Authorization: Bearer <session>).
 *
 *   GET /api/personal/recommend?seed=<songId>&limit=<n>&exclude=<ids>&hour=&mode=
 *     → 200 { seed, songs: [SongRecord] }   around the seed, or around the taste alone without one
 *   401 signed_out · 503 unavailable · 503 personal_disabled
 *
 * The device's Up Next engine uses it as one source among its own
 * (docs/personalisation.md "Radio and next songs").
 */
import { json } from '../../_lib/authShared';
import { recommend, type PersonalEnv } from '../../_lib/personal/engine';
import { gate, localTime, modeOf, options, personalJson } from '../../_lib/personal/route';
import { SONG_ID_RE } from '../../_lib/personal/songs';

export const onRequestOptions = options('GET, OPTIONS');

export const onRequestGet = async (ctx: { request: Request; env: PersonalEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const g = await gate(ctx.env, ctx.request, 'personal-recommend', { capacity: 40, refillPerMinute: 30, perAccount: 'RATE_LIMIT_60' });
  if ('fail' in g) return g.fail;
  const url = new URL(ctx.request.url);
  const seedRaw = url.searchParams.get('seed');
  const seed = seedRaw && SONG_ID_RE.test(seedRaw) ? seedRaw : null;
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const exclude = (url.searchParams.get('exclude') ?? '').split(',').map((s) => s.trim()).filter((s) => SONG_ID_RE.test(s)).slice(0, 200);
  const { hour } = localTime({ hour: url.searchParams.get('hour') });
  const r = await recommend(ctx.env, g.sub, { seed, limit, exclude, hour, mode: modeOf(url.searchParams.get('mode')), waitUntil: ctx.waitUntil, config: g.config });
  if ('fail' in r) return json({ error: 'unavailable' }, 503);
  return personalJson(r);
};
