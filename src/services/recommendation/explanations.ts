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
    case 'popularity':
    default:
      return 'Popular right now';
  }
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
    default:
      return 'Picked for you, locally';
  }
}
