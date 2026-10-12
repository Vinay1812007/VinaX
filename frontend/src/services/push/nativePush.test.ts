import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.fn();
vi.mock('@/services/analytics/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
vi.mock('@/services/native', () => ({ isNativePlatform: () => true }));

import { uploadFcmToken } from './nativePush';

const noPause = async () => undefined;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => reportError.mockReset());

describe('11.7.1 uploadFcmToken', () => {
  it('retries a failed upload and succeeds without reporting', async () => {
    const responses = [new Response('{"ok":false}', { status: 500 }), new Response('{"ok":true}', { status: 200 })];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    expect(await uploadFcmToken('t'.repeat(40), fetchImpl as unknown as typeof fetch, noPause)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await flush();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports when every try fails, instead of failing in silence', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":false}', { status: 503 }));
    expect(await uploadFcmToken('t'.repeat(40), fetchImpl as unknown as typeof fetch, noPause)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await flush();
    expect(reportError).toHaveBeenCalledWith('push-native', 'fcm-register 503');
  });

  it('does not retry a token the server refused as malformed', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad_request"}', { status: 400 }));
    expect(await uploadFcmToken('short', fetchImpl as unknown as typeof fetch, noPause)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
