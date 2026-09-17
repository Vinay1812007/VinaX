import type { QuickAction } from './EmptyState';

// Feature buttons on the empty chat: one tap sets up the prompt (and the
// right seat). The console can replace them (Admin → AI Quick Actions).
export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Write', prompt: 'Write a ', mode: 'win' },
  { label: 'Code', prompt: 'Write code that ', mode: 'sage' },
  { label: 'Chart', prompt: 'Make a chart of ' },
  { label: 'Diagram', prompt: 'Draw a diagram of ' },
  { label: 'Translate', prompt: 'Translate to Telugu: ', mode: 'translator' },
  { label: 'Summarise', prompt: 'Summarise this: ' },
  { label: 'Songs', prompt: 'Recommend songs for ' },
  { label: 'Explain', prompt: 'Explain simply: ' },
];
// Starter pool — suggestions are drawn at random per visit / new chat, with
// the listener's pinned language woven in. Never the same wall twice.
const STARTER_POOL: Array<(l: string) => string> = [
  (l) => `Suggest 5 ${l} songs for a rainy evening`,
  (l) => `Write a heartfelt birthday wish in ${l}`,
  (l) => `Translate "How are you doing?" into ${l}`,
  () => 'Explain quantum computing simply',
  () => 'Write a Python script that renames photos by date taken, with tests',
  () => 'Chart: India smartphone market share by brand, 2025',
  () => 'Draw a flowchart of how a web request reaches a database',
  () => 'Plan a 3-day trip to Goa on a budget',
  () => 'Write a caption for a sunset photo',
  () => 'Help me write a professional leave email',
  () => '5 easy dinner recipes for tonight',
  () => 'Give me a 20-minute home workout',
  () => 'Compare three ways to build a website in a table',
  () => "What's trending in tech news today?",
];

/** Four starters drawn at random, in the listener's language, from the
 *  built-in pool plus any the console added (`{lang}` is filled in). */
export function drawStarters(language: string, extra: readonly string[] = [], count = 4): string[] {
  const lang = language.charAt(0).toUpperCase() + language.slice(1);
  const pool: Array<(l: string) => string> = [...STARTER_POOL, ...extra.map((t) => (l: string) => t.replace(/\{lang\}/g, l))];
  const picks: string[] = [];
  while (picks.length < count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0](lang));
  }
  return picks;
}
