import { FESTIVAL_VISUALS } from '@/constants/festivalVisuals';
import type { Festival } from '@/constants/festivals';

/**
 * 1.12 — the live effects each festival plays on the canvas behind the app
 * (features/festival/fx/particles.ts). Chosen by hand for the headline days
 * — Diwali is diyas and fireworks, Holi is colour powder, Sankranti is kites,
 * Christmas is snow, Eid is lanterns under a crescent — and derived from the
 * day's particle shape for the rest, so every one of the 43 looks moves.
 */
export type FxKind = 'confetti' | 'fireworks' | 'petals' | 'balloons' | 'diyas' | 'snow' | 'powder' | 'kites' | 'lanterns' | 'sparkle' | 'leaves' | 'hearts';

export const FX_KINDS: readonly FxKind[] = ['confetti', 'fireworks', 'petals', 'balloons', 'diyas', 'snow', 'powder', 'kites', 'lanterns', 'sparkle', 'leaves', 'hearts'];

const BY_FESTIVAL: Record<string, FxKind[]> = {
  sankranti: ['kites', 'sparkle'],
  republic: ['balloons', 'confetti'],
  valentine: ['hearts', 'petals'],
  shivaratri: ['sparkle'],
  holi: ['powder', 'confetti'],
  womensday: ['petals'],
  ugadi: ['leaves', 'petals'],
  eid: ['lanterns', 'sparkle'],
  ramanavami: ['petals', 'sparkle'],
  easter: ['petals', 'confetti'],
  vishu: ['petals', 'leaves'],
  akshaya: ['sparkle', 'diyas'],
  buddha: ['petals'],
  mothersday: ['petals', 'hearts'],
  hanuman: ['petals', 'sparkle'],
  bakrid: ['lanterns', 'sparkle'],
  telangana: ['confetti', 'petals'],
  fathersday: ['sparkle', 'balloons'],
  bonalu: ['petals', 'leaves'],
  gurupurnima: ['sparkle', 'diyas'],
  friendship: ['confetti', 'balloons'],
  independence: ['confetti', 'balloons'],
  varalakshmi: ['petals', 'diyas'],
  onam: ['petals'],
  rakhi: ['confetti', 'petals'],
  janmashtami: ['petals', 'sparkle'],
  teachers: ['sparkle', 'confetti'],
  ganesh: ['petals', 'fireworks'],
  gandhi: ['petals'],
  bathukamma: ['petals'],
  navratri: ['sparkle', 'confetti'],
  dussehra: ['fireworks', 'sparkle'],
  halloween: ['leaves', 'sparkle'],
  apformation: ['petals', 'confetti'],
  diwali: ['diyas', 'fireworks', 'sparkle'],
  nagula: ['leaves', 'sparkle'],
  childrens: ['balloons', 'confetti'],
  chhath: ['sparkle', 'diyas'],
  karthika: ['diyas', 'sparkle'],
  gurunanak: ['diyas', 'sparkle'],
  vaikunta: ['lanterns', 'petals'],
  christmas: ['snow', 'sparkle'],
  newyear: ['fireworks', 'confetti'],
};

const BY_PARTICLE: Record<string, FxKind> = { powder: 'powder', petal: 'petals', lantern: 'lanterns', snow: 'snow', spark: 'sparkle', ribbon: 'confetti', leaf: 'leaves', feather: 'petals' };

/** The effects for one festival id, headline days first. */
export function fxFor(id: string): FxKind[] {
  const own = BY_FESTIVAL[id];
  if (own?.length) return own;
  const particle = FESTIVAL_VISUALS[id]?.particle;
  return [BY_PARTICLE[particle ?? 'spark'] ?? 'sparkle'];
}

/** The festival's colours for the canvas: its own palette, without plain white (it reads as snow). */
export function paletteOf(f: Festival): string[] {
  const colours = f.colors.filter((c) => c.toLowerCase() !== '#ffffff' && c.toLowerCase() !== '#000000');
  return colours.length ? colours : f.colors;
}

/** One line a listener reads about the live effects of a day. */
export function fxLine(id: string): string {
  const names: Record<FxKind, string> = {
    confetti: 'confetti', fireworks: 'fireworks', petals: 'falling petals', balloons: 'floating balloons', diyas: 'glowing diyas',
    snow: 'snowfall', powder: 'colour powder', kites: 'flying kites', lanterns: 'floating lanterns', sparkle: 'sparkling stars', leaves: 'drifting leaves', hearts: 'floating hearts',
  };
  const parts = fxFor(id).map((k) => names[k]);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]!;
}
