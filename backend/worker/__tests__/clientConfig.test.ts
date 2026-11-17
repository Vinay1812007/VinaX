import { describe, expect, it } from 'vitest';
import { publicClientConfig, maintenanceActive, TRENDS_CONNECTED } from '../functions/_lib/clientConfig';

describe('client config bundle', () => {
  it('sanitises and windows every field', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    const cfg = publicClientConfig({
      greeting: { text: '  Welcome to the festival week  ', start: '2026-09-01', end: '2026-09-30', junk: 1 },
      broadcast: { id: 'b1', text: 'New: Listen Later', link: '/later' },
      'search-synonyms': { ' ARR ': 'A. R. Rahman', bad: '', same: 'same' },
      'catalog-sources': { 'vinax-render': false, 'local-catalog': true, 'Bad Key': false },
      'language-order': ['telugu', 'hindi', 'not valid!'],
      'support-faq': [{ q: 'How?', a: 'Like this.' }, { q: 'Empty' }],
      'min-version': { build: 42 },
    }, now);
    expect(cfg.greeting).toEqual({ text: 'Welcome to the festival week' });
    expect(cfg.broadcast).toEqual({ id: 'b1', text: 'New: Listen Later', link: '/later' });
    expect(cfg.synonyms).toEqual({ arr: 'A. R. Rahman' });
    expect(cfg.disabledSources).toEqual(['vinax-render']);
    expect(cfg.languageOrder).toEqual(['telugu', 'hindi']);
    expect(cfg.faq).toEqual([{ q: 'How?', a: 'Like this.' }]);
    expect(cfg.minBuild).toBe(42);
  });
  it('hides a greeting/broadcast outside its window and rejects external links', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    const cfg = publicClientConfig({ greeting: { text: 'x', end: '2026-09-30' }, broadcast: { id: 'b', text: 'y', link: 'https://evil.example' } }, now);
    expect(cfg.greeting).toBeNull();
    expect(cfg.broadcast).toEqual({ id: 'b', text: 'y' });
  });
  it('says nothing about trends while no trend source is connected, and drops an old rec-config row', () => {
    expect(TRENDS_CONNECTED).toBe(false);
    const cfg = publicClientConfig({ 'rec-config': { version: 3, overrides: { mood: 0.2 }, rollout: { mode: 'all' } } });
    expect('trendsConnected' in cfg).toBe(false);
    expect('recConfig' in cfg).toBe(false);
  });
  it('returns a safe empty bundle for garbage', () => {
    const cfg = publicClientConfig({ greeting: 'nope', 'support-faq': 'nope', 'min-version': { build: -1 } });
    expect(cfg).toEqual({ greeting: null, broadcast: null, synonyms: {}, disabledSources: [], sourceOrder: [], languageOrder: [], hiddenLanguages: [], faq: [], minBuild: null });
  });
  it('version 11 — ships pinned searches with clean words and songs, only when there are any', () => {
    const cfg = publicClientConfig({
      'search-pins': {
        '  Kesariya   REMIX ': { id: 'abc123', title: ' Kesariya ', artist: 'Arijit Singh', image: 'https://c.saavncdn.com/x.jpg', junk: 1 },
        insecure: { id: 'def456', title: 'T', image: 'http://x/y.jpg' },
        x: { id: 'ok1', title: 'Too short' },
        __proto__x: { id: 'ok2', title: 'Fine' },
        'no id': { title: 'Nope' },
        'bad id': { id: 'has spaces', title: 'Nope' },
      },
    });
    expect(cfg.searchPins).toEqual({
      'kesariya remix': { id: 'abc123', title: 'Kesariya', artist: 'Arijit Singh', image: 'https://c.saavncdn.com/x.jpg' },
      insecure: { id: 'def456', title: 'T' },
      __proto__x: { id: 'ok2', title: 'Fine' },
    });
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 130; i++) many[`song ${i}`] = { id: `id${i}`, title: `Song ${i}` };
    expect(Object.keys(publicClientConfig({ 'search-pins': many }).searchPins ?? {})).toHaveLength(100);
    expect('searchPins' in publicClientConfig({ 'search-pins': { x: 1 } })).toBe(false);
  });
  it('maintenance window', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    expect(maintenanceActive({ start: '2026-09-08T09:00:00Z', end: '2026-09-08T11:00:00Z', note: 'DB upgrade' }, now)).toEqual({ note: 'DB upgrade' });
    expect(maintenanceActive({ start: '2026-09-08T11:00:00Z', end: '2026-09-08T12:00:00Z' }, now)).toBeNull();
    expect(maintenanceActive({ start: 'x', end: 'y' }, now)).toBeNull();
  });
});

describe('14.0 — banners, flags and site mode', () => {
  it('banners inside their dates with safe fields, at most 10', async () => {
    const { activeBanners, publicSiteMode } = await import('../functions/_lib/clientConfig');
    const now = new Date('2026-10-24T10:00:00Z');
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `B${i}` }));
    expect(activeBanners(many, now)).toHaveLength(10);
    expect(activeBanners([{ title: 'Soon', start: '2026-11-01' }, { title: 'Gone', end: '2026-10-01' }, { title: 'Now', start: '2026-10-01', end: '2026-10-31', linkType: 'bogus', linkId: 'x', img: 'http://insecure/x.png' }], now))
      .toEqual([{ title: 'Now', start: '2026-10-01', end: '2026-10-31' }]);
    expect(activeBanners('nope', now)).toEqual([]);
    expect(publicSiteMode({}, now)).toEqual({ mode: 'live' });
    expect(publicSiteMode({ 'site-mode': { mode: 'maintenance', note: 'x' } }, now)).toEqual({ mode: 'maintenance', note: 'x' });
    expect(publicSiteMode({ 'site-mode': { mode: 'live' }, 'maintenance-window': { start: '2026-10-24T09:00:00Z', end: '2026-10-24T11:00:00Z' } }, now)).toEqual({ mode: 'maintenance' });
  });
});
