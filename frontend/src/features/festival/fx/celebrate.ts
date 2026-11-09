/**
 * 1.12 — one-shot celebrations anywhere in the app: `celebrate('confetti')`
 * when Home opens on a festival day, `celebrate('fireworks')` when the
 * festival banner is tapped, a pour of confetti on "Play festive songs".
 * The layer that draws them (CelebrationLayer) subscribes here; nothing
 * draws when it is not mounted, when the listener turned festival
 * animations off, or when the device asks for less motion.
 */
export type CelebrationKind = 'confetti' | 'fireworks';

export interface Celebration {
  kind: CelebrationKind;
  /** Where it starts, in viewport pixels (confetti pours from here; fireworks launch under it). */
  at?: { x: number; y: number };
  /** Colours; the current festival's when omitted. */
  palette?: string[];
  /** Play the matching sound (when Festival sounds is on). */
  sound?: boolean;
}

type Listener = (c: Celebration) => void;
const listeners = new Set<Listener>();

export function onCelebrate(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function celebrate(kind: CelebrationKind, o: Omit<Celebration, 'kind'> = {}): void {
  const c: Celebration = { kind, sound: true, ...o };
  for (const fn of listeners) fn(c);
}

/** Once per browser session: the app's first festive open plays a pour of confetti. */
export function celebrateOncePerSession(key: string, kind: CelebrationKind, o: Omit<Celebration, 'kind'> = {}): boolean {
  const k = `vinax.celebrated.${key}`;
  try {
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, '1');
  } catch {
    /* storage is optional */
  }
  celebrate(kind, o);
  return true;
}
