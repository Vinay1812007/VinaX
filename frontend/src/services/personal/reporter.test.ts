// @vitest-environment jsdom
/**
 * The personal engine's reporter: nothing leaves the device unless signed in
 * with the engine on; events queue with ids, song facts and the local clock;
 * a flush sends one batch and keeps what failed; a shelf source is attached
 * to the next event for that song; the queue clears when the engine goes off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/constants/storage-keys';
import { makeSong } from '@/__fixtures__/songs';
import { emitTasteEvent } from '@/services/personalization/tasteEvents';
import { getLocal, setLocal } from '@/services/storage/local';
import { useSettingsStore } from '@/store/settingsStore';
import { _resetReporterForTests, clearQueue, enqueue, flush, installPersonalReporter, markPersonalSource, queuedCount } from './reporter';

const signIn = () => setLocal(KEYS.account, { session: 'vx1.p.s', user: { name: 'Asha', email: 'a@x', picture: null, username: null } });
const ok = (body: unknown = { accepted: 1, duplicates: 0, version: 2 }) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the personal reporter', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetReporterForTests();
    useSettingsStore.setState({ personalEngine: true, kidMode: false, discoveryMode: 'balanced' });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('queues nothing while signed out, in Kid mode, or with the engine off', () => {
    enqueue({ kind: 'play', song: makeSong('s1'), at: Date.now() });
    expect(queuedCount()).toBe(0);
    signIn();
    useSettingsStore.setState({ kidMode: true });
    enqueue({ kind: 'play', song: makeSong('s1'), at: Date.now() });
    expect(queuedCount()).toBe(0);
    useSettingsStore.setState({ kidMode: false, personalEngine: false });
    enqueue({ kind: 'play', song: makeSong('s1'), at: Date.now() });
    expect(queuedCount()).toBe(0);
  });

  it('queues an event with an id, the song facts and the local clock, and keeps it across a reload', () => {
    signIn();
    vi.setSystemTime(new Date(2026, 9, 31, 21, 30));
    const at = Date.now();
    markPersonalSource('s1', 'home:made-for-you', 'made-for-you', 3);
    enqueue({ kind: 'complete', song: makeSong('s1', { artist: 'Sid Sriram', album: { id: 'al1', name: 'Album' } }), heardSec: 190.4, at });
    enqueue({ kind: 'like', song: makeSong('s2'), at });
    expect(queuedCount()).toBe(2);
    const file = getLocal<{ events: Array<Record<string, unknown>>; songs: Record<string, Record<string, unknown>> }>(KEYS.personalQueue, { events: [], songs: {} });
    expect(file.events[0]).toMatchObject({ kind: 'complete', songId: 's1', heardSec: 190, durationSec: 210, source: 'home:made-for-you', context: { hour: 21, dow: 6, shelf: 'made-for-you', position: 3 } });
    expect(typeof file.events[0].id).toBe('string');
    expect(file.events[1].source).toBeUndefined();
    expect(file.songs.s1).toMatchObject({ id: 's1', title: 'Song s1', artist: 'Sid Sriram', language: 'telugu', year: 2022, album: 'Album', albumId: 'al1' });
    _resetReporterForTests();
    expect(queuedCount()).toBe(2);
  });

  it('flushes one batch with the songs it names and the discovery mode, and empties the queue', async () => {
    signIn();
    useSettingsStore.setState({ discoveryMode: 'discover' });
    enqueue({ kind: 'play', song: makeSong('s1'), at: Date.now() });
    enqueue({ kind: 'skip', song: makeSong('s2'), heardSec: 4, at: Date.now() });
    const f = vi.fn(async () => ok({ accepted: 2, duplicates: 0, version: 3 }));
    await flush({ fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/personal/events');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer vx1.p.s');
    const body = JSON.parse(String(init.body)) as { events: unknown[]; songs: Array<{ id: string }>; mode: string };
    expect(body.events).toHaveLength(2);
    expect(body.songs.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(body.mode).toBe('discover');
    expect(queuedCount()).toBe(0);
  });

  it('keeps the queue when the server fails, and sends it on the next flush', async () => {
    signIn();
    enqueue({ kind: 'play', song: makeSong('s1'), at: Date.now() });
    const down = vi.fn(async () => new Response('{"error":"unavailable"}', { status: 503 }));
    await flush({ fetchImpl: down as unknown as typeof fetch });
    expect(queuedCount()).toBe(1);
    const up = vi.fn(async () => ok());
    await flush({ fetchImpl: up as unknown as typeof fetch });
    expect(queuedCount()).toBe(0);
  });

  it('a signed-out answer clears the queue; a 413 halves the batch; another 4xx drops the batch; a 429 keeps it', async () => {
    signIn();
    const fetchWith = (status: number) => vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status })) as unknown as typeof fetch;
    for (let i = 0; i < 12; i += 1) enqueue({ kind: 'play', song: makeSong(`s${i}`), at: Date.now() });
    await flush({ fetchImpl: fetchWith(429) });
    expect(queuedCount()).toBe(12);
    await flush({ fetchImpl: fetchWith(413) });
    expect(queuedCount()).toBe(12);
    const f = vi.fn(async () => ok()) as unknown as typeof fetch;
    await flush({ fetchImpl: f });
    const sent = JSON.parse(String((vi.mocked(f).mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { events: unknown[] };
    expect(sent.events).toHaveLength(12);
    for (let i = 0; i < 3; i += 1) enqueue({ kind: 'play', song: makeSong(`t${i}`), at: Date.now() });
    await flush({ fetchImpl: fetchWith(400) });
    expect(queuedCount()).toBe(0);
    enqueue({ kind: 'play', song: makeSong('u1'), at: Date.now() });
    await flush({ fetchImpl: fetchWith(401) });
    expect(queuedCount()).toBe(0);
  });

  it('drops events older than a week', async () => {
    signIn();
    enqueue({ kind: 'play', song: makeSong('old'), at: Date.now() - 8 * 86_400_000 });
    enqueue({ kind: 'play', song: makeSong('new'), at: Date.now() });
    const f = vi.fn(async () => ok());
    await flush({ fetchImpl: f as unknown as typeof fetch });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { events: Array<{ songId: string }> };
    expect(body.events.map((e) => e.songId)).toEqual(['new']);
  });

  it('follows the taste events once installed, and clears the queue when the engine is switched off', () => {
    signIn();
    const off = installPersonalReporter();
    emitTasteEvent({ kind: 'play', song: makeSong('s1') });
    emitTasteEvent({ kind: 'save', song: makeSong('s2') });
    expect(queuedCount()).toBe(2);
    useSettingsStore.setState({ personalEngine: false });
    expect(queuedCount()).toBe(0);
    off();
    useSettingsStore.setState({ personalEngine: true });
    emitTasteEvent({ kind: 'play', song: makeSong('s3') });
    expect(queuedCount()).toBe(0);
    clearQueue();
  });
});
