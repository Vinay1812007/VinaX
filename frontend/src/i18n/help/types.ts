/**
 * The shape of a Help translation (te.ts, hi.ts, ta.ts, kn.ts, ml.ts in this folder). Each
 * file is its own lazy chunk, fetched only when Help or a tour opens in that
 * app language; English in features/help/helpContent.ts and
 * features/tutorials/tutorials.ts is the source and the fallback.
 *
 * Guides and questions are keyed by their `id`, tours by the tour id with
 * one entry per step in the same order. Group names and shortcut descriptions
 * are keyed by their English text. A guide or tour whose step count no longer
 * matches English shows in English until it is translated again.
 */

/** The Help page's and the tour card's own words. `{name}` is filled in. */
export const HELP_UI_KEYS = [
  'Help & feedback',
  'Guides for every feature, answers, and a line to the VinaX team.',
  'Search help',
  'Clear search',
  'Nothing matches “{q}”. Try another word, or ask the team below.',
  'Live tutorials',
  'Each one runs inside the real app and points at the real buttons. Press Esc to leave one.',
  '{done} of {total} done',
  'Done',
  '{n} min',
  'plays music',
  '{n} steps',
  'Replay the welcome tour',
  'Open Settings',
  'Open Listen Together',
  'What’s new in {version}',
  'How to use VinaX',
  'Short, step-by-step guides. Open one to read it.',
  'Questions',
  'Keyboard and gestures',
  'Copyright and legal',
  'VinaX hosts no media files and sells nothing. Songs, recordings, artwork and lyrics belong to their artists, labels and rights holders, who can request removal at any time.',
  'Legal',
  'Terms of use',
  'Privacy',
  'Copyright and takedowns',
  'Contact',
  'Service status',
  'Opens in a new tab',
  'Report a bug or share an idea',
  'Goes straight to the VinaX team, with a city-level location to help reproduce issues.',
  'What kind of message',
  'Bug',
  'Idea',
  'Other',
  'What happened, what you expected, and the song or page if it matters…',
  'Tell us what you’d love to see…',
  'Your message',
  'Include app version, platform, screen size, language and theme',
  'Sending…',
  'Send feedback',
  'Please write a message first',
  'Thanks. Your feedback was sent.',
  'Could not send — check your connection and try again.',
  // The tour card
  'Tutorial: {title}',
  'Step {n} of {total}.',
  '{n} of {total}',
  'Playing',
  'Getting things ready…',
  'Close',
  'Back',
  'Next',
] as const;

export type HelpUiKey = (typeof HELP_UI_KEYS)[number];

export interface HelpTourStep { title: string; body: string; tip?: string }

export interface HelpTranslation {
  ui: Record<HelpUiKey, string>;
  /** Guide group names, keyed by the English group. */
  groups: Record<string, string>;
  /** Keyed by Guide.id; one step per English step. */
  guides: Record<string, { title: string; steps: string[] }>;
  /** Keyed by FaqEntry.id. */
  faq: Record<string, { q: string; a: string }>;
  /** Shortcut descriptions, keyed by the English description (the keys themselves stay as they are). */
  shortcuts: Record<string, string>;
  /** Keyed by Tutorial.id; `needs` translates the tour's "cannot run yet" line. */
  tutorials: Record<string, { title: string; blurb: string; needs?: string; steps: HelpTourStep[] }>;
}
