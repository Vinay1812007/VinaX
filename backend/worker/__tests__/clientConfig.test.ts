import { describe, expect, it } from 'vitest';
import { publicClientConfig, maintenanceActive, houseRules, CLIENT_KEYS } from '../functions/_lib/clientConfig';
import { ALLOWED_KEYS } from '../functions/api/admin/appconfig';
import { buildQuery, QUERYABLE } from '../functions/api/admin/query';
import { funnel } from '../functions/api/admin/funnel';
import { skipTable } from '../functions/api/admin/skips';
import { usageFromRows } from '../functions/api/admin/usage';
import { summarise } from '../functions/api/admin/songstats';

describe('client config bundle', () => {
  it('every client key is publishable from the console', () => {
    for (const k of CLIENT_KEYS) expect(ALLOWED_KEYS.has(k), k).toBe(true);
    expect(ALLOWED_KEYS.has('ai-rules')).toBe(true);
  });
  it('sanitises and windows every field', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    const cfg = publicClientConfig({
      greeting: { text: '  Welcome to the festival week  ', start: '2026-09-01', end: '2026-09-30', junk: 1 },
      broadcast: { id: 'b1', text: 'New: Listen Later', link: '/later' },
      'search-synonyms': { ' ARR ': 'A. R. Rahman', bad: '', same: 'same' },
      'catalog-sources': { 'vinax-render': false, 'local-catalog': true, 'Bad Key': false },
      'language-order': ['telugu', 'hindi', 'not valid!'],
      'ai-starters': ['Suggest 5 {lang} songs', '', 42],
      'ai-quick': [{ icon: 'S', label: 'Songs', prompt: 'Suggest songs for ', mode: 'muse' }, { label: '', prompt: 'x' }],
      'support-faq': [{ q: 'How?', a: 'Like this.' }, { q: 'Empty' }],
      'min-version': { build: 42 },
    }, now);
    expect(cfg.greeting).toEqual({ text: 'Welcome to the festival week' });
    expect(cfg.broadcast).toEqual({ id: 'b1', text: 'New: Listen Later', link: '/later' });
    expect(cfg.synonyms).toEqual({ arr: 'A. R. Rahman' });
    expect(cfg.disabledSources).toEqual(['vinax-render']);
    expect(cfg.languageOrder).toEqual(['telugu', 'hindi']);
    expect(cfg.aiStarters).toEqual(['Suggest 5 {lang} songs']);
    expect(cfg.aiQuick).toEqual([{ icon: 'S', label: 'Songs', prompt: 'Suggest songs for ', mode: 'muse' }]);
    expect(cfg.faq).toEqual([{ q: 'How?', a: 'Like this.' }]);
    expect(cfg.minBuild).toBe(42);
  });
  it('hides a greeting/broadcast outside its window and rejects external links', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    const cfg = publicClientConfig({ greeting: { text: 'x', end: '2026-09-30' }, broadcast: { id: 'b', text: 'y', link: 'https://evil.example' } }, now);
    expect(cfg.greeting).toBeNull();
    expect(cfg.broadcast).toEqual({ id: 'b', text: 'y' });
  });
  it('returns a safe empty bundle for garbage', () => {
    const cfg = publicClientConfig({ greeting: 'nope', 'ai-quick': 'nope', 'min-version': { build: -1 } });
    expect(cfg).toEqual({ greeting: null, broadcast: null, synonyms: {}, disabledSources: [], languageOrder: [], aiStarters: [], aiQuick: [], faq: [], minBuild: null });
  });
  it('maintenance window + house rules', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    expect(maintenanceActive({ start: '2026-09-08T09:00:00Z', end: '2026-09-08T11:00:00Z', note: 'DB upgrade' }, now)).toEqual({ note: 'DB upgrade' });
    expect(maintenanceActive({ start: '2026-09-08T11:00:00Z', end: '2026-09-08T12:00:00Z' }, now)).toBeNull();
    expect(maintenanceActive({ start: 'x', end: 'y' }, now)).toBeNull();
    expect(houseRules('  Be brief. ')).toBe('Be brief.');
    expect(houseRules(5)).toBe('');
  });
});

