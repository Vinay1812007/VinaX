/**
 * The composed Home (Authorization: Bearer <session>).
 *
 *   GET /api/personal/home?hour=&dow=&mode=&fresh=1&festival=
 *     → 200 { generatedAt, expiresAt, greeting, shelves: [{ key, title, reason, songs }], model, tasteVersion, cached }
 *     → 204                                   the model knows too little for a page yet (the device shows its own Home)
 *   401 signed_out · 503 unavailable · 503 personal_disabled
 *
 * Served from the saved page for 30 minutes; `fresh=1` builds a new one
 * (one a minute per account). docs/personalisation.md "Composing Home".
 */
import { json } from '../../_lib/authShared';
import { bindingAllows } from '../../_lib/ratelimit';
import { buildHome, type PersonalEnv } from '../../_lib/personal/engine';
import { firstName, gate, localTime, modeOf, options, personalJson, PERSONAL_CORS } from '../../_lib/personal/route';

export const onRequestOptions = options('GET, OPTIONS');

export const onRequestGet = async (ctx: { request: Request; env: PersonalEnv; waitUntil?: (p: Promise<unknown>) => void }): Promise<Response> => {
  const g = await gate(ctx.env, ctx.request, 'personal-home', { capacity: 30, refillPerMinute: 20, perAccount: 'RATE_LIMIT_60' });
  if ('fail' in g) return g.fail;
  const url = new URL(ctx.request.url);
  let fresh = url.searchParams.get('fresh') === '1';
  if (fresh && (await bindingAllows(ctx.env, 'RATE_LIMIT_10', `personal-home-fresh|account|${g.sub}`)) === false) fresh = false;
  const { hour, dow } = localTime({ hour: url.searchParams.get('hour'), dow: url.searchParams.get('dow') });
  const festivalRaw = url.searchParams.get('festival');
  const festival = festivalRaw && /^[a-z0-9-]{2,40}$/.test(festivalRaw) ? festivalRaw : null;
  const name = g.config.composer ? await firstName(ctx.env, g.sub) : null;
  const r = await buildHome(ctx.env, g.sub, { fresh, hour, dow, mode: modeOf(url.searchParams.get('mode')), firstName: name, festival, waitUntil: ctx.waitUntil, config: g.config });
  if ('fail' in r) {
    if (r.fail === 'empty') return new Response(null, { status: 204, headers: PERSONAL_CORS });
    return json({ error: 'unavailable' }, 503);
  }
  return personalJson({ ...r.page, cached: r.cached });
};
