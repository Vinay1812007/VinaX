/** Single registry of every localStorage key VinaX owns. */
export const STORAGE_PREFIX = 'vinax';

export const KEYS = {
  schemaVersion: `${STORAGE_PREFIX}.schema-version`,
  settings: `${STORAGE_PREFIX}.settings.v1`,
  player: `${STORAGE_PREFIX}.player.v1`,
  library: `${STORAGE_PREFIX}.library.v1`,
  history: `${STORAGE_PREFIX}.history.v1`,
  search: `${STORAGE_PREFIX}.search.v1`,
  profile: `${STORAGE_PREFIX}.profile.v1`,
  region: `${STORAGE_PREFIX}.region.v1`,
  onboarded: `${STORAGE_PREFIX}.onboarded.v1`,
  lastSeenVersion: `${STORAGE_PREFIX}.last-seen-version`,
  deviceId: `${STORAGE_PREFIX}.device-id`,
  userName: `${STORAGE_PREFIX}.user-name`,
  analyticsConsent: `${STORAGE_PREFIX}.analytics-consent`,
  downloads: `${STORAGE_PREFIX}.downloads.v1`,
  alarm: `${STORAGE_PREFIX}.alarm.v1`,
  lyricsOffset: `${STORAGE_PREFIX}.lyrics-offset.v1`,
  weekly: `${STORAGE_PREFIX}.weekly.v1`,
  output: `${STORAGE_PREFIX}.output.v1`,
  roomHostTokens: `${STORAGE_PREFIX}.room-host-tokens.v1`,
  // VinaX AI chat history — persisted (with base64 attachments stripped) so
  // "erase everything" clears it too. Legacy key predates the vinax. prefix.
  aiChats: 'vinax_ai_chats_v1',
} as const;

export const CURRENT_SCHEMA_VERSION = 2;
