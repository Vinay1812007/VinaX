/**
 * v8 — the site mode the owner chose in the console (App Settings →
 * Maintenance), shared by the parts of the app that save changes.
 *
 *   live         everything works
 *   readonly     people can listen; nothing they change is saved on the
 *                server (the Worker refuses those writes with 503 read_only)
 *   maintenance  SiteGate shows the maintenance screen
 *
 * SiteGate keeps this up to date from /api/site-mode. Writers call
 * isReadOnly() first so they can say why instead of failing quietly.
 */
export type SiteModeName = 'live' | 'readonly' | 'maintenance';

export const READ_ONLY_MESSAGE = 'VinaX is in read-only mode right now. You can keep listening; changes are not saved until it ends.';

let mode: SiteModeName = 'live';
const listeners = new Set<(m: SiteModeName) => void>();

export function setSiteMode(next: unknown): void {
  const m: SiteModeName = next === 'readonly' || next === 'maintenance' ? next : 'live';
  if (m === mode) return;
  mode = m;
  listeners.forEach((fn) => {
    try { fn(m); } catch { /* a listener's problem stays its own */ }
  });
}

export const getSiteMode = (): SiteModeName => mode;
export const isReadOnly = (): boolean => mode === 'readonly';

/** Subscribe to changes; returns the unsubscribe function. */
export function onSiteMode(fn: (m: SiteModeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
