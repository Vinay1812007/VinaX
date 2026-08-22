/** Minimal classnames combiner — avoids a dependency for one-liner use. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
