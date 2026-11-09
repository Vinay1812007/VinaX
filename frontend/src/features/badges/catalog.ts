/**
 * 1.12 — badges: small awards for listening, worked out on the device from
 * the history, the streak, the library and the weekly goals. Each one has a
 * target the Stats page shows progress toward, a glyph and a hue for its
 * card. Ids are stable: they travel in the backup and on the public profile.
 */
export type BadgeGroup = 'listening' | 'streak' | 'time' | 'range' | 'library' | 'goals';

export interface BadgeDef {
  id: string;
  name: string;
  /** How to earn it, in plain words (also the share card's line). */
  blurb: string;
  glyph: string;
  /** Hue (0–360) for the badge's tint. */
  hue: number;
  group: BadgeGroup;
  target: number;
  /** The unit after the number on the progress line ("plays", "days"). */
  unit: string;
}

export const BADGES: readonly BadgeDef[] = [
  // Lifetime plays, from the counters (history alone keeps only the last 150).
  { id: 'first-note', name: 'First note', blurb: 'Play your first song on VinaX.', glyph: '🎵', hue: 32, group: 'listening', target: 1, unit: 'play' },
  { id: 'century', name: 'Century', blurb: 'Play 100 songs.', glyph: '💯', hue: 18, group: 'listening', target: 100, unit: 'plays' },
  { id: 'marathoner', name: 'Marathoner', blurb: 'Play 500 songs.', glyph: '🏃', hue: 350, group: 'listening', target: 500, unit: 'plays' },
  { id: 'thousand', name: 'A thousand songs', blurb: 'Play 1,000 songs.', glyph: '🏆', hue: 45, group: 'listening', target: 1000, unit: 'plays' },
  // The listening streak (utils/streak: one day counts from the first play).
  { id: 'streak-7', name: 'One week on', blurb: 'Listen 7 days in a row.', glyph: '🔥', hue: 14, group: 'streak', target: 7, unit: 'days' },
  { id: 'streak-30', name: 'A month of music', blurb: 'Listen 30 days in a row.', glyph: '🗓️', hue: 200, group: 'streak', target: 30, unit: 'days' },
  { id: 'streak-100', name: 'Hundred days', blurb: 'Listen 100 days in a row.', glyph: '💎', hue: 190, group: 'streak', target: 100, unit: 'days' },
  // Time of day, from the counters.
  { id: 'night-owl', name: 'Night owl', blurb: 'Play 25 songs between midnight and 4 AM.', glyph: '🦉', hue: 260, group: 'time', target: 25, unit: 'late plays' },
  { id: 'early-bird', name: 'Early bird', blurb: 'Play 25 songs between 5 and 9 AM.', glyph: '🌅', hue: 38, group: 'time', target: 25, unit: 'early plays' },
  { id: 'all-day', name: 'All-day listener', blurb: 'Listen for 3 hours in one day.', glyph: '☀️', hue: 48, group: 'time', target: 180, unit: 'minutes in a day' },
  // Range: languages and artists, from the counters.
  { id: 'three-tongues', name: 'Three tongues', blurb: 'Play songs in 3 languages.', glyph: '🗣️', hue: 150, group: 'range', target: 3, unit: 'languages' },
  { id: 'polyglot', name: 'Polyglot', blurb: 'Play songs in 5 languages.', glyph: '🌏', hue: 165, group: 'range', target: 5, unit: 'languages' },
  { id: 'explorer', name: 'Explorer', blurb: 'Play 50 different artists.', glyph: '🧭', hue: 210, group: 'range', target: 50, unit: 'artists' },
  { id: 'superfan', name: 'Superfan', blurb: 'Play one artist 100 times.', glyph: '⭐', hue: 42, group: 'range', target: 100, unit: 'plays of one artist' },
  // The library.
  { id: 'collector', name: 'Collector', blurb: 'Like 50 songs.', glyph: '❤️', hue: 345, group: 'library', target: 50, unit: 'likes' },
  { id: 'curator', name: 'Curator', blurb: 'Make 5 playlists.', glyph: '📚', hue: 280, group: 'library', target: 5, unit: 'playlists' },
  // Weekly goals (Settings → Playback → Your goal).
  { id: 'four-weeks', name: 'Four in a row', blurb: 'Meet a weekly goal 4 weeks running.', glyph: '🎯', hue: 0, group: 'goals', target: 4, unit: 'weeks' },
];

export const BADGE_BY_ID: ReadonlyMap<string, BadgeDef> = new Map(BADGES.map((b) => [b.id, b]));

export const GROUP_LABEL: Record<BadgeGroup, string> = {
  listening: 'Listening', streak: 'Streaks', time: 'Time of day', range: 'Range', library: 'Library', goals: 'Goals',
};

/** A badge id as it may travel (backup, profile): short, lower-case, dashes. */
export const BADGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
