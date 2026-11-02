/**
 * Console rebuild — the console's Home Screen, Features & AI and App Updates pages
 * publish richer values; the public sanitisers pass the new fields and keep
 * older values working.
 */
import { describe, expect, it } from 'vitest';
import { activeBanners, publicBroadcast, publicClientConfig, publicFestival, publicGreeting, publicVersionPolicy } from '../functions/_lib/clientConfig';
import { publicAnnouncement } from '../functions/api/announcements';
import { sanitizeAiSettings } from '../functions/_lib/ai/config';

const NOW = new Date('2026-11-02T06:00:00Z');

describe('greeting', () => {
  it('passes parts of the day and the first-name switch; text is the first filled part', () => {
    expect(publicGreeting({ morning: 'Fresh picks', evening: 'Wind down', withName: true }, NOW)).toEqual({ text: 'Fresh picks', parts: { morning: 'Fresh picks', evening: 'Wind down' }, withName: true });
  });
  it('keeps the old { text } value and honours the switch', () => {
    expect(publicGreeting({ text: 'Hello' }, NOW)).toEqual({ text: 'Hello' });
    expect(publicGreeting({ text: 'Hello', enabled: false }, NOW)).toBeNull();
    expect(publicGreeting({}, NOW)).toBeNull();
  });
});

describe('broadcast', () => {
  it('passes a known style and a non-closable bar, drops odd values', () => {
    expect(publicBroadcast({ id: 'a', text: 'Hi', style: 'urgent', dismissible: false, link: '/charts' }, NOW)).toEqual({ id: 'a', text: 'Hi', link: '/charts', style: 'urgent', dismissible: false });
    expect(publicBroadcast({ id: 'a', text: 'Hi', style: 'shouty', link: '//evil.example' }, NOW)).toEqual({ id: 'a', text: 'Hi' });
    expect(publicBroadcast({ id: 'a', text: 'Hi', enabled: false }, NOW)).toBeNull();
  });
});

describe('min-version', () => {
  it('builds a per-platform policy with a message', () => {
    expect(publicVersionPolicy({ android: { minVersion: '1.8.0', mode: 'force' }, web: { minVersion: '1.7.2' }, ios: { minVersion: 'latest' }, message: 'Please update' }))
      .toEqual({ android: { minVersion: '1.8.0', mode: 'force' }, web: { minVersion: '1.7.2', mode: 'suggest' }, message: 'Please update' });
    expect(publicVersionPolicy({ build: 120 })).toBeUndefined();
  });
  it('ships in the client bundle beside the old minBuild', () => {
    const c = publicClientConfig({ 'min-version': { build: 120, web: { minVersion: '1.8.0', mode: 'suggest' } } }, NOW);
    expect(c.minBuild).toBe(120);
    expect(c.versionPolicy).toEqual({ web: { minVersion: '1.8.0', mode: 'suggest' } });
  });
});

describe('banners', () => {
  it('drops switched-off banners and accepts charts and app-page links', () => {
    const out = activeBanners([
      { title: 'Off', enabled: false },
      { title: 'Charts', linkType: 'charts', linkId: 'x' },
      { title: 'Radio', linkType: 'page', linkId: '/radio' },
      { title: 'Bad page', linkType: 'page', linkId: 'https://evil.example' },
      { title: 'Song', linkType: 'song', linkId: 's1' },
    ], NOW);
    expect(out).toEqual([
      { title: 'Charts', linkType: 'charts' },
      { title: 'Radio', linkType: 'page', linkId: '/radio' },
      { title: 'Bad page' },
      { title: 'Song', linkType: 'song', linkId: 's1' },
    ]);
  });
});

describe('festival', () => {
  it('passes a custom colour for a forced festival only; off switch = no override', () => {
    expect(publicFestival({ mode: 'force', id: 'diwali', color: '#FF8800' }, NOW)).toEqual({ mode: 'force', id: 'diwali', color: '#ff8800' });
    expect(publicFestival({ mode: 'off', color: '#ff8800' }, NOW)).toEqual({ mode: 'off' });
    expect(publicFestival({ mode: 'force', id: 'diwali', enabled: false }, NOW)).toBeNull();
  });
});

describe('announcement pop-up', () => {
  const base = { title: 'New', body: 'Hello', link: '/charts', ts: 1 };
  it('keeps a push-sender announcement as before (no pop-up fields)', () => {
    expect(publicAnnouncement(base, NOW.getTime())).toEqual(base);
  });
  it('passes the pop-up rules and respects dates and the switch', () => {
    expect(publicAnnouncement({ ...base, popup: true, button: 'Listen', show: 'daily', platforms: ['web', 'tv'] }, NOW.getTime()))
      .toEqual({ ...base, popup: true, button: 'Listen', show: 'daily', platforms: ['web'] });
    expect(publicAnnouncement({ ...base, popup: true }, NOW.getTime())?.platforms).toEqual(['android', 'web', 'ios']);
    expect(publicAnnouncement({ ...base, enabled: false }, NOW.getTime())).toBeNull();
    expect(publicAnnouncement({ ...base, end: '2026-11-01T00:00:00Z' }, NOW.getTime())).toBeNull();
    expect(publicAnnouncement({ ...base, start: '2026-11-03T00:00:00Z' }, NOW.getTime())).toBeNull();
  });
});

describe('VinaX AI daily limit', () => {
  it('reads a whole positive number, else no limit', () => {
    expect(sanitizeAiSettings({ dailyLimit: 25 }).dailyLimit).toBe(25);
    expect(sanitizeAiSettings({ dailyLimit: 0 }).dailyLimit).toBeNull();
    expect(sanitizeAiSettings({}).dailyLimit).toBeNull();
  });
});
