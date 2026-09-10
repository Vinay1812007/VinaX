/** Validate home defaults before publishing them to every listener. */
export const HOME_BLOCK_IDS = new Set([
  'quick', 'personal', 'discovery', 'charts', 'seasonal', 'moods',
  'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed',
]);

export function validHomeConfig(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const blocks = (value as { blocks?: unknown }).blocks;
  if (blocks === undefined) return true; // Empty config restores built-in defaults.
  if (!Array.isArray(blocks) || blocks.length > HOME_BLOCK_IDS.size) return false;
  const seen = new Set<string>();
  return blocks.every((block: unknown) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return false;
    const { id, enabled } = block as { id?: unknown; enabled?: unknown };
    if (typeof id !== 'string' || !HOME_BLOCK_IDS.has(id) || seen.has(id)) return false;
    if (enabled !== undefined && typeof enabled !== 'boolean') return false;
    seen.add(id);
    return true;
  });
}
