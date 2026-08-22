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
import { dedupeSongs, isValidSong, normTitle, noteUnavailable, resetSkipGuard } from './playerGuards';
import { tuneScoreAdjust, type TuneIntent } from '@/services/recommendation/tune';
import { inferMood } from '@/services/recommendation/mood';

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
  currentAccent: string | null;
  streamKbps: number | null;
  /** True while following a Listen Together host — suppresses AI auto-extend. */
  followMode: boolean;
  /** Active 'tune this queue' intent, reshaping the AI continuation. */
  tuneIntent: TuneIntent | null;
  /** Who built the latest continuation: the AI curator or instant local picks. */
  queueSource: 'ai' | 'instant';

  initEngine(): void;
  playQueue(songs: Song[], startIndex?: number): void;
  tuneQueue(intent: TuneIntent): void;
  playSong(song: Song): void;
  playAt(index: number): void;
  startRadio(song: Song): void;
  enqueue(song: Song): void;
  enqueueNext(song: Song): void;
  enqueueAll(songs: Song[]): void;
  removeAt(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearPlayed(): void;
  clearQueue(): void;
  togglePlay(): void;
  next(manual?: boolean): void;
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
let appendPromise: Promise<boolean> | null = null;
let sleepTimer: number | null = null;
/** Song ids we've already tried to refetch fresh URLs for (avoid loops). */
const refetchedSongs = new Set<string>();
let _lastResumedSec = -1; // throttle: write at most once per 5-second mark
let lastUnavailableToastAt = 0;

/** Exactly what persist() writes to localStorage (see partialize). */
type PersistedPlayerState = Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'volume' | 'muted' | 'rate'>;

// Songs already offered by "Tune this queue" presses this session — skipped
// on later presses so every tap deals fresh cards instead of the same
// deterministic top picks. Resets when the pool runs thin.
const tuneSuggested = new Set<string>();

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
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

        // Endless, automatic continuation: within 2 tracks of the end, extend
        // the queue with similar picks (AI DJ when configured, else local).
        // Playing a single song becomes an instant AI-built queue.
        if (autoplay && useSettingsStore.getState().autoqueueSimilar) {
          const cur = get();
          if (cur.index >= cur.queue.length - 2) {
            void extendQueue(song).catch(() => false);
          }
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

      async function appendSimilar(seed: Song): Promise<boolean> {
        const [{ similarToSong }, { loadProfile }, { useLibraryStore }, { resolvedRegion }] =
          await Promise.all([
            import('@/services/recommendation/engine'),
            import('@/services/personalization/storage'),
            import('./libraryStore'),
            import('./settingsStore'),
          ]);
        const settings = useSettingsStore.getState();
        const profile = loadProfile();
        const queueIds = get().queue.map((s) => s.id);
        const ctx = {
          profile,
          salt: Math.floor(Math.random() * 1_000_000),
          hour: new Date().getHours(),
          region: resolvedRegion(),
          pinnedLanguages: settings.pinnedLanguages,
          mutedLanguages: settings.mutedLanguages,
          intensity: settings.recommendationIntensity,
          favorites: useLibraryStore.getState().favorites,
          history: useHistoryStore.getState().entries,
          tuneIntent: get().tuneIntent,
          sessionMood: inferMood(seed),
        };
        // Anti-repeat: never re-queue what's already queued OR played in the
        // last ~60 tracks (profile.recentSongIds).
        const exclude = new Set<string>([...queueIds, ...profile.recentSongIds]);
        let scored = await similarToSong(seed.id, ctx, exclude);
        // Safety net: if the strict filter empties the pool, relax to just the
        // current queue so playback never stalls (older tracks may resurface,
        // but it won't loop the same handful).
        if (!scored.length) {
          scored = await similarToSong(seed.id, ctx, new Set(queueIds));
        }
        const existing = new Set(queueIds);
        const existingTitles = new Set(get().queue.map(normTitle).filter((t) => t.length > 0));
        // Enforce language: the continuation must match the playing song's
        // language (or the single pinned language). Keeps the queue on-language
        // even if the AI or upstream search drifts. Relaxes only if nothing
        // on-language is available, so playback never stalls.
        const seedLang = seed.language && seed.language !== 'unknown' ? seed.language : null;
        const targetLang = seedLang ?? (settings.pinnedLanguages.length === 1 ? settings.pinnedLanguages[0] : null);
        // Apply the active 'tune this queue' intent deterministically (era /
        // language nudges) on top of the AI ordering.
        const tune = ctx.tuneIntent ?? null;
        if (tune) {
          // Every press must feel like a new hand: random jitter rotates the
          // mid-field, and songs offered by earlier presses are skipped until
          // the pool runs thin — then the memory clears and rotation restarts.
          for (const sc of scored) sc.score += tuneScoreAdjust(sc.candidate.song, tune, seedLang) + Math.random() * 6;
          scored.sort((a, b) => b.score - a.score);
          const unseen = scored.filter((sc) => !tuneSuggested.has(sc.candidate.song.id));
          if (unseen.length >= 6) scored = unseen;
          else tuneSuggested.clear();
        }
        const effectiveTargetLang = tune === 'different-language' ? null : targetLang;
        let pool = scored.map((s) => s.candidate.song).filter((s) => !existing.has(s.id) && !existingTitles.has(normTitle(s)));
        if (effectiveTargetLang) {
          // HARD on-language gate: never queue a different language than the
          // playing song's (or the single pinned) language.
          pool = pool.filter((s) => s.language === effectiveTargetLang);
        } else if (settings.pinnedLanguages.length > 1) {
          const pinnedSet = new Set(settings.pinnedLanguages);
          const onPinned = pool.filter((s) => s.language != null && pinnedSet.has(s.language));
          if (onPinned.length) pool = onPinned;
        }
        pool = dedupeSongs(pool);
        const fresh = pool.slice(0, 6);
        if (tune) for (const s of fresh) tuneSuggested.add(s.id);
        // Top up from a direct on-language search so the queue stays 100% in the
        // target language even when the recommender returns too few on-language tracks.
        // Always guarantee a non-empty queue: when suggestions + AI come up short
        // (e.g. a brand-new song with no catalog 'related' tracks), top up from a
        // trending search in the best available language, relaxing to any
        // non-muted track as a last resort so the queue never ends abruptly.
        if (fresh.length < 6) {
          try {
            const [{ searchSongsPage }, { trendingSeed }] = await Promise.all([
              import('@/services/api'),
              import('@/constants/seeds'),
            ]);
            const mutedSet = new Set(settings.mutedLanguages);
            const fillLang =
              tune === 'different-language'
                ? (settings.pinnedLanguages.find((l) => l !== seedLang) ?? null)
                : (effectiveTargetLang ?? seedLang ?? settings.pinnedLanguages[0] ?? null);
            const have = new Set<string>([...existing, ...profile.recentSongIds, ...fresh.map((s) => s.id)]);
            const salt = Math.floor(Math.random() * 1_000_000);
            const query = (p: number): string => trendingSeed(fillLang ?? 'hindi', salt + p);
            // Pass 1: prefer the fill language.
            for (const page of [1 + (salt % 4), 1, 2, 3]) {
              if (fresh.length >= 6) break;
              const extra = await searchSongsPage(query(page), page, 20);
              for (const s of extra) {
                if (fresh.length >= 6) break;
                if (have.has(s.id)) continue;
                if (s.language != null && mutedSet.has(s.language)) continue;
                if (fillLang && s.language !== fillLang) continue;
                fresh.push(s);
                have.add(s.id);
              }
            }
            // Pass 2 (last resort): accept any non-muted track so we never stall.
            if (!fresh.length) {
              const extra = await searchSongsPage(query(0), 1, 20);
              for (const s of extra) {
                if (fresh.length >= 6) break;
                if (have.has(s.id)) continue;
                if (s.language != null && mutedSet.has(s.language)) continue;
                fresh.push(s);
                have.add(s.id);
              }
            }
          } catch {
            /* best-effort top-up */
          }
        }
        const before = get().queue.length;
        const { lastQueueSource } = await import('@/services/recommendation/engine');
        const combined = dedupeSongs([...get().queue, ...fresh]);
        if (combined.length > before) set({ queue: combined, queueSource: lastQueueSource() });
        return combined.length > before;
      }

      /** Coalesce concurrent queue-extend requests into a single in-flight call
          so the proactive (near-end) and end-of-queue paths never double-append. */
      function extendQueue(seed: Song, force = false): Promise<boolean> {
        // While following a host, never build our own queue — the host drives.
        if (get().followMode) return Promise.resolve(false);
        if (!force && appendPromise) return appendPromise;
        appendPromise = appendSimilar(seed).finally(() => {
          appendPromise = null;
        });
        return appendPromise;
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
        const { queue, index, duration, repeat, sleepAt, sleepAfterTrack } = get();
        const song = queue[index];
        if (song) {
          recordComplete(song, duration);
          useHistoryStore.getState().markCompleted(song.id);
        }
        if (sleepAfterTrack || (sleepAt && Date.now() >= sleepAt)) {
          set({ sleepAt: null, sleepAfterTrack: false, isPlaying: false });
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
        currentAccent: null,
        streamKbps: null,
        followMode: false,
        tuneIntent: null,
        queueSource: 'ai',

        initEngine: () => {
          if (engineInitialized) return;
          engineInitialized = true;
          audioEngine.init({
            onTime: (currentTime, duration) => {
              set({ currentTime, duration });
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
          // AI DJ drives the queue on EVERY play: start the tapped song and let
          // the AI build the continuation, instead of following the source list.
          const seed = songs[Math.min(Math.max(0, startIndex), songs.length - 1)];
          resetSkipGuard(); // manual play — the user vouches for the sources
          set({ queue: [seed], index: 0, currentTime: 0 });
          startTrack(seed, true);
          void extendQueue(seed).catch(() => false);
        },

        playSong: (song) => get().playQueue([song], 0),
        tuneQueue: (intent) => {
          const { queue, index } = get();
          const current = queue[index];
          if (!current) return;
          // Keep what's played + the current track; rebuild the rest with the intent.
          set({ tuneIntent: intent, queue: queue.slice(0, index + 1) });
          void extendQueue(current, true).catch(() => false);
        },

        playAt: (index) => {
          const { queue } = get();
          if (index < 0 || index >= queue.length) return;
          resetSkipGuard(); // manual play
          maybeRecordSkip(true);
          set({ index, currentTime: 0 });
          startTrack(queue[index], true);
        },

        startRadio: (song) => {
          resetSkipGuard(); // manual play
          set({ queue: [song], index: 0, currentTime: 0, shuffle: false });
          startTrack(song, true);
          toast(`Radio started from “${song.title}”`);
          void appendSimilar(song).catch(() => {
            toast("Could not load similar tracks");
          });
        },

        enqueue: (song) => {
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
          const fresh = songs.filter((s) => !existing.has(s.id));
          if (!fresh.length) {
            toast('Already in queue');
            return;
          }
          set({ queue: [...get().queue, ...fresh] });
          toast(`Added ${fresh.length} songs to queue`);
          if (get().queue.length === fresh.length) startTrack(fresh[0], true);
        },

        enqueueNext: (song) => {
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
          if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
          const next = [...queue];
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          let newIndex = index;
          if (index === from) newIndex = to;
          else if (from < index && to >= index) newIndex = index - 1;
          else if (from > index && to <= index) newIndex = index + 1;
          set({ queue: next, index: newIndex });
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
            // Shuffled through everything → pull in fresh DJ picks before
            // re-shuffling, so shuffle never loops the same handful of songs.
            const exhausted = !queue.some((s, i) => i !== index && !sessionPlayed.has(s.id));
            if (exhausted && !manual && useSettingsStore.getState().autoqueueSimilar) {
              void extendQueue(queue[index])
                .catch(() => false)
                .then(() => {
                  const idx = pickShuffleIndex();
                  set({ index: idx, currentTime: 0 });
                  startTrack(get().queue[idx], true);
                });
              return;
            }
            nextIndex = pickShuffleIndex();
          } else {
            nextIndex = index + 1;
          }
          if (nextIndex >= queue.length) {
            if (repeat === 'all') {
              nextIndex = 0;
            } else if (useSettingsStore.getState().autoqueueSimilar && !manual) {
              const current = queue[index];
              void extendQueue(current).catch(() => {
                toast("Could not load similar tracks");
                return false;
              }).then((added) => {
                if (added) get().next(false);
                else {
                  set({ isPlaying: false });
                  audioEngine.pause();
                }
              });
              return;
            } else {
              set({ isPlaying: false });
              audioEngine.pause();
              return;
            }
          }
          set({ index: nextIndex, currentTime: 0 });
          startTrack(queue[nextIndex], true);
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
