import { describe, expect, it } from 'vitest';
import { extractRecommendedFromThread } from './threadMemory';

const asst = (content: string) => ({ role: 'assistant' as const, content });
const user = (content: string) => ({ role: 'user' as const, content });

describe('extractRecommendedFromThread (B5)', () => {
  it('collects "Title — Artist" lines from assistant turns only', () => {
    const out = extractRecommendedFromThread([
      user('suggest some telugu melodies — the slow kind'),
      asst('Here are a few:\n1. Samajavaragamana — Sid Sriram\n2. **Butta Bomma** — Armaan Malik\nEnjoy!'),
    ]);
    expect(out).toEqual(['Samajavaragamana — Sid Sriram', 'Butta Bomma — Armaan Malik']);
  });

  it('accepts bullets, en-dash and hyphen separators, and strips quotes', () => {
    const out = extractRecommendedFromThread([
      asst('- "Kesariya" – Arijit Singh\n• Naatu Naatu - Rahul Sipligunj'),
    ]);
    expect(out).toEqual(['Kesariya — Arijit Singh', 'Naatu Naatu — Rahul Sipligunj']);
  });

  it('dedupes across turns case-insensitively and keeps the most recent when capped', () => {
    const msgs = [
      asst('Vaathi Coming — Anirudh'),
      asst('vaathi coming — anirudh\nHukum — Anirudh'),
      asst(Array.from({ length: 15 }, (_, i) => `Song ${i} — Artist ${i}`).join('\n')),
    ];
    const out = extractRecommendedFromThread(msgs, 12);
    expect(out).toHaveLength(12);
    expect(out).not.toContain('Vaathi Coming — Anirudh'); // oldest dropped by the cap
    expect(out[out.length - 1]).toBe('Song 14 — Artist 14');
  });

  it('ignores prose sentences and empty threads', () => {
    expect(
      extractRecommendedFromThread([
        asst('That song came out in 2019. It was A. R. Rahman’s idea — he said so himself in an interview about the film.'),
      ]),
    ).toEqual([]);
    expect(extractRecommendedFromThread([])).toEqual([]);
  });
});
