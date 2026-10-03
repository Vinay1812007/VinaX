import { isNativePlatform } from '@/services/native';

/**
 * 9.1.0 — live-web discoveries (GET /api/discover).
 *
 * A discovery is a CATALOGUE SONG that a current web source named and that the
 * server resolved against the real catalogue, with the source URL, the kind of
 * source, when it was observed and the publication or chart period where the
 * evidence stated one.
 *
 * Nothing here is a catalogue search result, and nothing may be labelled a chart
 * position unless it arrived through this client with `sourceType: 'chart'` and
 * a non-null `rank`. Every field is re-validated here; an item that fails is
 * DROPPED, never repaired — including an item whose `sourceType` this build does
 * not know, so a newer server can add one without breaking older apps.
 *
 * `fetchDiscoveries` never throws. It resolves null when the read is unavailable
 * (offline, timeout, HTTP error, malformed answer), so callers fall back to
 * catalogue lists that are labelled as catalogue lists.
 *
 * Load this module lazily: it is not part of the first-load bundle.
 */
export type DiscoverySourceType = 'chart' | 'editorial' | 'release' | 'search-result';
export type DiscoveryState = 'ok' | 'stale' | 'cold' | 'not_configured' | 'resting' | 'empty' | 'no_reader' | 'failed';
export type DiscoveryIntent = 'new-releases' | 'charting' | 'trending-songs';

export interface DiscoveryEvidence {
  url: string;
  title: string;
  sourceType: DiscoverySourceType;
  observedAt: string;
  publishedAt: string | null;
  period: string | null;
}

export interface Discovery {
  catalogId: string;
  title: string;
  artist: string;
  language: string | null;
  matchConfidence: number;
  sourceType: DiscoverySourceType;
  /** Only ever set for a chart source that stated a position. */
  rank: number | null;
  evidence: DiscoveryEvidence[];
}

export interface DiscoverySnapshot {
  state: DiscoveryState;
  /** True when the evidence is past the server's freshness horizon. */
  stale: boolean;
  evidenceAt: string | null;
  region: string;
  language: string | null;
  intent: DiscoveryIntent;
  items: Discovery[];
  /** Plain words for a shelf footer or the owner console. Never a success claim. */
  note: string;
}

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/discover' : '/api/discover';
const TIMEOUT_MS = 9_000;
const SOURCE_TYPES = new Set<string>(['chart', 'editorial', 'release', 'search-result'] satisfies DiscoverySourceType[]);
const STATES = new Set<string>(['ok', 'stale', 'cold', 'not_configured', 'resting', 'empty', 'no_reader', 'failed'] satisfies DiscoveryState[]);
const INTENTS = new Set<string>(['new-releases', 'charting', 'trending-songs'] satisfies DiscoveryIntent[]);

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isoTime = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
};

function readEvidence(raw: unknown): DiscoveryEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const url = httpsUrl(e.url);
  const title = text(e.title, 200);
  const observedAt = isoTime(e.observedAt);
  // An item a person cannot open is not evidence.
  if (!url || !title || !observedAt || !SOURCE_TYPES.has(String(e.sourceType))) return null;
  return {
    url,
    title,
    sourceType: e.sourceType as DiscoverySourceType,
    observedAt,
    publishedAt: isoTime(e.publishedAt),
    period: text(e.period, 20),
  };
}

export function readDiscovery(raw: unknown): Discovery | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const catalogId = text(d.catalogId, 60);
  const title = text(d.title, 200);
  const sourceType = String(d.sourceType);
  const confidence = Number(d.matchConfidence);
  if (!catalogId || !title || !SOURCE_TYPES.has(sourceType)) return null;
  // The server only resolves confident matches; anything else is a bug upstream.
  if (!(confidence >= 0.8 && confidence <= 1)) return null;
  const evidence = (Array.isArray(d.evidence) ? d.evidence : []).map(readEvidence).filter((e): e is DiscoveryEvidence => e !== null);
  if (!evidence.length) return null;
  const rank = Number(d.rank);
  return {
    catalogId,
    title,
    artist: text(d.artist, 200) ?? '',
    language: text(d.language, 30),
    matchConfidence: confidence,
    sourceType: sourceType as DiscoverySourceType,
    // A rank is only meaningful on a chart source. Anywhere else it is dropped,
    // whatever the server sent, so no surface can print a position that no
    // chart stated.
    rank: sourceType === 'chart' && Number.isInteger(rank) && rank >= 1 && rank <= 200 ? rank : null,
    evidence,
  };
}

export async function fetchDiscoveries(opts: {
  region?: string;
  language?: string;
  intent?: DiscoveryIntent;
  /** Run the discovery and wait for it. Default false: answer from the cache. */
  wait?: boolean;
  signal?: AbortSignal;
}): Promise<DiscoverySnapshot | null> {
  const params = new URLSearchParams();
  const region = (opts.region ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(region)) params.set('region', region);
  const language = (opts.language ?? '').trim().toLowerCase();
  if (/^[a-z]{2,20}$/.test(language)) params.set('language', language);
  if (opts.intent && INTENTS.has(opts.intent)) params.set('intent', opts.intent);
  if (opts.wait) params.set('wait', '1');
  if (opts.signal?.aborted) return null;

  const controller = new AbortController();
  const relay = (): void => controller.abort();
  const timer = setTimeout(relay, TIMEOUT_MS);
  opts.signal?.addEventListener('abort', relay, { once: true });
  try {
    const qs = params.toString();
    const res = await fetch(qs ? `${ENDPOINT}?${qs}` : ENDPOINT, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return null;
    const state = String(body.state);
    if (!STATES.has(state)) return null;
    const intent = String(body.intent);
    return {
      state: state as DiscoveryState,
      stale: body.stale === true || state === 'stale',
      evidenceAt: isoTime(body.evidenceAt),
      region: text(body.region, 2) ?? region,
      language: text(body.language, 30),
      intent: INTENTS.has(intent) ? (intent as DiscoveryIntent) : 'trending-songs',
      items: body.items.map(readDiscovery).filter((d): d is Discovery => d !== null),
      note: text(body.note, 300) ?? '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', relay);
  }
}

/**
 * The label a surface may show for a discovery. Deliberately conservative: a
 * chart position is only ever claimed when the evidence stated one, and nothing
 * here says "trending today" unless a chart source is behind it.
 */
export function discoveryLabel(d: Discovery): string {
  switch (d.sourceType) {
    case 'chart':
      return d.rank ? `Charting at #${d.rank}` : 'On a current chart';
    case 'release':
      return 'A new release';
    case 'editorial':
      return 'A current editorial pick';
    default:
      return 'Named by a current web source';
  }
}

/** What a surface says about the state of its evidence. Empty when all is well. */
export function discoveryStateNote(snapshot: DiscoverySnapshot | null): string {
  if (!snapshot) return 'Live discovery could not be reached — showing catalogue picks.';
  switch (snapshot.state) {
    case 'ok':
      return '';
    case 'stale':
      return 'This evidence is a few hours old.';
    case 'cold':
      return 'Looking for what is current — check back in a moment.';
    case 'not_configured':
      return 'Live web discovery is not set up on this server.';
    case 'resting':
      return 'Live discovery is resting — showing catalogue picks.';
    case 'no_reader':
      return 'No AI engine is configured, so web results cannot be read.';
    case 'empty':
      return 'Nothing current could be matched to the catalogue right now.';
    default:
      return 'Live discovery is unavailable — showing catalogue picks.';
  }
}
