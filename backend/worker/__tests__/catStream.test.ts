/**
 * 1.16 — /api/cat/stream's redirect carries Access-Control-Allow-Origin, so a
 * web save (a CORS fetch in services/downloads/web.ts) can follow it to the
 * CDN, which answers `*` itself. The audio still never passes through us.
 */
import { describe, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/cat/[[path]]';

// Real encrypted_media_url (public catalog data; see _lib/des.test.ts).
const SAMPLE_ENC =
  'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyhG7Q4EE4gXPUMxXBqCfbGqS2zdigiLU7KoeGK03QQiciQQvruZRn0hw7tS9a8Gtq';

describe('/api/cat/stream', () => {
  it('302s to the CDN at the asked bitrate, readable by a CORS fetch', async () => {
    const res = await onRequestGet({
      request: new Request(`https://www.vinaxmusic.online/api/cat/stream?e=${encodeURIComponent(SAMPLE_ENC)}&q=160`),
      params: { path: ['stream'] },
      env: {},
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://aac.saavncdn.com/177/7f1d8dfacf14f782e07dd0597699f941_160.mp4');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.body).toBeNull();
  });
});
