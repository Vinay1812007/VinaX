/**
 * Displayed app version — its own tiny module so eager UI (What's New badge,
 * onboarding) never drags the full changelog history into the first-load
 * bundle. Bumped every release alongside package.json and the changelog.
 */
export const LATEST_VERSION = '5.5.1';

/**
 * Marketing display name for the release — what listeners see everywhere a
 * version shows in the UI (Settings, About, What's New). Internal semver
 * (LATEST_VERSION) keeps driving update checks and release hygiene.
 */
export const DISPLAY_VERSION = 'VinaX V5.5';
