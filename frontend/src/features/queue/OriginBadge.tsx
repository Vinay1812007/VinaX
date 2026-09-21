import { ORIGIN_LABEL, type QueueOrigin } from './origin';
import { cn } from '@/utils/cn';

/**
 * 7.2 — the quiet "DJ pick" / "Added by you" marker on an upcoming entry.
 * Words, not a colour: the text is what a screen reader reads as part of the
 * row, and the tint only repeats it.
 */
export function OriginBadge({ origin, className }: { origin: QueueOrigin; className?: string }) {
  const label = ORIGIN_LABEL[origin];
  if (!label) return null;
  return (
    <span className={cn('vx-queue-origin', className)} data-origin={origin}>
      {label}
    </span>
  );
}
