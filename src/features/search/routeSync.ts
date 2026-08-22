/**
 * Spotify-style manual search input (v3.6.0).
 *
 * The search box value is owned by the user alone. The URL still deep-links a
 * committed search, but the route must NEVER write back into the box while the
 * listener is typing — that was the "type a few letters and the input snaps
 * back / won't accept more" bug (a route→input feedback loop: typing drove a
 * debounced navigate, whose route change then overwrote the box mid-keystroke).
 *
 * Rule: only copy the route into the input on a REAL external route change
 * (deep link, back/forward, a tapped chip) AND only while the box is not
 * focused. Live results below still update on debounce, untouched.
 */
export function shouldSyncRouteToInput(
  routeQuery: string | undefined,
  lastApplied: string | null,
  focused: boolean,
): boolean {
  if (focused) return false; // user is typing — hands off
  if (!routeQuery) return false; // no route query to apply
  return routeQuery !== lastApplied; // only on a genuinely new route value
}
