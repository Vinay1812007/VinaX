import type { TrendSourceStatus, TrendsSnapshot, VerifiedTrend } from './client';

/**
 * 7.2 — words for verified trends. Every label here says what the data is and
 * where it came from; none claims more than the snapshot carries. Labels come
 * from the server (`sourceLabel`, owner-configurable) — never a platform name
 * written in the app.
 */

/** What the catalogue lists are, said plainly. */
export const CATALOGUE_LIST_TITLE = 'Popular in the catalogue';
export const CATALOGUE_LIST_NOTE = 'Catalogue search results for popular songs — not a live chart.';

export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'at an unknown time';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** One line per source for the status strip: label · region · freshness. Disabled sources say nothing. */
export function sourceLine(s: TrendSourceStatus, now: number = Date.now()): string | null {
  switch (s.status) {
    case 'ok':
      return `${s.label} · ${s.region} · updated ${timeAgo(s.lastSuccessAt, now)}`;
    case 'stale':
      return `${s.label} · ${s.region} · out of date — last updated ${timeAgo(s.lastSuccessAt, now)}`;
    case 'unavailable':
      return `${s.label} · ${s.region} · unavailable right now`;
    default:
      return null;
  }
}

/** The honest state of the verified section as a whole. */
export type VerifiedView =
  | { kind: 'items'; sources: TrendSourceStatus[] }
  | { kind: 'empty'; sources: TrendSourceStatus[] }
  | { kind: 'not_connected' }
  | { kind: 'unavailable' };

export function verifiedView(snapshot: TrendsSnapshot | null): VerifiedView {
  if (!snapshot) return { kind: 'unavailable' };
  const shown = snapshot.sources.filter((s) => s.status === 'ok' || s.status === 'stale' || s.status === 'unavailable');
  if (snapshot.items.length) return { kind: 'items', sources: shown };
  if (!shown.length) return { kind: 'not_connected' };
  if (shown.every((s) => s.status === 'unavailable')) return { kind: 'unavailable' };
  return { kind: 'empty', sources: shown };
}

/** Filter chips: one per source that has items, in the server's order. */
export function sourceChips(snapshot: TrendsSnapshot): Array<{ id: string; label: string; stale: boolean }> {
  const withItems = new Set(snapshot.items.map((i) => i.source));
  return snapshot.sources.filter((s) => withItems.has(s.id)).map((s) => ({ id: s.id, label: s.label, stale: s.status === 'stale' }));
}

/** Rising / new entry markers — only what the observations support. */
export function movementMarker(item: VerifiedTrend): { kind: 'rising' | 'new'; text: string; title: string } | null {
  if (item.sourceKind === 'editorial') return null;
  if (item.momentum && item.momentum.rankDelta > 0) {
    return { kind: 'rising', text: `Rising ▲${item.momentum.rankDelta}`, title: `Up ${item.momentum.rankDelta} places in ${item.momentum.windowHours} h on ${item.sourceLabel}` };
  }
  if (item.newEntry) return { kind: 'new', text: 'New entry', title: `Not on ${item.sourceLabel} at the previous comparable update` };
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1 Oct" in UTC — the expiry of an editorial pick. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : '';
}

/** The provenance line under a verified row. */
export function provenanceLine(item: VerifiedTrend, now: number = Date.now()): string {
  if (item.sourceKind === 'editorial') return `Editorial pick · ${item.region} · until ${shortDate(item.expiresAt)}`;
  return `#${item.sourceRank} on ${item.sourceLabel} · ${item.region} · seen ${timeAgo(item.observedAt, now)}`;
}
