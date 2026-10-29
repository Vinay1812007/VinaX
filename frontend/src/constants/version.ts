/**
 * Displayed app version — its own tiny module so eager UI (What's New badge,
 * onboarding) never drags the full changelog history into the first-load
 * bundle. Bumped every release alongside package.json and the changelog.
 */
export const LATEST_VERSION = '1.2.5';

/**
 * Marketing display name for the release — what listeners see everywhere a
 * version shows in the UI (Settings, About, What's New). Internal semver
 * (LATEST_VERSION) keeps driving update checks and release hygiene.
 *
 * VinaX V2 restarted the version at 1.0.0 after 15.0.1. Nothing compares
 * version names: Android updates compare build numbers (services/update.ts),
 * which keep rising, and What's New compares a fingerprint of the top card.
 */
export const DISPLAY_VERSION = 'VinaX V2 1.2';
