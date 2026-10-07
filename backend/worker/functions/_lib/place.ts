/**
 * 9.1.0 — coarse PLACE context for AI prompts, and the clock that goes with it.
 *
 * Before 9.1 every conversational prompt opened with `istNowLine()`: the time in
 * Asia/Kolkata, for everyone. That is right for most of this audience and wrong
 * for the rest — a listener in London asking "what's on this evening" was told
 * the Indian time, and nothing in the prompt knew where they were, so
 * date/time answers and search wording could not use it.
 *
 * This module builds that opening line from the coarse place the CLIENT chose to
 * send (see src/features/ai/chat/buildChatRequest.ts). Three rules hold it
 * honest:
 *
 *   1. Nothing is sent unless the listener's region-inference setting allows it.
 *      11.0 — a client that sends no usable place gets the EDGE's coarse place
 *      instead (edgePlace: the same four fields /api/geo returns, read from
 *      request.cf), so local dates and times are right without a switch; a
 *      client that says `{ off: true }` (the region setting is off) gets none,
 *      and the prompt falls back to IST exactly as 9.0 did.
 *   2. It is never presented as precise. A city is labelled "approximate", and
 *      the model is told plainly that this is a coarse network-level hint, not
 *      the listener's address or their whereabouts right now.
 *   3. The language is NOT derived from it. A listener in India who has pinned
 *      English gets English; place never overrides a stated preference. The
 *      prompt says so, because a model will otherwise helpfully "localise".
 *
 * No IP address ever reaches this module (or the client that feeds it): /api/geo
 * returns coarse fields only.
 */

import { placeName, readCountry, readTimezone } from '../api/geo';

/** A coarse place, as the client may send it. Every field optional. */
export interface CoarsePlace {
  /** ISO 3166-1 alpha-2, uppercase. */
  country: string | null;
  /** State / province name. */
  region: string | null;
  /** The edge's approximate city. Shown as approximate, never as a fact. */
  city: string | null;
  /** IANA zone. */
  timezone: string | null;
  /** Where it came from, so the line can be honest about it. */
  source: 'manual' | 'edge' | 'browser';
}

const ISO_COUNTRY = /^[A-Z]{2}$/;
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const PLACE_NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-()]*$/u;
const SOURCES = new Set(['manual', 'edge', 'browser']);

const name = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= max && PLACE_NAME.test(t) ? t : null;
};

/**
 * Validate a place from a request body. Returns null when there is nothing
 * usable — the caller then falls back to the IST line. A body that carries
 * anything unexpected (an IP, coordinates, an address) loses it here: only the
 * four fields below survive.
 */
export function readCoarsePlace(raw: unknown): CoarsePlace | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const country = typeof p.country === 'string' && ISO_COUNTRY.test(p.country.trim().toUpperCase()) ? p.country.trim().toUpperCase() : null;
  const timezoneRaw = typeof p.timezone === 'string' ? p.timezone.trim() : '';
  const timezone = timezoneRaw.length <= 64 && IANA_ZONE.test(timezoneRaw) ? timezoneRaw : null;
  const source = SOURCES.has(String(p.source)) ? (p.source as CoarsePlace['source']) : 'edge';
  // A region or city with no country is not context worth having.
  const region = country ? name(p.region, 60) : null;
  const city = country ? name(p.city, 80) : null;
  if (!country && !timezone) return null;
  return { country, region, city, timezone, source };
}

/** 11.0 — the client said, explicitly, "send no place" (`{ off: true }`). */
export function placeOptOut(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as { off?: unknown }).off === true;
}

/** 11.0 — a coarse place from the edge request: `request.cf` country / region /
 * approximate city / time zone — exactly what /api/geo returns, with the same
 * readers — tagged `source: 'edge'`. Null when the edge could not place the
 * connection. No IP address is read or kept. */
export function edgePlace(request: Request): CoarsePlace | null {
  const cf = (request as Request & { cf?: { country?: unknown; region?: unknown; city?: unknown; timezone?: unknown } }).cf ?? {};
  const country = readCountry(request.headers.get('CF-IPCountry')) ?? readCountry(cf.country);
  const timezone = readTimezone(cf.timezone);
  if (!country && !timezone) return null;
  return { country, region: country ? placeName(cf.region, 60) : null, city: country ? placeName(cf.city, 80) : null, timezone, source: 'edge' };
}

/** 11.0 — the place for one chat request: an explicit opt-out → none (the IST
 * line); a valid client place → that; a missing or invalid one → the edge's. */
export function requestPlace(raw: unknown, request: Request): CoarsePlace | null {
  if (placeOptOut(raw)) return null;
  return readCoarsePlace(raw) ?? edgePlace(request);
}

/** Is this zone one ICU will accept? A bad zone must not throw mid-request. */
function zoneWorks(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The clock, in a given zone, as one sentence. */
export function clockLine(timezone: string, label: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // Normalize the day period across ICU spellings ("pm", "PM", "p.m.").
  const ampm = get('dayPeriod').replace(/\./g, '').toLowerCase();
  return `Current date & time: ${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${ampm} ${label}.`;
}

/**
 * The prompt's opening: the clock in the listener's own zone when we have one,
 * plus a coarse place line that says exactly how coarse it is.
 *
 * `place` null → the IST line alone, which is what 9.0 sent to everyone.
 */
export function placeContextLines(place: CoarsePlace | null, now: Date = new Date()): string {
  if (!place) return clockLine('Asia/Kolkata', 'IST', now);
  const zone = place.timezone && zoneWorks(place.timezone) ? place.timezone : null;
  const clock = zone ? clockLine(zone, `local time (${zone})`, now) : clockLine('Asia/Kolkata', 'IST', now);
  const bits: string[] = [];
  if (place.country) bits.push(`country ${place.country}`);
  if (place.region) bits.push(`region ${place.region}`);
  if (place.city) bits.push(`approximate city ${place.city}`);
  if (!bits.length) return clock;
  const how =
    place.source === 'manual'
      ? 'the listener set this themselves in Settings'
      : place.source === 'browser'
        ? 'derived from their device locale and time zone'
        : 'approximate — derived from the network connection by the edge, accurate to a region at best, not confirmed by the listener';
  return [
    clock,
    `LISTENER PLACE (${how}): ${bits.join(', ')}.`,
    'This is coarse context, never an address and never where they are standing right now; an approximate city is often the network exchange rather than their town. Use it only for local time, dates, seasons, local events and the wording of searches. Never state it back as a fact about them, never guess anything finer, and NEVER infer what language they want from it — their language preferences are given separately and always win.',
  ].join('\n');
}
