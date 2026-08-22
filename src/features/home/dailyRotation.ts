/**
 * UTC-day integer, used as a queryKey component on shelves that should rotate
 * every 24 hours. Same value for a whole calendar day (UTC); increments at
 * midnight so any query keyed on it naturally refetches once daily.
 */
export function dailyBucket(): number {
  return Math.floor(Date.now() / 86_400_000);
}

/** Deterministic non-negative hash of a string — used to pick from a rotation. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
