import type { RecommendationContext } from '@/services/recommendation/types';
import type { Discovery, DiscoverySnapshot } from './client';

/**
 * 9.1.0 — live-web discoveries as ONE bounded signal for the music pipeline,
 * built exactly like the verified-trends signal (services/trends/signal.ts).
 *
 * The rule that matters: **playback never waits on a web search.** This module
 * answers from a small in-memory snapshot, synchronously, always. When that
 * snapshot is missing or old it starts a refresh in the background for the round
 * AFTER this one, and returns what it has — which may be nothing. A missing,
 * resting or unconfigured discovery service therefore costs a song transition
 * exactly zero.
 *
 * The cache-only read is the default (`wait: false` on /api/discover), so the
 * first ask for a question returns `cold` and the server warms it behind the
 * caller. Surfaces where the listener is ALREADY waiting for a result (the AI
 * Playlist, Radio, a "find something current" tap) may ask the client directly
 * with `wait: true` instead; they do not come through here.
 */

export interface DiscoverySignal {
  /** The discoveries themselves, strongest evidence first. */
  items: readonly Discovery[];
  /** Catalogue id → the label a surface may show ("Charting at #3"). */
  label: ReadonlyMap<string, string>;
  /** When the evidence was observed, or null when there is none. */
  evidenceAt: string | null;
  /** True when the server said its evidence is past the freshness horizon. */
  stale: boolean;
  /** The state the server reported, for an honest shelf footer. */
  state: DiscoverySnapshot['state'] | 'none';
  at: number;
  region: string | null;
  language: string | null;
}

/** How long a snapshot is used before a refresh is started. */
const FRESH_MS = 20 * 60_000;
/** How long a failed read is remembered, so a dead endpoint is not polled every round. */
const RETRY_MS = 10 * 60_000;

const EMPTY: DiscoverySignal = { items: [], label: new Map(), evidenceAt: null, stale: false, state: 'none', at: 0, region: null, language: null };

let signal: DiscoverySignal = EMPTY;
let loading: Promise<void> | null = null;
let retryAfter = 0;

/** Test hook. */
export function resetDiscoverySignal(): void {
  signal = EMPTY;
  loading = null;
  retryAfter = 0;
}

async function refresh(region: string | null, language: string | null): Promise<void> {
  try {
    const { fetchDiscoveries, discoveryLabel } = await import('./client');
    const snapshot = await fetchDiscoveries({
      ...(region ? { region } : {}),
      ...(language ? { language } : {}),
      intent: 'trending-songs',
      // Never `wait`: this path must not hold a song transition.
    });
    if (!snapshot) {
      retryAfter = Date.now() + RETRY_MS;
      return;
    }
    signal = {
      items: snapshot.items,
      label: new Map(snapshot.items.map((d) => [d.catalogId, discoveryLabel(d)])),
      evidenceAt: snapshot.evidenceAt,
      stale: snapshot.stale,
      state: snapshot.state,
      at: Date.now(),
      region,
      language,
    };
    // A `cold` answer means the server has started warming: come back sooner.
    retryAfter = snapshot.state === 'cold' ? Date.now() + 30_000 : 0;
  } catch {
    retryAfter = Date.now() + RETRY_MS;
  } finally {
    loading = null;
  }
}

/**
 * The signal as it stands. NEVER waits. A snapshot for another region or
 * language is not an answer for this one (the same bug 9.0 shipped in the
 * trends signal, which compared the region and ignored the language).
 */
export function discoverySignalNow(ctx: Pick<RecommendationContext, 'region' | 'pinnedLanguages'>): DiscoverySignal {
  const region = ctx.region?.country ?? null;
  const language = ctx.pinnedLanguages[0] ?? null;
  const stale = Date.now() - signal.at > FRESH_MS || signal.region !== region || signal.language !== language;
  if (stale && !loading && Date.now() >= retryAfter) {
    loading = refresh(region, language);
  }
  return signal.region === region && signal.language === language ? signal : EMPTY;
}
