/** Single registry of every localStorage key VinaX owns. */
export const STORAGE_PREFIX = 'vinax';

export const KEYS = {
  schemaVersion: `${STORAGE_PREFIX}.schema-version`,
  settings: `${STORAGE_PREFIX}.settings.v1`,
  player: `${STORAGE_PREFIX}.player.v1`,
  /** 7.2.0 — who queued each song in the persisted queue (the recommender or the listener). */
  queueOwnership: `${STORAGE_PREFIX}.queue.ownership.v1`,
  library: `${STORAGE_PREFIX}.library.v1`,
  history: `${STORAGE_PREFIX}.history.v1`,
  search: `${STORAGE_PREFIX}.search.v1`,
  profile: `${STORAGE_PREFIX}.profile.v1`,
  /** Package C2 — Kid mode's separate taste profile (favorites/downloads stay shared). */
  profileKid: `${STORAGE_PREFIX}.profile.kid.v1`,
  region: `${STORAGE_PREFIX}.region.v1`,
  onboarded: `${STORAGE_PREFIX}.onboarded.v1`,
  lastSeenVersion: `${STORAGE_PREFIX}.last-seen-version`,
  deviceId: `${STORAGE_PREFIX}.device-id`,
  /** HMAC-signed device id issued by /api/events (audit H-SRV-6). Echoing it
   *  keeps the SAME admin row across IP / network / UA changes — without it
   *  the server derives ip+ua ids and one listener multiplies into many rows. */
  signedDeviceId: `${STORAGE_PREFIX}.signed-device-id`,
  userName: `${STORAGE_PREFIX}.user-name`,
  /** Unique lowercase handle claimed via /api/username at onboarding —
   *  display names collide, the handle never does. */
  userHandle: `${STORAGE_PREFIX}.user-handle`,
  /** A handle the listener chose that the service has NOT confirmed yet
   *  (offline / server error / refused as taken) — see features/identity. */
  userHandlePending: `${STORAGE_PREFIX}.user-handle-pending.v1`,
  /** 12.2 — the optional Google sign-in: VinaX's own session and the profile it returned. */
  account: `${STORAGE_PREFIX}.account.v1`,
  analyticsConsent: `${STORAGE_PREFIX}.analytics-consent`,
  /** 14.0.3 — usage sharing is on by default; this marks the one-time switch of devices that never chose. */
  usageSharingDefaultOn: `${STORAGE_PREFIX}.usage-sharing-default-on.v1`,
  /** 14.0.3 — third-party session insights (heatmaps, masked replays): its own opt-in, off by default. */
  sessionInsightsConsent: `${STORAGE_PREFIX}.session-insights-consent.v1`,
  downloads: `${STORAGE_PREFIX}.downloads.v1`,
  alarm: `${STORAGE_PREFIX}.alarm.v1`,
  lyricsOffset: `${STORAGE_PREFIX}.lyrics-offset.v1`,
  /** Package D10 — recent karaoke sessions ("Sing again" on the Karaoke page). */
  karaoke: `${STORAGE_PREFIX}.karaoke.v1`,
  weekly: `${STORAGE_PREFIX}.weekly.v1`,
  /** 15.0 — which week's Weekly Mix the smart downloads hold, and its ids. */
  smartDownloads: `${STORAGE_PREFIX}.smart-downloads.v1`,
  /** 15.0 — the weeks each weekly goal was met (features/stats/goals.ts). */
  goalLedger: `${STORAGE_PREFIX}.goal-ledger.v1`,
  /** 15.0 — the own public profile and following list (features/social/store.ts). */
  social: `${STORAGE_PREFIX}.social.v1`,
  /** 15.0 — local playlist id → its shared copy (id, invite token, version). */
  sharedPlaylists: `${STORAGE_PREFIX}.shared-playlists.v1`,
  /** 15.0 — release alerts: seen top-song ids per saved artist, the new ones (features/releases). */
  releases: `${STORAGE_PREFIX}.releases.v1`,
  output: `${STORAGE_PREFIX}.output.v1`,
  roomHostTokens: `${STORAGE_PREFIX}.room-host-tokens.v1`,
  /** Last in-app-update install attempt {build, ts} — the dialog reappearing
   *  for the SAME build after an attempt means the install didn't take
   *  (cancelled, or Android's signature-conflict block on legacy installs),
   *  so it switches to the one-time reinstall guidance. */
  updateAttempt: `${STORAGE_PREFIX}.update-attempt.v1`,
  /** "Update later" — {build, until}: the update gate stays down for this
   *  build until `until`; a newer build or a manual check ignores it. */
  updateSnooze: `${STORAGE_PREFIX}.update-snooze.v1`,
} as const;

export const CURRENT_SCHEMA_VERSION = 2;