describe('query console', () => {
  it('rejects unknown tables/columns and unsafe values', () => {
    expect(buildQuery(new URLSearchParams('table=vinax_push_subscriptions'))).toEqual({ error: 'unknown_table' });
    expect(buildQuery(new URLSearchParams('table=vinax_events&col=device_id&val=x'))).toEqual({ error: 'unknown_column' });
    expect(buildQuery(new URLSearchParams('table=vinax_events&col=type&val=play;drop'))).toEqual({ error: 'bad_value' });
  });
  it('builds a bounded, ordered, column-limited query', () => {
    const q = buildQuery(new URLSearchParams('table=vinax_events&hours=99999&limit=9999&col=type&val=play'));
    expect('error' in q).toBe(false);
    if ('error' in q) return;
    expect(q.limit).toBe(500);
    expect(q.query).toContain('select=' + QUERYABLE.vinax_events.columns.join(','));
    expect(q.query).toContain('order=created_at.desc');
    expect(q.query).toContain('type=eq.play');
    expect(q.query).not.toContain('device_id');
  });
});

describe('analytics reducers', () => {
  it('funnel counts distinct devices per step', () => {
    const steps = funnel([
      { type: 'open', device_id: 'a' }, { type: 'play', device_id: 'a' }, { type: 'play', device_id: 'a' },
      { type: 'open', device_id: 'b' }, { type: 'complete', device_id: 'a' }, { type: 'favorite', device_id: 'a' },
    ]);
    const by = Object.fromEntries(steps.map((s) => [s.id, s]));
    expect(by.open.devices).toBe(2);
    expect(by.play.devices).toBe(1);
    expect(by.play.pct).toBe(50);
    expect(by.favorite.devices).toBe(1);
    expect(by.share.devices).toBe(0);
  });
  it('skip table ranks by rate among songs with enough plays', () => {
    const row = (type: string, id: string) => ({ type, song_id: id, song_title: id.toUpperCase(), song_artist: 'x', song_image: '' });
    const rows = [
      ...Array.from({ length: 10 }, () => row('play', 'a')),
      ...Array.from({ length: 6 }, () => row('skip', 'a')),
      row('play', 'b'), row('play', 'b'), row('skip', 'b'),
    ];
    const t = skipTable(rows, 5);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: 'a', plays: 10, skips: 6, rate: 60 });
  });
  it('usage heatmap buckets plays into IST weekday x hour', () => {
    const u = usageFromRows([
      { type: 'play', platform: 'web', device_id: 'a', created_at: '2026-09-08T18:30:00Z' }, // Wed 00:00 IST
      { type: 'search', platform: 'android', device_id: 'a', created_at: '2026-09-08T18:30:00Z' },
    ]);
    expect(u.heatmap[3][0]).toBe(1);
    expect(u.peak).toEqual({ day: 3, hour: 0, n: 1 });
    expect(u.byType[0]).toEqual({ type: 'play', n: 1, devices: 1 });
    expect(u.byPlatform.map((p) => p.platform).sort()).toEqual(['android', 'web']);
  });
  it('song summary computes totals, days and skip rate', () => {
    const r = (type: string, day: string, country = 'IN') => ({ type, song_id: 's', song_title: 'S', song_artist: 'A', song_image: '', device_id: 'd' + day, country, platform: 'web', created_at: `${day}T10:00:00Z` });
    const s = summarise([r('play', '2026-09-01'), r('play', '2026-09-02'), r('skip', '2026-09-02'), r('complete', '2026-09-01'), r('favorite', '2026-09-01', 'US')]);
    expect(s.totals).toEqual({ plays: 2, skips: 1, completes: 1, favorites: 1, listeners: 2 });
    expect(s.byDay).toEqual([{ day: '2026-09-01', plays: 1, skips: 0 }, { day: '2026-09-02', plays: 1, skips: 1 }]);
    expect(s.skipRate).toBe(50);
    expect(s.countries).toEqual([{ country: 'IN', n: 2 }]);
  });
});
