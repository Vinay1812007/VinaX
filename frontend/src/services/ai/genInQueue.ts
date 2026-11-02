import type { Song } from '@/types';
import { onPlaybackEvent } from '@/services/playback/session';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useDownloadsStore } from '@/store/downloadsStore';
import { generateLike, generationAvailability, isGeneratedSong, MAX_SEC, QUEUE_MIN_SEC } from './songGen';

/**
 * 1.4 — generated songs in the queue.
 *
 *  - "Add a generated song to my queues" (Settings → Recommendations, off by
 *    default): after an automatic stretch enters the queue, one new song in the
 *    feel of that stretch is made and placed among its automatic songs. One at a
 *    time, within the daily quota, and only while song making is available.
 *  - Never repeat's last step: when nothing unheard is left, a new song is made
 *    and played instead of stopping (`fillWithGenerated`).
 *  - Saved means kept: a generated song the listener likes or adds to a
 *    playlist is copied to the device through the ordinary saved-songs path,
 *    because its audio on the server lasts only a day.
 */

let installed = false;
let busy = false;

const clampSec = (s: Song): number => Math.max(QUEUE_MIN_SEC, Math.min(MAX_SEC, Math.round(s.duration ?? 150)));

async function addOneGenerated(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const avail = await generationAvailability();
    if (!avail.available || avail.remaining <= 0) return;
    const before = usePlayerStore.getState();
    const source = before.autoTail()[0] ?? before.queue[before.index];
    if (!source || isGeneratedSong(source)) return;
    const made = await generateLike(source, { durationSec: clampSec(source), minSec: QUEUE_MIN_SEC });
    if ('error' in made || !useSettingsStore.getState().genInQueue) return;
    const now = usePlayerStore.getState();
    const tail = now.autoTail();
    // Among the automatic songs, never first: the listener's stretch opens with the songs VinaX found.
    const at = Math.min(2, tail.length);
    now.replaceAutoTail([...tail.slice(0, at), made.song, ...tail.slice(at)]);
  } finally {
    busy = false;
  }
}

/**
 * Never repeat found nothing unheard: make a new song in the feel of `seed`,
 * put it at the end of the queue, and play it if the queue had stopped there.
 * Resolves true when a song went in.
 */
export async function fillWithGenerated(seed: Song): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    const avail = await generationAvailability();
    if (!avail.available || avail.remaining <= 0) return false;
    const made = await generateLike(seed, { durationSec: clampSec(seed), minSec: QUEUE_MIN_SEC });
    if ('error' in made) return false;
    const st = usePlayerStore.getState();
    const wasAtEnd = st.index >= st.queue.length - 1;
    st.replaceAutoTail([...st.autoTail(), made.song]);
    const after = usePlayerStore.getState();
    if (wasAtEnd && !after.isPlaying && after.queue[after.queue.length - 1]?.id === made.song.id) after.playAt(after.queue.length - 1);
    return true;
  } finally {
    busy = false;
  }
}

function savedGenerated(state: ReturnType<typeof useLibraryStore.getState>): Song[] {
  const lists = (state as unknown as { playlists?: Array<{ songs?: Song[] }> }).playlists ?? [];
  return [...state.favorites, ...lists.flatMap((p) => p.songs ?? [])].filter(isGeneratedSong);
}

export function installGeneratedInQueue(): void {
  if (installed) return;
  installed = true;
  onPlaybackEvent((e) => {
    if (e.kind !== 'served' || e.n <= 0 || !useSettingsStore.getState().genInQueue) return;
    void addOneGenerated();
  });
  useLibraryStore.subscribe((state, prev) => {
    const before = new Set(savedGenerated(prev).map((s) => s.id));
    const added = savedGenerated(state).filter((s) => !before.has(s.id) && !useDownloadsStore.getState().items[s.id]);
    if (!added.length) return;
    void import('@/services/downloads').then(({ downloadSong }) => {
      for (const s of added) void downloadSong(s);
    }).catch(() => undefined);
  });
}

/** Tests. */
export function resetGeneratedInQueue(): void {
  busy = false;
}
