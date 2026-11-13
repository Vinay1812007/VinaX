import { cn } from '@/utils/cn';
import '@/styles/ui.css';

/** A quiet indeterminate spinner. Decorative unless `label` is given. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  if (label) return <span role="status" aria-label={label} className={cn('vx-spinner', className)} />;
  return <span aria-hidden className={cn('vx-spinner', className)} />;
}
