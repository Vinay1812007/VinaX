import type { LrcLine } from '@/services/lyrics/lrclib';

/**
 * 10.1 Flow — where a preview starts and how long it runs.
 *
 * A preview should open on the part of the song people remember, not on a
 * slow intro. With synced lyrics we look for the first chorus-like line (a
 * line the song sings again later); without them we start 30% in, which is
 * where a typical film or pop song has reached its first hook.
 */

/** How long a preview plays before the feed moves on. */
export const PREVIEW_SECONDS = 30;
/** Where a preview starts when the lyrics do not say better. */
export const HOOK_FRACTION = 0.3;
/** Start a beat before the line, so the listener hears it arrive. */
const LEAD_IN_SECONDS = 1.5;
/** A chorus is not the opening seconds (intros and title calls repeat too). */
const EARLIEST_FRACTION = 0.1;
/** …nor the last stretch of the song. */
const LATEST_FRACTION = 0.75;

/** Lower-case words only, so "Hey, Jaana!" and "hey jaana" are the same line. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first line of the song's chorus, as far as the lyrics show it: among
 * substantial lines (three words or more) inside the middle of the song, the
 * earliest of those sung the most times. Null when nothing repeats.
 */
export function chorusLine(lines: readonly LrcLine[] | null | undefined, durationSec: number | null | undefined): LrcLine | null {
  if (!lines?.length) return null;
  const counts = new Map<string, number>();
  const keys = lines.map((l) => {
    const k = normalise(l.text ?? '');
    if (k.split(' ').length >= 3) counts.set(k, (counts.get(k) ?? 0) + 1);
    return k;
  });
  const d = durationSec && durationSec > 0 ? durationSec : null;
  const from = d ? d * EARLIEST_FRACTION : 0;
  const to = d ? d * LATEST_FRACTION : Infinity;
  const inside = (l: LrcLine): boolean => Number.isFinite(l.t) && l.t >= from && l.t <= to;
  // A chorus comes back more often than a verse that repeats: the most-repeated line wins, earliest first.
  let most = 1;
  lines.forEach((l, i) => {
    if (inside(l)) most = Math.max(most, counts.get(keys[i]) ?? 0);
  });
  if (most < 2) return null;
  return lines.find((l, i) => inside(l) && counts.get(keys[i]) === most) ?? null;
}

/**
 * Where to start the preview, in seconds. Always leaves room for a full
 * preview window before the song ends; a song shorter than the window starts
 * at the top. Unknown length and no lyrics: the top.
 */
export function hookPoint(durationSec: number | null | undefined, lines?: readonly LrcLine[] | null): number {
  const d = durationSec && Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
  const latest = d ? Math.max(0, d - PREVIEW_SECONDS) : Infinity;
  const chorus = chorusLine(lines, d);
  if (chorus) return Math.round(Math.min(latest, Math.max(0, chorus.t - LEAD_IN_SECONDS)) * 10) / 10;
  if (!d) return 0;
  return Math.round(Math.min(latest, d * HOOK_FRACTION));
}

/** The second the preview window closes (the song's end when that comes first). */
export function previewEnd(start: number, durationSec: number | null | undefined): number {
  const end = start + PREVIEW_SECONDS;
  return durationSec && durationSec > 0 ? Math.min(end, durationSec) : end;
}
