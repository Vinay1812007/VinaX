/**
 * The listener's live energy, read on the device from the last few plays:
 * skip streaks read as restless, completion streaks as locked in, silence
 * as a fresh session. Up Next uses it to pick the shape of the next stretch.
 */
import { isSkippedPlay } from '@/utils/plays';

export interface HistoryLike {
  completed?: boolean;
  /** v7.0.0 — explicit skip flag; see utils/plays. */
  skipped?: boolean;
  listenedSec?: number;
  ts: number;
  song?: { language?: string | null; artists?: Array<{ name: string }>; subtitle?: string };
}

/** Live energy read from the last few plays: skip-streaks read as restless,
 *  completion streaks as locked-in, silence as fresh session. */
export function readListenerEnergy(history: HistoryLike[], hour: number): string {
  const recent = history.slice(0, 8);
  if (!recent.length) return hour < 5 || hour >= 22 ? 'fresh session late — start mellow' : 'fresh session — open inviting and easy';
  const skips = recent.filter(isSkippedPlay).length;
  const lastGap = Date.now() - recent[0].ts;
  if (skips >= 4) return 'restless — recent picks are missing; change direction and lift the energy';
  if (skips >= 2) return 'wavering — mix in a safe favourite to re-anchor, then build';
  if (lastGap > 6 * 3_600_000) return 'returning after a break — re-open with a loved familiar track, then flow';
  if (hour >= 22 || hour < 5) return 'locked in, late hours — keep it smooth and let energy glide down';
  return 'locked in — the flow is landing; sustain and gently raise the energy';
}
