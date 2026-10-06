import { languageLabel } from '@/constants/languages';
import { dayPartLabel } from '@/utils/time';
import type { ReasonComponent, RecommendationContext } from './types';
import { MUSIC_STYLES, offStyleWhy, styleWhy, type MusicStyle } from './style';

/**
 * 9.0.0 — the smallest contribution that counts as a reason for "Why this
 * song?". Smaller terms moved the score too little to be the answer.
 */
export const MIN_REASON_WEIGHT = 0.02;
/** 9.0.0 — said when no term is a real reason (instead of claiming the song is popular). */
export const GENERIC_REASON = 'Picked on this device from your listening';

/** Honest, human one-liners for shelves and suggestions. '' when the term makes no claim worth saying. */
export function explainReasons(reasons: ReasonComponent[]): string {
  const top = reasons[0];
  if (!top) return GENERIC_REASON;
  switch (top.kind) {
    case 'language':
      // 9.0.0 — the seed-language match is about the song playing, not the listener's habits.
      if (top.detail?.startsWith('same:')) return 'In the same language as the song playing';
      return `Because you listen to ${languageLabel(top.detail ?? null)} music`;
    case 'artist':
      return top.detail ? `Because you play ${top.detail}` : 'From artists you favor';
    case 'related':
      return top.detail ? `Similar to “${top.detail}”` : 'Similar to your recent listens';
    case 'low-skip':
      return top.weight < 0 ? 'Less likely after a recent skip' : 'Songs you rarely skip';
    case 'genre': return 'Fits the genres you enjoy';
    case 'vibe': return 'A similar atmosphere';
    case 'energy': return 'A comfortable energy transition';
    case 'tempo': return 'A similar pace';
    case 'dialect': return 'Matches your regional listening';
    case 'likes': return 'One of your favorites';
    case 'history': return 'Recently played';
    case 'diversity': return 'A different voice in your mix';
    case 'rediscovery':
      return 'You loved this a while back';
    case 'trending':
      // 9.1.0 — this term comes from a CATALOGUE SEARCH for popular-sounding
      // words, with no outside evidence behind it. Saying "trending" was a
      // claim the signal does not support; only 'chart' (verified entries from
      // /api/trends) may say that.
      return 'Popular in the catalogue for your languages';
    case 'popular-now':
      return top.detail ? `On ${top.detail}` : 'On a verified chart';
    case 'region':
      return 'Popular in your region';
    case 'time':
      return 'For this time of day';
    case 'mood':
      return 'Matches your current mood';
    case 'session':
      return 'Keeps your current vibe going';
    case 'co-play':
      return top.detail ? `You often play ${top.detail} alongside this` : 'You often play these together';
    case 'discovery':
      if (top.detail === 'new-artist') return 'An artist you have not played yet';
      if (top.detail === 'new-song') return 'A song you have not played yet';
      return top.detail
        ? `Something different — ${languageLabel(top.detail)} you haven’t tried`
        : 'Something different — outside your usual';
    case 'familiar':
      return 'Known ground — you asked for familiar picks';
    case 'fatigue':
      return 'Held back a little — this artist just played a lot';
    case 'intent':
      return top.weight < 0 ? 'Less of what you have been skipping just now' : 'More of what you reached for just now';
    // 7.2.0 — every recorded term has its own honest line; none borrows "popular".
    case 'song':
      return 'A song you keep finishing';
    case 'day':
      return 'Fits what you play on this day of the week';
    case 'agreement':
      return 'Found by more than one of your listening signals';
    case 'chart':
      return top.detail ? `On ${top.detail} right now` : 'On a public chart right now';
    case 'fresh':
      return 'A recent release';
    case 'festival':
      return 'For the festival season';
    case 'dial':
      return top.weight < 0 ? 'Held back by your taste dials' : 'Nudged up by your taste dials';
    case 'popularity':
      // An unknown play count earns a neutral placeholder value: no claim.
      return top.detail === 'unknown' ? '' : 'Popular right now';
    // 8.2.0
    case 'taste':
      return 'Close to the songs you love';
    case 'served':
      return 'Held back a little — you were shown this recently';
    case 'album':
      return top.detail ? `From the same album as “${top.detail}”` : 'From the same album';
    case 'similar-artist':
      return top.detail ? `By an artist close to ${top.detail}` : 'By an artist close to this one';
    case 'proven':
      return top.detail ? `Like “${top.detail}”, which you enjoyed before` : 'Like picks you enjoyed before';
    // 8.3.0 — the listener's style (detail: the style, or "off-<style>").
    case 'style': {
      const off = top.detail?.startsWith('off-');
      const style = MUSIC_STYLES.find((s) => s === (off ? top.detail!.slice(4) : top.detail)) as MusicStyle | undefined;
      if (!style) return top.weight < 0 ? 'Held back — a different style from what is playing' : 'Keeps the style that is playing';
      return off || top.weight < 0 ? offStyleWhy(style) : styleWhy(style);
    }
    default:
      return 'Picked from your listening';
  }
}

/**
 * Package C4 — the fuller "why am I seeing this?" line: up to `max` distinct
 * top reasons joined into one honest sentence ("Because you play Sid Sriram ·
 * trending in your languages"). Plain words, no jargon, computed on-device.
 *
 * 9.0.0 — only terms that actually ADDED at least MIN_REASON_WEIGHT to the
 * score are reasons. 8.x took the top three kinds whatever their sign, so a
 * song could be "explained" by a penalty ("Recently played", "Held back a
 * little…"), and an unknown play count read as "Popular right now". With no
 * real reason the line says so plainly (GENERIC_REASON).
 */
export function explainTopReasons(reasons: ReasonComponent[], max = 3): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of [...reasons].sort((a, b) => b.weight - a.weight)) {
    if (parts.length >= max) break;
    if (!(r.weight >= MIN_REASON_WEIGHT) || seen.has(r.kind)) continue;
    const line = explainReasons([r]);
    if (!line) continue;
    seen.add(r.kind);
    parts.push(line);
  }
  return parts.length ? parts.join(' · ') : GENERIC_REASON;
}

export function explainMix(kind: string, ctx: RecommendationContext, detail?: string): string {
  switch (kind) {
    case 'made-for-you':
      return 'Blended from your plays, favorites, and languages — computed on this device';
    case 'daily':
      return detail
        ? `A fresh rotation of ${languageLabel(detail)} songs you’re likely to finish`
        : 'A fresh rotation based on your recent taste';
    case 'language':
      return detail ? `Trending and taste-matched ${languageLabel(detail)} picks` : 'In your languages';
    case 'time':
      return `Based on your ${dayPartLabel(ctx.hour)} sessions`;
    case 'rediscover':
      return 'Songs you finished weeks ago and haven’t replayed since';
    case 'low-skip':
      return 'Low-skip songs from artists and languages you favor';
    case 'because':
      return detail ? `Because you played “${detail}”` : 'Because of your recent listens';
    case 'fresh':
      return 'New-ish releases matched to your taste';
    case 'explore':
      return 'Deliberately unlike your usual — languages and artists you haven’t tried';
    case 'weekend':
      return 'Slower openers, longer arcs — matched to how you actually listen on weekends';
    case 'late-night':
      return 'Softer, longer, less shouty — a mix that suits after-midnight ears';
    case 'comeback':
      return 'Back after a break? Here’s where you left off, gently';
    case 'artist-radio':
      return detail ? `A station around ${detail} — songs that co-play with them for you` : 'An artist-anchored station';
    case 'discover-weekly':
      return 'This week’s discovery lane: fresh-to-you picks refreshed every Monday';
    default:
      return 'Picked for you, locally';
  }
}
