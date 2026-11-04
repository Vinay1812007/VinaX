/** Opens the "Allow access" sheet (components/PermissionsSheet). A tiny module so callers do not load the permission code. */
export const OPEN_PERMISSIONS_EVENT = 'vinax:ask-permissions';

/** 'welcome' = the end of the first-run welcome; 'settings' = the listener asked to review them. */
export type PermissionsOpenSource = 'welcome' | 'settings';

export function openPermissionsSheet(source: PermissionsOpenSource): void {
  window.dispatchEvent(new CustomEvent<PermissionsOpenSource>(OPEN_PERMISSIONS_EVENT, { detail: source }));
}
