/**
 * v7.0.0 — was this play a skip? New plays carry an explicit flag. Older
 * ones fall back to what the clock measured: unfinished AND under thirty
 * listened seconds. An unfinished play with no measurement is NOT counted —
 * it may be the song playing right now, or one that was paused halfway.
 */
export function isSkippedPlay(e: { completed?: boolean; skipped?: boolean; listenedSec?: number }): boolean {
  if (e.completed) return false;
  if (e.skipped !== undefined) return e.skipped;
  return typeof e.listenedSec === 'number' && e.listenedSec < 30;
}
