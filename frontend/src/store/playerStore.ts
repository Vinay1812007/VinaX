import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { audioEngine, orderedSources } from '@/services/audio/engine';
import {
  setMediaHandlers,
  updateMediaMetadata,
  updatePlaybackState,
  updatePositionState,
} from '@/services/media-session';
import { recordComplete, recordPlay, recordQueueAdd, recordSkip } from '@/services/personalization/updater';
import { checkNotificationOnFirstPlay, haptic, isNativePlatform } from '@/services/native';
import { toast } from './toastStore';
import { useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';
import { useCastStore, castInterceptPlayPause, castInterceptSeek, castMime } from '@/services/cast';
import { bestImage } from '@/utils/images';
import { isValidSong, noteUnavailable, queueAfterClearFrom, reorderQueue, resetSkipGuard, sortQueueTail, type QueueSortKind } from './playerGuards';
import { kidModeOn, stripExplicit } from '@/services/kidMode';
import { getRecommendationContext } from '@/services/recommendation/context';
import { recommendNextSongs } from '@/services/recommendation/engine';

export type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  sleepAt: number | null;
  sleepAfterTrack: boolean;
  /** v5.12.0 — stop after this many more songs finish (0 = off). */
  sleepSongsLeft: number;
  /** v5.12.0 — A-B repeat: loop between these positions (seconds); null = off. */
  loopA: number | null;
  loopB: number | null;
  currentAccent: string | null;
  streamKbps: number | null;
  /** True while following a Listen Together host. */
  followMode: boolean;

  initEngine(): void;
  setSleepSongs(n: number): void;
  setLoopPoint(which: 'A' | 'B'): void;
  clearLoop(): void;
  playQueue(songs: Song[], startIndex?: number): void;
  playSong(song: Song): void;
  playAt(index: number): void;
  enqueue(song: Song): void;
  enqueueNext(song: Song): void;
  enqueueAll(songs: Song[]): void;
  removeAt(index: number): void;
  moveInQueue(from: number, to: number): void;
  /** Package D5 — drop this row and everything after it (future rows only). */
  clearFrom(index: number): void;
  /** Package D5 — reorder everything after the playing song. */
  sortUpcoming(kind: QueueSortKind): void;
  clearPlayed(): void;
  clearQueue(): void;
  togglePlay(): void;
  next(manual?: boolean): void;
  startRadio(song?: Song): void;
  prev(): void;
  seek(seconds: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setRate(r: number): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  setSleepTimer(minutes: number | null): void;
  setSleepAfterTrack(v: boolean): void;
  setCurrentAccent(c: string | null): void;
  setFollowMode(v: boolean): void;
}

const SKIP_THRESHOLD = 0.3;
let autoplayNoticeShown = false;

let engineInitialized = false;
let bridgeChecked = false;

/** If no native setPlaybackState ever succeeds, surface it — loudly. */
function scheduleBridgeCheck(): void {
  if (!isNativePlatform() || bridgeChecked) return;
  bridgeChecked = true;
  window.setTimeout(() => {
    void Promise.all([
      import('@/services/media-session'),
      import('./diagStore'),
    ]).then(([{ getMediaSessionLog }, { useDiagStore }]) => {
      const log = getMediaSessionLog();
      const healthy = log.some((e) => e.ok && e.call.startsWith('setPlaybackState'));
      if (!healthy) {
        const env = log.find((e) => e.call.startsWith('env'));
        const lastErr = log.find((e) => !e.ok);
        useDiagStore.getState().setNotice(
          `Media notification bridge issue — screenshot this: ${env?.call ?? 'env unknown'}${lastErr ? ` | ${lastErr.call}: ${lastErr.detail ?? 'failed'}` : ' | no native call succeeded'}`,
        );
      }
    });
  }, 8000);
}
/** Session-scoped played set: smart shuffle avoids repeats until exhausted. */
const sessionPlayed = new Set<string>();
const RESUME_KEY = 'vinax.resume.v1';
function loadResume(): Record<string, number> {
  try { return JSON.parse(window.localStorage.getItem(RESUME_KEY) || '{}'); } catch { return {}; }
}
function saveResume(id: string, sec: number, duration: number): void {
  try {
    const map = loadResume();
    // Only remember meaningful mid-track positions on longer tracks.
    if (duration > 60 && sec > 20 && sec < duration - 20) map[id] = Math.floor(sec);
    else delete map[id];
    const ids = Object.keys(map);
    if (ids.length > 80) delete map[ids[0]];
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}
let crossfadeArmed = false;
let sleepTimer: number | null = null;
/** Song ids we've already tried to refetch fresh URLs for (avoid loops). */
const refetchedSongs = new Set<string>();
let _lastResumedSec = -1; // throttle: write at most once per 5-second mark
let lastUnavailableToastAt = 0;
let recommendationPromise: Promise<boolean> | null = null;

/** Exactly what persist() writes to localStorage (see partialize). */
type PersistedPlayerState = Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'volume' | 'muted' | 'rate'>;

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      async function appendRecommendations(seed: Song): Promise<boolean> {
        if (recommendationPromise) return recommendationPromise;
        recommendationPromise = (async () => {
          try {
            const { queue } = get();
            const songs = await recommendNextSongs(seed, getRecommendationContext(seed, 'next'), {
              limit: 8,
              excludeIds: queue.map((song) => song.id),
            });
            if (!songs.length) return false;
            const current = get().queue;
            const existing = new Set(current.map((song) => song.id));
            const additions = songs.filter((song) => !existing.has(song.id));
            if (!additions.length) return false;
            set({ queue: [...current, ...additions] });
            return true;
          } catch {
            return false;
          } finally {
            recommendationPromise = null;
          }
        })();
        return recommendationPromise;
      }

      function preloadUpcoming(): void {
        const { queue, index, shuffle } = get();
        if (shuffle) return; // unknown next under shuffle
        const next = queue[index + 1];
        if (!next) return;
        const url = orderedSources(next, useSettingsStore.getState().audioQuality)[0] ?? null;
        audioEngine.preloadNext(url);
      }

      function startTrack(song: Song, autoplay: boolean): void {
        // Reset the resume-write throttle so the first timeupdate on the NEW
        // song can save immediately — without this the previous song's 5s
        // bucket suppresses the initial write on a same-second boundary.
        _lastResumedSec = -1;
        const quality = useSettingsStore.getState().audioQuality;
        audioEngine.load(song, quality, autoplay);
        crossfadeArmed = false;
        if (autoplay && useSettingsStore.getState().resumePlayback) {
          const at = loadResume()[song.id];
          if (at && at > 20) {
            window.setTimeout(() => {
              if (get().queue[get().index]?.id === song.id) {
                audioEngine.seek(at);
                toast(`Resumed from ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`);
              }
            }, 800);
          }
        }
        if (autoplay && useSettingsStore.getState().crossfade) audioEngine.fadeIn(1200);
        updateMediaMetadata(song);
        
        // Cast integration
        const castState = useCastStore.getState();
        if (castState.connected) {
          audioEngine.setVolume(0);
          try {
            const url = orderedSources(song, quality)[0];
            if (url) {
              const mediaInfo = new window.chrome.cast.media.MediaInfo(url, castMime(url));
              mediaInfo.metadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
              mediaInfo.metadata.title = song.title;
              mediaInfo.metadata.artist = song.subtitle;
              mediaInfo.metadata.images = [{ url: bestImage(song.images, 500) }];
              const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
              request.autoplay = autoplay;
              const castSession = window.cast.framework.CastContext.getInstance().getCurrentSession();
              castSession?.loadMedia(request);
            }
          } catch (e) {
            if (import.meta.env.DEV) console.error('Cast startTrack failed:', e);
          }
        }
        
        if (autoplay) {
          sessionPlayed.add(song.id);
          recordPlay(song);
          useHistoryStore.getState().addPlay(song);
          void import('@/utils/streak').then((m) => m.bumpStreak());
          // Android 13+: the playback notification needs this permission.
          void checkNotificationOnFirstPlay(toast);
          scheduleBridgeCheck();
          // Re-assert after the native service finishes binding — first-play
          // updates can otherwise race the service connection.
          window.setTimeout(() => {
            const cur = get();
            if (cur.queue[cur.index]?.id === song.id) {
              updateMediaMetadata(song);
              updatePlaybackState(cur.isPlaying);
            }
          }, 1200);
        }
        preloadUpcoming();
        // Keep a small tail ready for autoplay and playlist continuation. The
        // async fetch never blocks starting the current song.
        if (useSettingsStore.getState().autoplay && get().queue.length - get().index <= 2 && !get().followMode) {
          void appendRecommendations(song);
        }
      }

      function maybeRecordSkip(manual: boolean): void {
        const { queue, index, currentTime, duration } = get();
        const song = queue[index];
        if (manual && song && duration > 0 && currentTime / duration < SKIP_THRESHOLD) {
          recordSkip(song, currentTime);
          void import('@/services/analytics/telemetry').then((m) => m.trackSkip(song));
        }
      }

      function skipUnavailable(): void {
        const now = Date.now();
        if (noteUnavailable()) {
          toast('Sources are struggling right now — pick another song or try again in a moment');
          set({ isPlaying: false, isBuffering: false });
          return;
        }
        if (now - lastUnavailableToastAt > 3000) {
          lastUnavailableToastAt = now;
          toast('Skipping unavailable track');
        }
        if (get().queue.length > 1) get().next(false);
        else set({ isPlaying: false, isBuffering: false });
      }

      function handleEnded(): void {
        resetSkipGuard(); // a track finished — sources are alive
        const { queue, index, duration, repeat, sleepAt, sleepAfterTrack, sleepSongsLeft } = get();
        const song = queue[index];
        if (song) {
          recordComplete(song, duration);
          useHistoryStore.getState().markCompleted(song.id);
        }
        // v5.12.0 — sleep after N songs counts down here; the last one stops.
        const songsDone = sleepSongsLeft > 0 ? sleepSongsLeft - 1 : 0;
        if (sleepSongsLeft > 0) set({ sleepSongsLeft: songsDone });
        if (sleepAfterTrack || (sleepSongsLeft === 1) || (sleepAt && Date.now() >= sleepAt)) {
          set({ sleepAt: null, sleepAfterTrack: false, sleepSongsLeft: 0, isPlaying: false });
          audioEngine.pause();
          toast('Sleep timer: playback stopped');
          return;
        }
        if (repeat === 'one' && song) {
          audioEngine.seek(0);
          audioEngine.play();
          return;
        }
        get().next(false);
      }

      /** Smart shuffle: random among queue songs not yet played this session. */
      function pickShuffleIndex(): number {
        const { queue, index } = get();
        const unplayed = queue
          .map((s, i) => ({ s, i }))
          .filter(({ s, i }) => i !== index && !sessionPlayed.has(s.id));
        if (!unplayed.length && get().repeat !== 'all') return queue.length;
        if (!unplayed.length) {
          sessionPlayed.clear();
          sessionPlayed.add(queue[index].id);
        }
        const pool = unplayed.length ? unplayed : queue.map((s, i) => ({ s, i })).filter(({ i }) => i !== index);
        return pool[Math.floor(Math.random() * pool.length)]?.i ?? index;
      }

      function playCurrent(): void {
        const { queue, index, isPlaying } = get();
        const song = queue[index];
        if (!song || isPlaying) return;
        if (audioEngine.currentSongId !== song.id) {
          startTrack(song, true);
          return;
        }
        if (castInterceptPlayPause()) {
          set({ isPlaying: true });
          return;
        }
        audioEngine.play();
      }

      function pauseCurrent(): void {
        if (!get().isPlaying) return;
        if (castInterceptPlayPause()) {
          set({ isPlaying: false });
          return;
        }
        audioEngine.pause();
      }

      return {
        queue: [],
        index: 0,
        isPlaying: false,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        repeat: 'off',
        shuffle: false,
        volume: 1,
        muted: false,
        rate: 1,
        sleepAt: null,
        sleepAfterTrack: false,
        sleepSongsLeft: 0,
        loopA: null,
        loopB: null,
        currentAccent: null,
        streamKbps: null,
        followMode: false,

        initEngine: () => {
          if (engineInitialized) return;
          engineInitialized = true;
          audioEngine.init({
            onTime: (currentTime, duration) => {
              set({ currentTime, duration });
              // v5.17.0 — sleep timer: fade the last 30 s toward silence and
              // stop on the minute instead of waiting for the song to end.
              const sleepAtNow = get().sleepAt;
              if (sleepAtNow) {
                const left = sleepAtNow - Date.now();
                if (left <= 0) {
                  set({ sleepAt: null, sleepAfterTrack: false, sleepSongsLeft: 0, isPlaying: false });
                  audioEngine.pause();
                  audioEngine.setVolume(get().muted ? 0 : get().volume);
                  toast('Sleep timer: playback stopped');
                  return;
                }
                if (left < 30_000 && !get().muted) audioEngine.setVolume(Math.max(0.04, get().volume * (left / 30_000)));
              }
              // v5.12.0 — A-B repeat: bounce back to A the moment B passes.
              const { loopA, loopB } = get();
              if (loopA != null && loopB != null && loopB > loopA && currentTime >= loopB) audioEngine.seek(loopA);
              updatePositionState(duration, currentTime, get().rate);
              const playing = get().queue[get().index];
              const _sec5 = Math.floor(currentTime / 5); if (playing && _sec5 !== _lastResumedSec && Math.floor(currentTime) % 5 === 0) { _lastResumedSec = _sec5; saveResume(playing.id, currentTime, duration); }
              // Crossfade tail: ramp the last seconds toward silence; the next
              // track fades in on start, giving a smooth overlap-style blend.
              const { repeat, queue, index } = get();
              const hasNext = repeat === 'all' || index < queue.length - 1;
              if (
                useSettingsStore.getState().crossfade &&
                !crossfadeArmed &&
                hasNext &&
                repeat !== 'one' &&
                duration > useSettingsStore.getState().crossfadeSeconds * 2 &&
                duration - currentTime <= useSettingsStore.getState().crossfadeSeconds
              ) {
                crossfadeArmed = true;
                audioEngine.fadeOut((duration - currentTime) * 1000);
              }
            },
            onPlayState: (isPlaying) => {
              set({ isPlaying });
              updatePlaybackState(isPlaying);
              // Re-push metadata with every state flip: if an earlier attempt
              // raced the service bind, this heals the notification.
              const current = get().queue[get().index];
              if (current) updateMediaMetadata(current);
            },
            onBuffering: (isBuffering) => set({ isBuffering }),
            onSource: (kbps) => set({ streamKbps: kbps }),
            onBlocked: () => {
              if (!autoplayNoticeShown) {
                autoplayNoticeShown = true;
                toast('Tap play to start');
              }
            },
            onEnded: handleEnded,
            onFatalError: (songId) => {
              // Search-result download URLs are sometimes stale/empty. Before
              // giving up, fetch the song's detail record for fresh URLs and
              // retry once. Only skip (with a single, debounced toast) if that
              // also fails.
              const cur = get().queue[get().index];
              if (cur && cur.id === songId && !refetchedSongs.has(songId)) {
                refetchedSongs.add(songId);
                if (refetchedSongs.size > 200) refetchedSongs.clear();
                void import('@/services/api')
                  .then(({ getSong }) => getSong(songId))
                  .then((fresh) => {
                    const urls = orderedSources(fresh, useSettingsStore.getState().audioQuality);
                    if (urls.length && get().queue[get().index]?.id === songId) {
                      const ok = audioEngine.reloadWithSources(urls);
                      if (ok) return;
                    }
                    skipUnavailable();
                  })
                  .catch(() => skipUnavailable());
                return;
              }
              skipUnavailable();
            },
          });
          const { volume, muted, rate } = get();
          audioEngine.setVolume(volume);
          audioEngine.setMuted(muted);
          audioEngine.setRate(rate);
          void setMediaHandlers({
            play: playCurrent,
            pause: pauseCurrent,
            next: () => get().next(true),
            prev: () => get().prev(),
            seekTo: (s) => get().seek(s),
            seekBy: (d) => get().seek(Math.max(0, get().currentTime + d)),
          });
          // Prefill the always-on media notification with the restored queue's
          // current song (instead of a blank panel) once the service binds.
          const restored = get().queue[get().index];
          if (restored) {
            window.setTimeout(() => {
              updateMediaMetadata(restored);
              updatePlaybackState(false);
            }, 1500);
          }
        },

        playQueue: (songs, startIndex = 0) => {
          if (!songs.length) return;
          const selectedIndex = Math.min(Math.max(0, startIndex), songs.length - 1);
          const seed = songs[selectedIndex];
          // C2 — kid mode: an explicit-flagged song never starts playback.
          if (seed.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          resetSkipGuard(); // manual play — the user vouches for the sources
          const queue = stripExplicit(songs);
          const index = queue.indexOf(seed);
          sessionPlayed.clear();
          set({ queue: [...queue], index, currentTime: 0, loopA: null, loopB: null });
          startTrack(seed, true);
        },

        playSong: (song) => get().playQueue([song], 0),
        setSleepSongs: (n) => set({ sleepSongsLeft: Math.max(0, Math.round(n)), sleepAfterTrack: false, sleepAt: null }),
        setLoopPoint: (which) => {
          const { currentTime, loopA, loopB } = get();
          if (which === 'A') set({ loopA: currentTime, loopB: loopB != null && loopB > currentTime ? loopB : null });
          else if (loopA != null && currentTime > loopA + 0.5) set({ loopB: currentTime });
          else set({ loopA: Math.max(0, currentTime - 10), loopB: currentTime });
        },
        clearLoop: () => set({ loopA: null, loopB: null }),
        playAt: (index) => {
          const { queue } = get();
          if (index < 0 || index >= queue.length) return;
          resetSkipGuard(); // manual play
          maybeRecordSkip(true);
          set({ index, currentTime: 0, loopA: null, loopB: null });
          startTrack(queue[index], true);
        },

        enqueue: (song) => {
          if (song.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          const { queue } = get();
          if (queue.some((s) => s.id === song.id)) {
            toast('Already in queue');
            return;
          }
          recordQueueAdd(song);
          set({ queue: [...queue, song] });
          toast('Added to queue');
          if (queue.length === 0) get().playQueue([song]);
        },

        enqueueAll: (songs) => {
          const existing = new Set(get().queue.map((s) => s.id));
          const fresh = stripExplicit(songs).filter((s) => !existing.has(s.id));
          if (!fresh.length) {
            toast('Already in queue');
            return;
          }
          set({ queue: [...get().queue, ...fresh] });
          toast(`Added ${fresh.length} songs to queue`);
          if (get().queue.length === fresh.length) startTrack(fresh[0], true);
        },

        enqueueNext: (song) => {
          if (song.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          const { queue, index } = get();
          recordQueueAdd(song);
          // If the song "play next" is invoked on already IS the currently
          // playing track, do nothing — filtering it out and reinserting would
          // corrupt the index (audit finding H2).
          const currentSong = queue[index];
          if (currentSong && currentSong.id === song.id) {
            toast('Already playing');
            return;
          }
          const filtered = queue.filter((s) => s.id !== song.id);
          // The current song's position in the queue can shift when the
          // enqueued song was already earlier in the queue. Realign `index`
          // to the same song's new position before choosing the insert slot,
          // otherwise the store points to a different track than the audio
          // element is playing (audit finding H2).
          const newIndex = currentSong ? filtered.indexOf(currentSong) : index;
          const insertAt = Math.min(newIndex + 1, filtered.length);
          set({
            queue: [...filtered.slice(0, insertAt), song, ...filtered.slice(insertAt)],
            index: newIndex,
          });
          toast('Playing next');
        },

        removeAt: (i) => {
          const { queue, index, isPlaying } = get();
          if (i < 0 || i >= queue.length) return;
          const removingCurrent = i === index;
          const next = queue.filter((_, idx) => idx !== i);
          if (next.length === 0) {
            audioEngine.pause();
            set({ queue: [], index: 0, isPlaying: false, currentTime: 0, duration: 0 });
            return;
          }
          const newIndex = i < index ? index - 1 : Math.min(index, next.length - 1);
          set({ queue: next, index: newIndex });
          if (removingCurrent) {
            // The playing track was removed — load whatever now occupies the
            // slot (keeping play/pause state) so audio and UI stay in sync.
            set({ currentTime: 0 });
            startTrack(next[newIndex], isPlaying);
          }
        },

        moveInQueue: (from, to) => {
          const { queue, index } = get();
          const moved = reorderQueue(queue, index, from, to);
          if (moved) set(moved);
        },

        sortUpcoming: (kind) => {
          const { queue, index } = get();
          if (queue.length - index < 3) return; // nothing worth sorting
          const head = queue.slice(0, index + 1);
          set({ queue: [...head, ...sortQueueTail(queue.slice(index + 1), kind)] });
        },

        clearFrom: (i) => {
          const { queue, index } = get();
          // Only the future can be swept — the playing song and history stay.
          const next = queueAfterClearFrom(queue, index, i);
          if (!next) return;
          const dropped = queue.length - next.length;
          set({ queue: next });
          toast(`Cleared ${dropped} upcoming ${dropped === 1 ? 'song' : 'songs'}`);
        },

        clearPlayed: () => {
          const { queue, index } = get();
          if (index <= 0) return;
          set({ queue: queue.slice(index), index: 0 });
          toast(`Removed ${index} played songs`);
        },

        clearQueue: () => {
          if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null; }
          refetchedSongs.clear();
          audioEngine.pause();
          set({ queue: [], index: 0, isPlaying: false, currentTime: 0, duration: 0 });
        },

        togglePlay: () => {
          const { isPlaying, queue, index } = get();
          const song = queue[index];
          if (!song) return;
          haptic('light');
          if (audioEngine.currentSongId !== song.id) {
            startTrack(song, true);
            return;
          }
          if (castInterceptPlayPause()) {
            set({ isPlaying: !isPlaying });
            return;
          }
          if (isPlaying) audioEngine.pause();
          else audioEngine.play();
        },

        next: (manual = false) => {
          const { queue, index, shuffle, repeat } = get();
          if (!queue.length) return;
          if (manual) haptic('light');
          maybeRecordSkip(manual);
          let nextIndex: number;
          if (shuffle && queue.length > 1) {
            nextIndex = pickShuffleIndex();
          } else {
            nextIndex = index + 1;
          }
          if (nextIndex >= queue.length) {
            if (repeat === 'all') {
              nextIndex = 0;
            } else {
              const current = queue[index];
              if (current && useSettingsStore.getState().autoplay && !get().followMode) {
                // Pause immediately so the existing player contract remains
                // synchronous; resume automatically once the async tail is
                // available.
                set({ isPlaying: false });
                audioEngine.pause();
                void appendRecommendations(current).then((added) => {
                  if (added) get().next(false);
                  else { set({ isPlaying: false }); }
                });
              } else {
                set({ isPlaying: false });
                audioEngine.pause();
              }
              return;
            }
          }
          set({ index: nextIndex, currentTime: 0 });
          startTrack(queue[nextIndex], true);
        },

        startRadio: (song) => {
          const seed = song ?? get().queue[get().index];
          if (!seed) return;
          const queue = stripExplicit([seed]);
          if (!queue.length) return;
          sessionPlayed.clear();
          set({ queue, index: 0, currentTime: 0, isPlaying: true });
          startTrack(seed, true);
          void appendRecommendations(seed);
        },

        prev: () => {
          const { queue, index, currentTime } = get();
          if (!queue.length) return;
          haptic('light');
          if (currentTime > 3 || index === 0) {
            audioEngine.seek(0);
            return;
          }
          set({ index: index - 1, currentTime: 0 });
          startTrack(queue[index - 1], true);
        },

        seek: (seconds) => {
          if (castInterceptSeek(seconds)) {
            set({ currentTime: seconds });
            return;
          }
          // A seek (esp. backward) while the crossfade tail is ramping would
          // otherwise leave the track stuck at silence — un-arm and restore.
          if (crossfadeArmed) {
            crossfadeArmed = false;
            audioEngine.setVolume(get().volume);
          }
          audioEngine.seek(seconds);
          set({ currentTime: seconds });
        },

        setVolume: (v) => {
          const volume = Math.min(1, Math.max(0, v));
          audioEngine.setVolume(volume);
          set({ volume });
          if (volume > 0) audioEngine.setMuted(false);
        },

        toggleMute: () => {
          const muted = !get().muted;
          audioEngine.setMuted(muted);
          set({ muted });
        },

        setRate: (rate) => {
          audioEngine.setRate(rate);
          set({ rate });
        },

        cycleRepeat: () => {
          const order: RepeatMode[] = ['off', 'all', 'one'];
          const next = order[(order.indexOf(get().repeat) + 1) % order.length];
          set({ repeat: next });
        },

        toggleShuffle: () => set({ shuffle: !get().shuffle }),

        setSleepTimer: (minutes) => {
          if (sleepTimer != null) {
            window.clearTimeout(sleepTimer);
            sleepTimer = null;
          }
          set({ sleepAt: minutes == null ? null : Date.now() + minutes * 60_000, sleepAfterTrack: false });
          if (minutes != null) {
            toast(`Sleeping in ${minutes} min`);
            sleepTimer = window.setTimeout(() => {
              // Gentle 8s fade to silence, then pause.
              audioEngine.fadeOutAndPause(8000, () => {
                set({ isPlaying: false, sleepAt: null });
                toast('Sleep timer: paused');
              });
            }, minutes * 60_000);
          }
        },

        setSleepAfterTrack: (v) => {
          if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null; }
          set({ sleepAfterTrack: v, sleepAt: null });
          if (v) toast('Will stop after this song');
        },

        setCurrentAccent: (currentAccent) => set({ currentAccent }),
        setFollowMode: (followMode) => set({ followMode }),
      };
    },
    {
      name: KEYS.player,
      version: 1,
      storage: createJSONStorage(() => window.localStorage),
      partialize: (s): PersistedPlayerState => ({
        queue: s.queue,
        index: s.index,
        repeat: s.repeat,
        shuffle: s.shuffle,
        volume: s.volume,
        muted: s.muted,
        rate: s.rate,
      }),
      // Pre-v1 records share this shape — real validation lives in merge().
      migrate: (persisted) => persisted as PersistedPlayerState,
      // localStorage is untrusted input: drop malformed queue entries and clamp
      // scalars so a corrupt/legacy record can never brick the player (DQA-06).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedPlayerState>;
        const queue = Array.isArray(p.queue) ? p.queue.filter(isValidSong) : [];
        const rawIndex = typeof p.index === 'number' && Number.isFinite(p.index) ? Math.floor(p.index) : 0;
        const num = (v: unknown, lo: number, hi: number, d: number): number =>
          typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
        return {
          ...current,
          repeat: p.repeat === 'one' || p.repeat === 'all' ? p.repeat : 'off',
          shuffle: p.shuffle === true,
          volume: num(p.volume, 0, 1, 1),
          muted: p.muted === true,
          rate: num(p.rate, 0.5, 2, 1),
          queue,
          index: queue.length ? Math.min(Math.max(0, rawIndex), queue.length - 1) : 0,
        };
      },
    },
  ),
);

export function useCurrentSong(): Song | null {
  return usePlayerStore((s) => s.queue[s.index] ?? null);
}
