import type { Song } from '@/types';

/**
 * The few podcast helpers the first load needs (the player store and the
 * taste updater). Kept apart from paths.ts, whose route helpers pull in
 * utils/slug, so these stay a few hundred bytes and nothing more rides the
 * first load. paths.ts re-exports them for everything else.
 */

/**
 * An episode is a Song whose only audio is the catalogue's `original` file
 * (songs come as 12–320 kbps variants). It survives a reload of the queue,
 * where nothing else marks it.
 */
export function isEpisode(song: Pick<Song, 'audio'>): boolean {
  // A song saved without its streams (an old favourite) is not an episode, and never throws here.
  return Array.isArray(song.audio) && song.audio.length > 0 && song.audio.every((a) => a.quality === 'original');
}

/**
 * Where each podcast episode's place and "played" mark live (features/podcasts/progress.ts),
 * apart from the songs' resume map so music listening never pushes them out.
 */
export const EPISODE_PROGRESS_KEY = 'vinax.podcast.progress.v1';

/**
 * The entry the player's 80-place song resume map drops when it is full: the
 * oldest one that is not a podcast episode's (`episodesRaw` is the stored
 * episode list, read as text: its keys are episode ids).
 */
export function resumeEvictee(ids: readonly string[], episodesRaw: string): string {
  return ids.find((id) => !episodesRaw.includes(`"${id}":{`)) ?? ids[0];
}
