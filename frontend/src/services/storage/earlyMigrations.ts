/**
 * Runs at module-evaluation time, BEFORE any zustand store rehydrates —
 * imported FIRST in main.tsx, so nothing reads a key this file erases.
 *
 * (The tarang.* → vinax.* key move that once lived here is gone: the
 * vinaxmusic.online origin and the app.Vinax.music app both started with
 * empty storage, so no install can still carry those keys.)
 *
 * 1.3: VinaX has no AI features any more, so what they kept on the device —
 * chat history, saved prompts, model and voice choices, AI caches, the song
 * vectors database — is erased once, on the first launch of this build.
 *
 * Festival themes were removed too: the marker their greeting card kept
 * ("seen this year") is erased the same way. Their switches drop out of the
 * saved settings on their own (settingsStore takes only known keys).
 */

/** Keys the removed AI features wrote (VinaX AI, AI Playlist, the AI DJ, AI Home shelves). */
const AI_KEYS = new Set([
  'vinax_ai_chats_v1',
  'vinax.dj.surfaced.v1',
  'vinax.embed.model.v1',
  'vinax.home.ai-shelves.shown.v1',
  'vinax.home.ai-shelves.songs.v1',
  'vinax.recommendation.ai-metadata.v2',
  'vinax.recommendation.ai-metadata.v3',
  'vinax.aihome.recent.v1',
  // 1.14 — the music AI is gone: the "Generated for you" Home list.
  'vinax.generated.v1',
  // 1.14 — the AI Home Builder: its switch, "not interested" shelves and recent shelf titles.
  'vinax.home.ai.v1',
  'vinax.home-ai.titles.v1',
  // 1.14 — the personal engine's outgoing event queue.
  'vinax.personal-queue.v1',
]);
/** `vinax.ai.*`, `vinax.aiplaylist.*` and the `vinax.aiSomething` preferences. */
const AI_KEY_RE = /^vinax\.ai(\.|playlist\.|[A-Z])/;

export function isRetiredAiKey(key: string): boolean {
  return AI_KEYS.has(key) || AI_KEY_RE.test(key);
}

try {
  const storage = window.localStorage;
  const retired: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && isRetiredAiKey(k)) retired.push(k);
  }
  for (const k of retired) storage.removeItem(k);
} catch {
  /* storage unavailable — nothing to erase */
}
try {
  window.localStorage.removeItem('vinax.festival-splash');
} catch {
  /* storage unavailable — nothing to erase */
}
try {
  window.indexedDB?.deleteDatabase('vinax-embeddings');
} catch {
  /* no IndexedDB here */
}
