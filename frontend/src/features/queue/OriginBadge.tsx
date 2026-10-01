import { ORIGIN_LABEL, type QueueOrigin } from './origin';
import { cn } from '@/utils/cn';

/**
 * 7.2 — the quiet "VinaX pick" / "Added by you" marker on an upcoming entry.
 * Words, not a colour: the text is what a screen reader reads as part of the
 * row, and the tint (Lagoon for VinaX's picks, Iris for the listener's own)
 * and the glyph only repeat it. Styled in styles/pages/player.css.
 */
export function OriginBadge({ origin, className }: { origin: QueueOrigin; className?: string }) {
  const label = ORIGIN_LABEL[origin];
  if (!label) return null;
  return (
    <span className={cn('vx-queue-origin', className)} data-origin={origin}>
      <svg viewBox="0 0 16 16" aria-hidden="true" className="vx-queue-origin-glyph">
        {origin === 'auto' ? (
          // A four-point spark: chosen for you.
          <path d="M8 1.5c.5 3.2 2.3 5 5.5 5.5v1c-3.2.5-5 2.3-5.5 5.5h-1C6.5 10.3 4.7 8.5 1.5 8v-1C4.7 6.5 6.5 4.7 7 1.5z" fill="currentColor" />
        ) : (
          // A plus in a ring: you added it.
          <path d="M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5zM8 5v6M5 8h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
      </svg>
      {label}
    </span>
  );
}
