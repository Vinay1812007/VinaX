import type { DiscoveryMode, QueueLanguages } from '@/store/settingsStore';

/**
 * 9.0 — the words Settings uses for the recommendation choices, kept in one
 * place so they can be checked against what the engine actually does.
 *
 * Discovery: each mode is one plain sentence about what CHANGES — the share
 * of a queue that may go to artists the listener has never played. `share`
 * mirrors `DISCOVERY_SHARE` in services/recommendation/engine.ts (5 / 20 /
 * 45 %); recommendationCopy.test.ts fails if the two drift apart. The engine
 * nudges the share a little with the sitting's skips and full listens, which
 * is why every sentence says "about".
 */
export const DISCOVERY_OPTIONS: Array<{ value: DiscoveryMode; label: string; line: string; share: number }> = [
  { value: 'familiar', label: 'Familiar', line: 'Mostly artists you already play; about 5% of a queue is someone new to you.', share: 0.05 },
  { value: 'balanced', label: 'Balanced', line: 'Your taste first, with about 20% of a queue from artists you have never played.', share: 0.2 },
  { value: 'discover', label: 'Discover', line: 'About 45% of a queue from artists you have never played, and Home adds new languages.', share: 0.45 },
];

/** 8.1.0 — which languages a queue may draw from. */
export const QUEUE_LANGUAGE_OPTIONS: Array<{ value: QueueLanguages; label: string; line: string }> = [
  { value: 'mix', label: 'Your languages', line: 'The playing song’s language leads; songs from your other languages can follow, never two switches in a row.' },
  { value: 'one', label: 'One language', line: 'Every queue stays in the language of the song that is playing.' },
];

/** The trending-vs-taste slider in one plain line, for the value it is on now. */
export function intensityWords(v: number): string {
  if (v <= 0.3) return 'Mostly what is popular and trending right now';
  if (v >= 0.7) return 'Mostly your own listening';
  return 'A mix of what is trending and what you play';
}
