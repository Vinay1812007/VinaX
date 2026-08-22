/**
 * Home screen builder (4.16.0) — the big Home blocks a listener can hide or
 * reorder from Settings → Home layout. Hero (greeting + Aura Mix) and the
 * language rail are the app's identity and stay fixed on top.
 *
 * Keys are persisted in settings (hiddenHome / homeOrder), so RENAMING A KEY
 * IS A BREAKING CHANGE for saved layouts — add new keys, don't repurpose old
 * ones. Unknown saved keys are ignored; new keys append in default order.
 */
export interface HomeBlockDef {
  key: string;
  label: string;
  hint: string;
}

export const HOME_BLOCKS: readonly HomeBlockDef[] = [
  { key: 'quick', label: 'Quick access grid', hint: 'Continue listening, liked songs, on repeat…' },
  { key: 'personal', label: 'Your music shelves', hint: 'Made-for-you mixes built from your listening' },
  { key: 'discovery', label: 'Discovery shelves', hint: 'Trending, new releases, fresh finds, hidden gems' },
  { key: 'charts', label: 'Top 50 cards', hint: 'Global, your country and Viral 50' },
  { key: 'seasonal', label: 'Seasonal shelf', hint: 'Only appears around festivals and seasons' },
  { key: 'moods', label: 'Mood playlists', hint: 'Six rotating mood boards' },
  { key: 'genres', label: 'Genre collections', hint: 'One-tap genre searches' },
  { key: 'artists', label: 'Trending artists', hint: 'Names topping the charts' },
  { key: 'albums', label: 'Trending albums', hint: 'The albums everyone is spinning' },
  { key: 'daypicks', label: 'Time-of-day picks', hint: 'Tuned to your morning/evening sessions' },
  { key: 'loved', label: 'Recently loved', hint: 'Your latest favourites' },
  { key: 'feed', label: 'Endless feed', hint: '“More For You” — scrolls forever' },
] as const;

export const HOME_BLOCK_KEYS: readonly string[] = HOME_BLOCKS.map((b) => b.key);

/**
 * Merge a saved custom order with the canonical default:
 * saved keys keep their relative order (unknown/retired keys dropped),
 * blocks missing from the saved order append in default position.
 */
export function orderHomeBlocks(saved: readonly string[], defaultOrder: readonly string[] = HOME_BLOCK_KEYS): string[] {
  const valid = saved.filter((k) => defaultOrder.includes(k));
  return [...valid, ...defaultOrder.filter((k) => !valid.includes(k))];
}
