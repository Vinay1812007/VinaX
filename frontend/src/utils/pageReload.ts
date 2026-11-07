/**
 * A reload the app started itself (a page chunk went missing after a deploy).
 * Until the page goes, cancelled imports resolve to `undefined` and the screen
 * may throw "reading 'default'"; that is not a bug to show or report.
 */
let reloading = false;

export function reloadPage(): void {
  reloading = true;
  window.location.reload();
}

export function pageReloading(): boolean {
  return reloading;
}
