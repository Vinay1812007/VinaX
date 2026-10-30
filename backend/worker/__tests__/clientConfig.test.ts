import { describe, expect, it } from 'vitest';
import { publicClientConfig, maintenanceActive } from '../functions/_lib/clientConfig';

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
  it('returns a safe empty bundle for garbage', () => {
    const cfg = publicClientConfig({ greeting: 'nope', 'support-faq': 'nope', 'min-version': { build: -1 } });
    expect(cfg).toEqual({ greeting: null, broadcast: null, synonyms: {}, disabledSources: [], languageOrder: [], faq: [], minBuild: null });
  });
  it('maintenance window', () => {
    const now = new Date('2026-09-08T10:00:00Z');
    expect(maintenanceActive({ start: '2026-09-08T09:00:00Z', end: '2026-09-08T11:00:00Z', note: 'DB upgrade' }, now)).toEqual({ note: 'DB upgrade' });
    expect(maintenanceActive({ start: '2026-09-08T11:00:00Z', end: '2026-09-08T12:00:00Z' }, now)).toBeNull();
    expect(maintenanceActive({ start: 'x', end: 'y' }, now)).toBeNull();
  });
});

describe('14.0 — banners, festival, flags and site mode', () => {
  it('banners inside their dates with safe fields, at most 10', async () => {
    const { activeBanners, publicFestival, publicSiteMode } = await import('../functions/_lib/clientConfig');
    const now = new Date('2026-10-24T10:00:00Z');
    const many = Array.from({ length: 14 }, (_, i) => ({ title: `B${i}` }));
    expect(activeBanners(many, now)).toHaveLength(10);
    expect(activeBanners([{ title: 'Soon', start: '2026-11-01' }, { title: 'Gone', end: '2026-10-01' }, { title: 'Now', start: '2026-10-01', end: '2026-10-31', linkType: 'bogus', linkId: 'x', img: 'http://insecure/x.png' }], now))
      .toEqual([{ title: 'Now', start: '2026-10-01', end: '2026-10-31' }]);
    expect(activeBanners('nope', now)).toEqual([]);
    expect(publicFestival({ mode: 'force', id: 'Diwali' })).toEqual({ mode: 'force', id: 'diwali' });
    expect(publicFestival({ mode: 'force' })).toBeNull();
    expect(publicFestival({ mode: 'off' })).toEqual({ mode: 'off' });
    expect(publicFestival({ mode: 'party' })).toBeNull();
    expect(publicSiteMode({}, now)).toEqual({ mode: 'live' });
    expect(publicSiteMode({ 'site-mode': { mode: 'maintenance', note: 'x' } }, now)).toEqual({ mode: 'maintenance', note: 'x' });
    expect(publicSiteMode({ 'site-mode': { mode: 'live' }, 'maintenance-window': { start: '2026-10-24T09:00:00Z', end: '2026-10-24T11:00:00Z' } }, now)).toEqual({ mode: 'maintenance' });
  });
});
