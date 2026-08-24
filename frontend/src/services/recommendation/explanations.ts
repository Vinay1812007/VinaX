import { languageLabel } from '@/constants/languages';
import { dayPartLabel } from '@/utils/time';
import type { ReasonComponent, RecommendationContext } from './types';

/** Honest, human one-liners for shelves and suggestions. */
export function explainReasons(reasons: ReasonComponent[]): string {
  const top = reasons[0];
  if (!top) return 'Popular right now';
  switch (top.kind) {
    case 'language':
      return `Because you listen to ${languageLabel(top.detail ?? null)} music`;
    case 'artist':
      return top.detail ? `Because you play ${top.detail}` : 'From artists you favor';
    case 'related':
      return top.detail ? `Similar to “${top.detail}”` : 'Similar to your recent listens';
    case 'low-skip':
      return 'Songs you rarely skip';
    case 'rediscovery':
      return 'You loved this a while back';
    case 'trending':
      return 'Trending in your languages';
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
      return top.detail
        ? `Something different — ${languageLabel(top.detail)} you haven’t tried`
        : 'Something different — outside your usual';
    case 'popularity':
    default:
      return 'Popular right now';
  }
}

/**
 * Package C4 — the fuller "why am I seeing this?" line: up to `max` distinct
 * top reasons joined into one honest sentence ("Because you play Sid Sriram ·
 * trending in your languages"). Plain words, no jargon, computed on-device.
 */
export function explainTopReasons(reasons: ReasonComponent[], max = 3): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of reasons) {
    if (parts.length >= max) break;
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    parts.push(explainReasons([r]));
  }
  return parts.length ? parts.join(' · ') : 'Popular right now';
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
