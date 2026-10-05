/**
 * v5.9.0 — the flat look has no ambient blobs. 10.0 Marigold — kept as a
 * component so the layout's mount point and the light/AMOLED token swap stay
 * untouched: the plum (or cream) canvas with the faintest Marigold and Rose
 * glow in two corners. Static gradients only: no blur, no animation.
 */
export function AuroraBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 bg-ink-900 pointer-events-none"
      style={{
        backgroundImage:
          'radial-gradient(60% 50% at 0% 0%, rgb(var(--ember-500) / 0.08), transparent 70%), radial-gradient(50% 45% at 100% 100%, rgb(var(--tide-500) / 0.06), transparent 70%)',
      }}
      aria-hidden
    />
  );
}
