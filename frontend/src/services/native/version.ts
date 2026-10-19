/** Native only; loaded on demand so it stays out of the first-load bundle. */
/**
 * 13.7.3 — the version this install reports to the console. The Android app
 * loads the live website, so __APP_VERSION__ is the website's build; on
 * Android the installed package's version and build replace it once read.
 */
let installedVersion: string | null = null;
let versionRead: Promise<string> | null = null;
export function appVersionNow(): string {
  return installedVersion ?? __APP_VERSION__;
}
export function resolveAppVersion(): Promise<string> {
  versionRead ??= import('@capacitor/app')
    .then(({ App }) => App.getInfo())
    .then((info) => {
      if (info.version) installedVersion = `${info.version}${info.build ? `+${info.build}` : ''}`.slice(0, 24);
      return appVersionNow();
    })
    .catch(() => appVersionNow());
  return versionRead;
}
