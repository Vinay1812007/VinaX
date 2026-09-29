/**
 * Words for verified trends: each state of the section says what it is, and
 * movement markers appear only when the snapshot carries them.
 */
import { describe, expect, it } from 'vitest';
import type { TrendSourceStatus, TrendsSnapshot, VerifiedTrend } from './client';
import { movementMarker, provenanceLine, shortDate, sourceChips, sourceLine, timeAgo, verifiedView } from './present';

const NOW = Date.parse('2026-09-19T12:00:00Z');
const src = (over: Partial<TrendSourceStatus>): TrendSourceStatus => ({ id: 'youtube', label: 'Public video chart', kind: 'public-chart', status: 'ok', lastSuccessAt: '2026-09-19T10:00:00Z', region: 'IN', ...over });
const item = (over: Partial<VerifiedTrend> = {}): VerifiedTrend => ({
  catalogId: 'c1',
  title: 'T',
  artist: 'A',
  language: 'telugu',
  region: 'IN',
  source: 'youtube',
  sourceLabel: 'Public video chart',
  sourceKind: 'public-chart',
  sourceRank: 3,
  sourceUrl: null,
  observedAt: '2026-09-19T10:00:00Z',
  expiresAt: '2026-10-01T00:00:00Z',
  mappingConfidence: 0.9,
  momentum: null,
  newEntry: false,
  ...over,
});
const snap = (sources: TrendSourceStatus[], items: VerifiedTrend[]): TrendsSnapshot => ({ generatedAt: '2026-09-19T12:00:00Z', sources, items });

describe('verifiedView', () => {
  it('null is unavailable; nothing connected is not_connected; connected with no items is empty', () => {
    expect(verifiedView(null)).toEqual({ kind: 'unavailable' });
    expect(verifiedView(snap([src({ status: 'not_configured' }), src({ id: 'instagram', status: 'disabled' })], [])).kind).toBe('not_connected');
    expect(verifiedView(snap([src({ status: 'unavailable' })], [])).kind).toBe('unavailable');
    expect(verifiedView(snap([src({})], [])).kind).toBe('empty');
    expect(verifiedView(snap([src({})], [item()])).kind).toBe('items');
  });
});

describe('source lines and chips', () => {
  it('say when a source was updated, when it is out of date, and nothing for switched-off sources', () => {
    expect(sourceLine(src({}), NOW)).toBe('Public video chart · IN · updated 2 h ago');
    expect(sourceLine(src({ status: 'stale', lastSuccessAt: '2026-09-18T12:00:00Z' }), NOW)).toBe('Public video chart · IN · out of date — last updated 24 h ago');
    expect(sourceLine(src({ status: 'unavailable', lastSuccessAt: null }), NOW)).toBe('Public video chart · IN · unavailable right now');
    expect(sourceLine(src({ status: 'disabled' }), NOW)).toBeNull();
    expect(sourceLine(src({ status: 'not_configured' }), NOW)).toBeNull();
  });

  it('offer a filter only for sources that have items', () => {
    const s = snap([src({}), src({ id: 'editorial', label: 'Editor’s picks', kind: 'editorial', status: 'stale' })], [item({ source: 'editorial' })]);
    expect(sourceChips(s)).toEqual([{ id: 'editorial', label: 'Editor’s picks', stale: true }]);
  });

  it('format relative times', () => {
    expect(timeAgo(null, NOW)).toBe('never');
    expect(timeAgo('2026-09-19T11:59:30Z', NOW)).toBe('just now');
    expect(timeAgo('2026-09-19T11:30:00Z', NOW)).toBe('30 min ago');
    expect(timeAgo('2026-09-15T12:00:00Z', NOW)).toBe('4 days ago');
    expect(shortDate('2026-10-01T00:00:00Z')).toBe('1 Oct');
  });
});

describe('movementMarker', () => {
  it('rises only with a positive rank change and marks new entries only when flagged', () => {
    expect(movementMarker(item())).toBeNull();
    expect(movementMarker(item({ momentum: { rankDelta: 0, windowHours: 12 } }))).toBeNull();
    expect(movementMarker(item({ momentum: { rankDelta: -3, windowHours: 12 } }))).toBeNull();
    expect(movementMarker(item({ momentum: { rankDelta: 5, windowHours: 12 } }))).toMatchObject({ kind: 'rising', text: 'Rising ▲5' });
    expect(movementMarker(item({ newEntry: true }))).toMatchObject({ kind: 'new', text: 'New entry' });
  });

  it('never marks editorial picks', () => {
    expect(movementMarker(item({ sourceKind: 'editorial', newEntry: true, momentum: { rankDelta: 3, windowHours: 12 } }))).toBeNull();
  });
});

describe('provenanceLine', () => {
  it('names the source, rank, region and observation time — or says editorial pick', () => {
    expect(provenanceLine(item(), NOW)).toBe('#3 on Public video chart · IN · seen 2 h ago');
    expect(provenanceLine(item({ sourceKind: 'editorial', sourceLabel: 'Editor’s picks' }), NOW)).toBe('Editorial pick · IN · until 1 Oct');
  });
});
