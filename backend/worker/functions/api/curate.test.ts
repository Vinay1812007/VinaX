/**
 * Curate contract: the engine's JSON is never passed through. Every task's
 * answer is rebuilt from contract fields only, clipped, and restricted to the
 * ids the client supplied; an answer with nothing valid left is a 502.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();
vi.mock('../_lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/ai')>();
  return { ...actual, chat: (...args: unknown[]) => chatMock(...args), logAiEvent: () => Promise.resolve() };
});

import { onRequestPost, sanitizeCurated } from './curate';

const songs = [{ id: 's1', title: 'Orbit' }, { id: 's2', title: 'Starlight' }, { id: 's3', title: 'Comet' }];
const env = { VINAX_NVD_NEMOTRON_3_5_LIGHTNING_30B_A3B: 'k' };
let ip = 0;
const post = async (body: unknown) => {
  ip += 1;
  const request = new Request('https://x.test/api/curate', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.6.0.${ip}` }, body: JSON.stringify(body) });
  const res = await onRequestPost({ request, env });
  return { status: res.status, json: (await res.json()) as { data?: Record<string, unknown>; error?: string } };
};
const answer = (value: unknown) => ({ content: JSON.stringify(value), model: 'm', keyRole: 'scholar', status: 200, error: null });

beforeEach(() => chatMock.mockReset());

describe('sanitizeCurated', () => {
  it('ranking keeps only supplied ids, once each, in the model order', () => {
    expect(sanitizeCurated('ranking', { ids: ['s3', 'invented', 's1', 's3', 42, null] }, { songs })).toEqual({ ids: ['s3', 's1'] });
    expect(sanitizeCurated('ranking', ['s2'], { songs })).toEqual({ ids: ['s2'] });
    expect(sanitizeCurated('ranking', { ids: ['invented'] }, { songs })).toBeNull();
    expect(sanitizeCurated('ranking', 'nonsense', { songs })).toBeNull();
  });

  it('metadata rebuilds rows from contract fields, clipped and range-checked', () => {
    const out = sanitizeCurated('metadata', { songs: [
      { id: 's1', mood: 'Chill', vibe: ['calm', 7, 'x'.repeat(500)], genre: 'folk', language: 'telugu', energy: 4, tempo: 120, html: '<script>', context: Array.from({ length: 20 }, (_, i) => `c${i}`) },
      { id: 'invented', mood: 'chill' },
      { id: 's1', mood: 'romantic' },
      'junk',
    ] }, { songs }) as { songs: Array<Record<string, unknown>> };
    expect(out.songs).toHaveLength(1);
    const row = out.songs[0];
    expect(row).not.toHaveProperty('html');
    expect(row.mood).toBe('chill');
    expect(row.genre).toEqual(['folk']);
    expect((row.vibe as string[])[1]).toHaveLength(60);
    expect(row.context).toHaveLength(6);
    expect(row.energy).toBeNull(); // out of the 0–1 range
    // 7.2.0 — the request carried no tempo, so the model's 120 is an invented
    // "measurement" and is dropped (this line used to expect 120).
    expect(row.tempo).toBeNull();
    expect(row.dialect).toBeNull();
  });

  describe('metadata provenance (7.2.0)', () => {
    const measuredSongs = [
      { id: 'm1', title: 'Orbit', energy: 0.62, tempo: 118 },
      { id: 'm2', title: 'Starlight' },
      { id: 'm3', title: 'Comet', language: 'telugu', energy: 0.3 },
    ];
    const run = (rows: unknown[]) =>
      (sanitizeCurated('metadata', { songs: rows }, { songs: measuredSongs }) as { songs: Array<Record<string, unknown>> }).songs;

    it('an in-range energy/tempo the request did not carry is null, never accepted', () => {
      const [row] = run([{ id: 'm2', mood: 'chill', energy: 0.8, tempo: 128 }]);
      expect(row.energy).toBeNull();
      expect(row.tempo).toBeNull();
      expect(row.supplied).toEqual([]);
    });

    it('a supplied measurement echoed within rounding survives as the SUPPLIED value', () => {
      const [row] = run([{ id: 'm1', energy: 0.6234, tempo: 118.4 }]);
      expect(row.energy).toBe(0.62);
      expect(row.tempo).toBe(118);
      expect(row.supplied).toEqual(['energy', 'tempo']);
    });

    it('the model may not change a supplied measurement', () => {
      const [row] = run([{ id: 'm1', energy: 0.9, tempo: 140 }]);
      expect(row.energy).toBeNull();
      expect(row.tempo).toBeNull();
      expect(row.supplied).toEqual([]);
    });

    it('a supplied measurement the model left out stays unknown (null), not invented back', () => {
      const [row] = run([{ id: 'm3', mood: 'melancholy' }]);
      expect(row.energy).toBeNull();
      expect(row.tempo).toBeNull();
    });

    it('labels every descriptive field the model filled as inferred, but not an echo of the request', () => {
      const [row] = run([{ id: 'm3', mood: 'Melancholy', vibe: ['wistful'], genre: [], context: ['night'], language: 'Telugu', dialect: 'coastal', energy: 0.3 }]);
      expect(row.inferred).toEqual(['mood', 'vibe', 'context', 'dialect']);
      expect(row.supplied).toEqual(['energy']);
      expect(row.language).toBe('Telugu');
      expect(row.subLanguage).toBeNull();
    });

    it('unknowns are preserved as null / empty, and an all-unknown row infers nothing', () => {
      const [row] = run([{ id: 'm2' }]);
      expect(row).toMatchObject({ mood: null, vibe: [], genre: [], context: [], language: null, dialect: null, subLanguage: null, energy: null, tempo: null, inferred: [], supplied: [] });
    });
  });

  it('home keeps only known shelf keys and markup-free, clipped text', () => {
    const out = sanitizeCurated('home', { title: 'T'.repeat(200), description: 'see https://evil.example', order: ['charts', 'nope', 'quick', 'charts', 3], hidden: ['feed', 'bogus'], extra: 1 }, {});
    expect(out).toEqual({ title: 'T'.repeat(60), description: null, order: ['charts', 'quick'], hidden: ['feed'] });
    expect(sanitizeCurated('home', { title: 'x', order: ['nope'] }, {})).toBeNull();
  });
});

describe('POST /api/curate', () => {
  it('never returns an id the request did not supply', async () => {
    chatMock.mockResolvedValue(answer({ ids: ['s2', 'ghost', 's1'], note: 'passthrough?' }));
    const { status, json } = await post({ task: 'ranking', data: { context: 'evening', songs } });
    expect(status).toBe(200);
    expect(json.data).toEqual({ ids: ['s2', 's1'] });
  });

  it('answers 502 when the model output has nothing valid, and 503 when no engine is configured', async () => {
    chatMock.mockResolvedValue(answer({ ids: ['ghost'] }));
    expect((await post({ task: 'ranking', data: { songs } })).status).toBe(502);
    chatMock.mockResolvedValue({ content: null, model: null, error: 'not_configured' });
    expect((await post({ task: 'ranking', data: { songs } })).status).toBe(503);
  });

  it('the route itself never returns a model-invented energy or tempo', async () => {
    chatMock.mockResolvedValue(answer({ songs: [{ id: 's1', mood: 'chill', energy: 0.7, tempo: 120 }, { id: 's2', energy: 0.5, tempo: 90 }] }));
    const { status, json } = await post({ task: 'metadata', data: { songs: [{ id: 's1', title: 'Orbit' }, { id: 's2', title: 'Starlight', energy: 0.5 }] } });
    expect(status).toBe(200);
    const rows = (json.data as { songs: Array<Record<string, unknown>> }).songs;
    expect(rows[0]).toMatchObject({ id: 's1', energy: null, tempo: null, inferred: ['mood'], supplied: [] });
    expect(rows[1]).toMatchObject({ id: 's2', energy: 0.5, tempo: null, supplied: ['energy'] });
  });

  it('when every engine fails the route answers at once with the failure, not a hang', async () => {
    chatMock.mockResolvedValue({ content: null, model: null, error: 'failed', status: 0 });
    const { status, json } = await post({ task: 'metadata', data: { songs } });
    expect(status).toBe(502);
    expect(json.error).toBe('failed');
    // The route hands chat() a hard deadline so the ladder can never outlive the budget.
    const opts = chatMock.mock.calls[0][2] as { deadlineAt?: number };
    expect(opts.deadlineAt).toBeGreaterThan(Date.now());
    expect(opts.deadlineAt).toBeLessThan(Date.now() + 15_000);
  });
});

describe('lane order (8.0.3)', () => {
  it('a lane that answered in 3 s keeps leading: only failures or blown leashes demote a lane', async () => {
    // Start past the 60 s health window, so earlier tests' observations have expired.
    let offset = 120_000;
    const real = Date.now.bind(Date);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => real() + offset);
    try {
      chatMock.mockImplementation(async () => { offset += 3_000; return { ...answer({ ids: ['s1', 's2'] }), keyRole: 'maestro' }; });
      await post({ task: 'ranking', data: { songs } });
      await post({ task: 'ranking', data: { songs } });
      const lanes = chatMock.mock.calls.map((c) => (c as unknown as [unknown, unknown, { lane: string }])[2].lane);
      expect(lanes).toEqual(['maestro', 'maestro']);
    } finally {
      spy.mockRestore();
    }
  });
});

