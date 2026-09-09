/**
 * Co-work rounds (v5.24.0). A panel of engines is only worth its tokens if
 * the panellists are actually DIFFERENT engines. The failure this guards is
 * subtle and expensive: chat() normally walks the shared failover ladder, so
 * three lanes whose own engines are cold all degrade onto the same healthy
 * sibling and return three near-identical pools — one engine, billed three
 * times, presented as a panel.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { gatherDetailed } from '../functions/_lib/ai';

afterEach(() => vi.unstubAllGlobals());

/** Answer only for the listed keys; every other key hangs up. */
function stubKeys(live: Record<string, string>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const auth = String((init?.headers as Record<string, string>)?.authorization ?? '');
    const key = auth.replace('Bearer ', '');
    const model = live[key];
    if (!model) return Promise.reject(new Error('unreachable'));
    return Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: `from ${model}` } }] }), { status: 200 }),
    );
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return fetchMock;
}

const ENV = {
  VINAX_OAI_GPT_OSS_20B: 'k-fast',
  VINAX_NVD_NEMOTRON_3_NANO_OMNI_30B_A3B_REASONING: 'k-search',
  VINAX_GROQ_API_KEY: 'k-scholar',
};
const MSG = [{ role: 'user' as const, content: 'propose' }];

describe('gatherDetailed', () => {
  it('reports which lane produced each contribution', async () => {
    stubKeys({ 'k-fast': 'fast-engine', 'k-search': 'search-engine', 'k-scholar': 'scholar-engine' });
    const out = await gatherDetailed(ENV, MSG, ['fast', 'search', 'scholar'], { soloLadder: true });
    expect(out.map((r) => r.lane).sort()).toEqual(['fast', 'scholar', 'search']);
    for (const r of out) {
      expect(r.content).toContain('from ');
      expect(r.model).toBeTruthy();
      expect(r.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('soloLadder: a dead panellist ABSTAINS instead of echoing a healthy sibling', async () => {
    // Only the fast key answers. Without soloLadder the other two lanes would
    // ladder onto it and hand back the same content three times.
    stubKeys({ 'k-fast': 'fast-engine' });
    const out = await gatherDetailed(ENV, MSG, ['fast', 'search', 'scholar'], { soloLadder: true });
    expect(out).toHaveLength(1);
    expect(out[0].lane).toBe('fast');
  });

  it('without soloLadder the same round collapses onto one engine — the bug this guards', async () => {
    stubKeys({ 'k-fast': 'fast-engine' });
    const out = await gatherDetailed(ENV, MSG, ['fast', 'search', 'scholar']);
    // All three "participants" answered, but every one of them is the SAME
    // engine wearing a different lane label.
    expect(out).toHaveLength(3);
    expect(new Set(out.map((r) => r.content)).size).toBe(1);
  });

  it('drops empty answers so an engine that said nothing is not credited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))),
    );
    expect(await gatherDetailed(ENV, MSG, ['fast', 'search'], { soloLadder: true })).toEqual([]);
  });

  it('one slow panellist does not serialise the round', async () => {
    stubKeys({ 'k-fast': 'a', 'k-search': 'b', 'k-scholar': 'c' });
    const started = Date.now();
    const out = await gatherDetailed(ENV, MSG, ['fast', 'search', 'scholar'], { soloLadder: true });
    expect(out).toHaveLength(3);
    // Parallel, so the round is bounded by the slowest lane, never the sum.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
