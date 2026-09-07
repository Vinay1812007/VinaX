/**
 * v5.9.0 — the Spotify look has no ambient blobs: the canvas is a flat
 * #121212 (bg-ink-900) under black chrome. Kept as a component so the
 * layout's mount point and the light/AMOLED token swap stay untouched.
 */
export function AuroraBackground() {
  return <div className="fixed inset-0 -z-10 bg-ink-900 pointer-events-none" aria-hidden />;
}
