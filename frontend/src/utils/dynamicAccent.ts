/**
 * Dynamic theme (experimental, off by default): tint the accent ramp from the
 * playing artwork's dominant color. Lazily imported by AppLayout ONLY while
 * the setting is on — this math has no business in the 161KB first-load
 * budget for the majority who never enable it.
 */
export function applyArtAccent(hexColor: string): void {
  const root = document.documentElement;
  const hex = hexColor.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    // Malformed extracted colour: clear any stale dynamic override.
    clearArtAccent();
    return;
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  root.style.setProperty('--ember-500', `${r} ${g} ${b}`);
  // The 400 tier is the TEXT tier: on dark canvases brighten it, on the
  // light canvas darken it, or artwork-derived text washes out to
  // unreadable pastels (theme classes are applied before this runs).
  const shift = root.classList.contains('light') ? -60 : 40;
  const clamp = (v: number) => Math.max(0, Math.min(255, v + shift));
  root.style.setProperty('--ember-400', `${clamp(r)} ${clamp(g)} ${clamp(b)}`);
  root.style.setProperty('--ember-600', `${Math.max(0, r - 40)} ${Math.max(0, g - 40)} ${Math.max(0, b - 40)}`);
}

export function clearArtAccent(): void {
  const s = document.documentElement.style;
  s.removeProperty('--ember-500');
  s.removeProperty('--ember-400');
  s.removeProperty('--ember-600');
}
