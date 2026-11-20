import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { createDedupedStorage, getLocal, setLocal } from '@/services/storage/local';
import { audioEngine, orderedSources } from '@/services/audio/engine';
import {
  setMediaHandlers,
  updateMediaMetadata,
  updatePlaybackState,
  updatePositionState,
} from '@/services/media-session';
import { recordComplete, recordPlay, recordQueueAdd, recordSkip } from '@/services/personalization/updater';
import { checkNotificationOnFirstPlay, haptic, isNativePlatform } from '@/services/native';
import { requireAccount } from '@/services/auth/gate';
import { toast, toastNavigate } from './toastStore';
import { tr } from '@/i18n';
import { useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';
import { useCastStore, castInterceptPlayPause, castInterceptSeek, castInterceptVolume, castLoadSong } from '@/services/cast';
import { bestImage } from '@/utils/images';
import { crossfadePlan, isValidSong, noteUnavailable, resetSkipGuard } from './playerGuards';
import { useTogether } from '@/services/together/session';
import { kidModeOn, stripExplicit } from '@/services/kidMode';
import { NEXT_DEADLINE_MS, NEXT_URGENT_DEADLINE_MS } from '@/services/recommendation/deadlines';
import { noteSessionEvent } from '@/services/personalization/sessionIntent';
import { EPISODE_PROGRESS_KEY, isEpisode, resumeEvictee } from '@/features/podcasts/episode';
import {
  addToQueue,
  alignRuns,
  appendAutoplay,
  clearQueued,
  contextFromPage,
  dropAutoplay,
  dropFromAutoplay,
  isQueueContext,
  isQueued,
  jumpTo,
  moveEntry,
  normalize,
  removeEntry,
  repeatList,
  shuffleOff,
  shuffleOn,
  startList,
  trimPlayed,
  upcoming,
  type QueueContext,
  type QueueRun,
  type QueueSnapshot,
} from './queueRules';
import {
  creditTick,
  emitPlaybackEvent,
  isCompletion,
  isEarlyLeave,
  newPlaybackInstance,
  noteSeek,
  playThreshold,
  type AutoEntryMeta,
  type PlaybackEndReason,
  type PlaybackInstance,
} from '@/services/playback/session';

export type RepeatMode = 'off' | 'one' | 'all';

/**
 * 1.3 — a catalogue station's own continuation (features/radio/stations):
 * the next songs on the station. While a radio has one, each top-up asks it
 * first; a miss falls back to the on-device plan, and two misses in a row end it.
 */
export type RadioFeed = (limit: number, signal: AbortSignal) => Promise<Song[]>;
export type { QueueContext, QueueRun } from './queueRules';

export interface PlayerState {
  queue: Song[];
  /** 1.20 — where each queue entry came from (same length as `queue`): see store/queueRules.ts. */
  runs: QueueRun[];
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
  streamKbps: number | null;
  /** True while following a Listen Together host. */
  followMode: boolean;
  /** 1.15 — what the listener pressed play on ("Playing from", "Next from"); null when unknown. */
  context: QueueContext | null;
  /** 1.20 — true while Autoplay is looking for the next songs at the end of the list. */
  autoplayLoading: boolean;

  initEngine(): void;
  setSleepSongs(n: number): void;
  setLoopPoint(which: 'A' | 'B'): void;
  clearLoop(): void;
  /**
   * Play a list (an album, a playlist, a page of songs) from `startIndex`,
   * Spotify's way: the list becomes "Next from", the listener's own Next in
   * queue stays and plays right after the chosen song, and Autoplay follows
   * once the list ends. `asSeed` (a search hit) plays only that song.
   * `from` names what is playing ("Playing from"); left out, it is read from
   * the page the listener is on. `shuffle: true` turns shuffle on and starts
   * on a random song (the "Shuffle play" buttons).
   */
  playQueue(songs: Song[], startIndex?: number, opts?: { asSeed?: boolean; startAt?: number; room?: boolean; from?: QueueContext | null; shuffle?: boolean }): void;
  /** `startAt` (seconds): start part-way in. Listen Together starts a guest where the host is. */
  playSong(song: Song, opts?: { startAt?: number; room?: boolean }): void;
  /** Tap a queue row: see `jumpTo` in store/queueRules.ts. */
  playAt(index: number): void;
  /** Add to queue (the end of Next in queue). `quiet` (1.14): no snackbar; Listen Together says who added it instead. */
  enqueue(song: Song, opts?: { quiet?: boolean }): void;
  /** Add several to queue. `quiet`: no snackbar. */
  enqueueAll(songs: Song[], opts?: { quiet?: boolean }): void;
  /** 1.20 — more songs of the list that is playing (a playlist that loads in parts): they join "Next from", before Autoplay. */
  extendList(songs: Song[]): void;
  removeAt(index: number): void;
  moveInQueue(from: number, to: number): void;
  /** 1.20 — Spotify's "Clear queue": only Next in queue goes. */
  clearUserQueue(): void;
  /** Stop and empty everything (sign out, Settings → Clear queue). */
  clearQueue(): void;
  togglePlay(): void;
  next(manual?: boolean): void;
  /**
   * Radio from a song (default: the one playing): it and `seeds` (up to
   * RADIO_SEED_MAX in all) play first, then the station's `feed` (a catalogue
   * station) or Autoplay keeps it going.
   */
  startRadio(song?: Song, opts?: { seeds?: Song[]; feed?: RadioFeed | null; from?: QueueContext | null }): void;
  /** 7.2.0 — the playback instance measuring the current track (see services/playback/session.ts). */
  playbackInstance(): Readonly<PlaybackInstance> | null;
  prev(): void;
  seek(seconds: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  setRate(r: number): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  setSleepTimer(minutes: number | null): void;
  setSleepAfterTrack(v: boolean): void;
  setFollowMode(v: boolean): void;
}

/**
 * Listen Together, as a guest: the host picks the music, so a song this
 * listener taps (or queues) anywhere in the app is ASKED of the host instead
 * of played here, where the room would take it away a moment later. Set by
 * the room's engine while this device follows a host; `opts.room` marks the
 * engine's own plays.
 */
let roomAsk: ((song: Song) => void) | null = null;
export const setRoomAsk = (fn: ((song: Song) => void) | null): void => {
  roomAsk = fn;
};

/**
 * 1.14 — Listen Together is a jam: a guest's play / pause / next / previous
 * (the player's buttons, the lock screen, the keyboard) goes to the room,
 * and the host's app does it for everyone. Set by the room's engine while
 * this device follows a host; the engine's own plays run inside `asRoom`.
 */
export type RoomCmd = 'toggle' | 'next' | 'prev';
let roomControl: ((cmd: RoomCmd) => void) | null = null;
let roomOwn = 0;
export const setRoomControl = (fn: ((cmd: RoomCmd) => void) | null): void => {
  roomControl = fn;
};
/** The room engine's own play / pause: not a listener's tap, so not sent to the room. */
export function asRoom<T>(fn: () => T): T {
  roomOwn += 1;
  try {
    return fn();
  } finally {
    roomOwn -= 1;
  }
}
const toRoom = (cmd: RoomCmd): boolean => {
  if (!roomControl || roomOwn) return false;
  roomControl(cmd);
  return true;
};

/** 1.20 — Autoplay (services/autoplay), loaded once on demand: it is not part of the first load. */
let autoplayModule: Promise<typeof import('@/services/autoplay')> | null = null;
function loadAutoplay(): Promise<typeof import('@/services/autoplay')> {
  autoplayModule ??= import('@/services/autoplay');
  return autoplayModule;
}

/** 8.2.0 — Radio: the most songs a radio starts with before the continuation takes over. */
export const RADIO_SEED_MAX = 5;
/** How many songs one station top-up asks for. */
const STATION_BATCH = 5;
/** Autoplay is asked for more songs once this few are left. */
const AUTOPLAY_WHEN_LEFT = 2;
/** At most this many played entries stay behind the playing song. */
const PLAYED_KEEP = 200;
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
const RESUME_KEY = 'vinax.resume.v1';
function loadResume(): Record<string, number> {
  try { return JSON.parse(window.localStorage.getItem(RESUME_KEY) || '{}'); } catch { return {}; }
}
function saveResume(song: Song, sec: number, duration: number): void {
  try {
    const map = loadResume();
    const id = song.id;
    // Only remember meaningful mid-track positions on longer tracks.
    if (duration > 60 && sec > 20 && sec < duration - 20) map[id] = Math.floor(sec);
    else delete map[id];
    const ids = Object.keys(map);
    // A podcast episode's place is never the one pushed out by music.
    if (ids.length > 80) delete map[resumeEvictee(ids, window.localStorage.getItem(EPISODE_PROGRESS_KEY) ?? '')];
    window.localStorage.setItem(RESUME_KEY, JSON.stringify(map));
    // Episodes: progress, "played" at 95% and Continue your shows live in the podcast chunk.
    if (isEpisode(song)) void import('@/features/podcasts/progress').then((m) => m.noteEpisodeProgress(song, sec, duration)).catch(() => undefined);
  } catch { /* ignore */ }
}
let crossfadeArmed = false;
/** 1.16 — set while a crossfade hands the end of a song over to the next: how long the next one fades in. */
let overlapMs = 0;
let sleepTimer: number | null = null;
let _lastResumedSec = -1; // throttle: write at most once per 5-second mark
let lastUnavailableToastAt = 0;

/** Exactly what persist() writes to localStorage (see partialize). */
type PersistedPlayerState = Pick<PlayerState, 'queue' | 'runs' | 'index' | 'repeat' | 'shuffle' | 'volume' | 'muted' | 'rate' | 'context'>;

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      let queueVersion = 0;
      let transition = 0;
      /** A radio keeps going even with the Autoplay setting off. */
      let radio = false;
      /** 1.3 — the station keeping this radio going (startRadio's `feed`), and its misses in a row. */
      let feed: RadioFeed | null = null;
      let feedMisses = 0;
      /** The Autoplay request in flight for this queue version. */
      let autoplayJob: { version: number; promise: Promise<boolean> } | null = null;
      /** Cancels the in-flight Autoplay request when the queue moves on. */
      let autoplayAbort: AbortController | null = null;
      let batchSeq = 0;
      /** How each Autoplay entry got in (for the opt-in telemetry's outcome events). */
      const autoMetaById = new Map<string, AutoEntryMeta>();
      /**
       * 1.20 — the list the listener pressed play on, in its own order: Repeat
       * all plays it again and turning shuffle off restores it. Its ids are
       * saved next to the queue; after a reload the songs are found in the queue.
       */
      let contextList: Song[] = [];
      /** 7.2.0 — the playback instance measuring the current track (heard time, verdicts). */
      let playback: PlaybackInstance | null = null;
      /** Whether the current instance already has its history entry. */
      let playbackInHistory = false;
      /** Instances that already had their one fresh-URL retry after every source failed. */
      const refetchTried = new WeakSet<PlaybackInstance>();
      /** Cancels an in-flight song-detail refetch when the track changes. */
      let refetchAbort: AbortController | null = null;
      /** Put the engine back at the listener's volume after a sleep fade was cancelled or finished. */
      // While casting the local element is only a silent clock: it must never become audible over the receiver.
      const restoreVolume = (): void => audioEngine.setVolume(useCastStore.getState().connected ? 0 : get().volume);
      function clearSleepTimeout(): void {
        if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null; }
      }
      /** Spotify's Autoplay rule: the music goes on after the list only with Autoplay on (or a radio), repeat off, and not while following a host. */
      const canAutoplay = (): boolean => (radio || useSettingsStore.getState().autoplay) && !get().followMode && get().repeat === 'off';
      function invalidateQueue(): void {
        queueVersion += 1;
        transition += 1;
        // Obsolete work is cancelled, not just ignored.
        autoplayAbort?.abort();
        autoplayAbort = null;
        if (get().autoplayLoading) set({ autoplayLoading: false });
      }
      const snap = (): QueueSnapshot => {
        const { queue, runs, index } = get();
        return { queue, runs: runs.length === queue.length ? runs : alignRuns(queue, runs), index };
      };
      /** Install a new queue snapshot. */
      function apply(next: QueueSnapshot, extra: Partial<PlayerState> = {}): void {
        set({ queue: next.queue, runs: next.runs, index: next.index, ...extra });
      }

      /** End the current playback instance once (idempotent) and tell the listeners how it went. */
      function finalizePlayback(reason: PlaybackEndReason): void {
        const inst = playback;
        if (!inst || inst.finalized) return;
        inst.finalized = true;
        inst.endReason = inst.failed ? 'failed' : inst.endReason ?? reason;
        emitPlaybackEvent({ kind: 'end', instanceId: inst.id, song: inst.song, from: inst.from, heardSec: inst.heardSec, durationSec: inst.durationSec, reason: inst.endReason, run: inst.run, auto: autoMetaById.get(inst.song.id) ?? null });
      }

      /** Every source failed for this instance (after its one refetch): skip it, if it is still the one playing. */
      function failPlayback(inst: PlaybackInstance): void {
        if (playback !== inst || inst.finalized) return;
        inst.failed = true;
        skipUnavailable();
      }

      /** The list's order, saved next to the queue (not inside the de-duplicated player record). */
      function saveListOrder(): void {
        setLocal(KEYS.queueOwnership, { v: 2, order: contextList.map((s) => s.id) });
      }

      /**
       * After a reload: find the list's songs in the restored queue. A queue
       * saved by 1.19 or older has no runs; its saved "who added what" turns
       * into them here, once.
       */
      function loadListOrder(): void {
        const stored = getLocal<{ v?: number; auto?: unknown; manual?: unknown; order?: unknown }>(KEYS.queueOwnership, { v: 2 });
        const { queue } = get();
        const byId = new Map(queue.map((s) => [s.id, s] as const));
        const order = Array.isArray(stored?.order) ? stored.order.filter((id): id is string => typeof id === 'string') : [];
        contextList = [...new Set(order)].map((id) => byId.get(id)).filter((s): s is Song => !!s);
        if (stored?.v === 1 && queue.length && get().runs.every((r) => r === 'context')) {
          const ids = (raw: unknown): Set<string> => new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
          const manual = ids(stored.manual);
          const auto = ids(stored.auto);
          const { index } = get();
          const runs = queue.map((s, i): QueueRun => (i <= index ? 'context' : manual.has(s.id) ? 'queued' : auto.has(s.id) ? 'autoplay' : 'context'));
          apply(normalize({ queue, runs, index }));
          saveListOrder();
        }
      }

      /** Distinct lead artists in a top-up (diversity, for opt-in quality telemetry). */
      function distinctLeads(songs: Song[]): number {
        return new Set(songs.map((s) => (s.artists[0]?.name ?? s.subtitle ?? '').trim().toLowerCase()).filter(Boolean)).size;
      }

      /** Put Autoplay (or station) songs at the end of the queue and say so to the telemetry. */
      function commitAutoplay(songs: Song[], alg: 'autoplay' | 'station', started: number): number {
        if (!songs.length || !get().queue.length) return 0;
        const batch = (batchSeq += 1);
        songs.forEach((song, pos) => autoMetaById.set(song.id, { alg, picker: 'local', batch, pos }));
        apply(appendAutoplay(snap(), songs));
        preloadUpcoming();
        emitPlaybackEvent({ kind: 'served', batch, alg, picker: 'local', fallback: null, latencyMs: Date.now() - started, n: songs.length, discovery: 0, languageViolations: 0, distinctArtists: distinctLeads(songs), relaxed: [] });
        return songs.length;
      }

      /** A promise that gives up (with `fallback`) after `ms`. */
      function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return Promise.race([work, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); })])
          .catch(() => fallback)
          .finally(() => clearTimeout(timer));
      }

      /**
       * 1.20 — Autoplay: songs like the ones just played go on the end of the
       * queue (a station's own next songs first, for a catalogue radio). One
       * request per queue version; true when songs went in.
       */
      function topUpAutoplay(opts: { urgent?: boolean } = {}): Promise<boolean> {
        if (autoplayJob?.version === queueVersion) return autoplayJob.promise;
        const version = queueVersion;
        autoplayAbort?.abort();
        const abort = new AbortController();
        autoplayAbort = abort;
        const deadline = opts.urgent ? NEXT_URGENT_DEADLINE_MS : NEXT_DEADLINE_MS;
        const stale = (): boolean => version !== queueVersion || abort.signal.aborted || !canAutoplay() || !get().queue.length;
        const promise = (async () => {
          const started = Date.now();
          try {
            const { findAutoplaySongs, pickAutoplay } = await loadAutoplay();
            if (stale()) return false;
            // 1.3 — a catalogue station plays its own next songs; Autoplay covers a miss.
            const source = feed;
            if (source) {
              const songs = await within(source(STATION_BATCH, abort.signal), deadline, [] as Song[]);
              if (stale() || feed !== source) return false;
              const fresh = pickAutoplay(songs, get().queue, STATION_BATCH);
              if (fresh.length) {
                feedMisses = 0;
                return commitAutoplay(fresh, 'station', started) > 0;
              }
              feedMisses += 1;
              if (feedMisses >= 2) feed = null;
            }
            const { queue } = get();
            const found = await within(findAutoplaySongs(queue, queue.length - 1, abort.signal), deadline, [] as Song[]);
            // Read the state as it is NOW, after the await: a song hidden or
            // Kid mode switched on meanwhile never gets in.
            if (stale()) return false;
            return commitAutoplay(pickAutoplay(found, get().queue), 'autoplay', started) > 0;
          } catch {
            return false;
          } finally {
            if (autoplayJob?.version === version) autoplayJob = null;
          }
        })();
        autoplayJob = { version, promise };
        return promise;
      }

      function preloadUpcoming(): void {
        const { queue, index } = get();
        const next = queue[index + 1];
        if (!next) return;
        const url = orderedSources(next, useSettingsStore.getState().audioQuality)[0] ?? null;
        audioEngine.preloadNext(url);
      }

      function startTrack(song: Song, autoplay: boolean, opts: { from?: Song | null; startAt?: number } = {}): void {
        transition += 1;
        // 7.2.0 — one playback instance per start. The previous one ends here
        // (once) and any async work tied to it is cancelled.
        finalizePlayback('replaced');
        refetchAbort?.abort();
        refetchAbort = null;
        const instance = newPlaybackInstance(song, { from: opts.from ?? null });
        playback = instance;
        playbackInHistory = false;
        // Reset the resume-write throttle so the first timeupdate on the NEW
        // song can save immediately — without this the previous song's 5s
        // bucket suppresses the initial write on a same-second boundary.
        _lastResumedSec = -1;
        const quality = useSettingsStore.getState().audioQuality;
        if (opts.startAt) audioEngine.load(song, quality, autoplay, opts.startAt);
        else audioEngine.load(song, quality, autoplay);
        crossfadeArmed = false;
        // A follower plays where the host is, never where this device last left the song.
        if (autoplay && !opts.startAt && !get().followMode && useSettingsStore.getState().resumePlayback) {
          const at = loadResume()[song.id];
          if (at && at > 20) {
            window.setTimeout(() => {
              if (playback === instance && get().queue[get().index]?.id === song.id) {
                noteSeek(instance, at);
                audioEngine.seek(at);
                toast(tr('Resumed from {time}', { time: `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}` }));
              }
            }, 800);
          }
        }
        // A crossfade's incoming song rises over the whole overlap; any other start (a skip) gets the short fade.
        if (autoplay && useSettingsStore.getState().crossfade) audioEngine.fadeIn(overlapMs || 1200);
        updateMediaMetadata(song);
        
        // Cast: the receiver plays the song; the local element stays the silent clock.
        if (useCastStore.getState().connected) {
          audioEngine.setVolume(0);
          castLoadSong(song, autoplay, opts.startAt ?? 0);
        }

        if (autoplay) {
          // v7.0.0 — history gets the play at once (the listen clock needs the
          // entry); taste learns from it only once the playback instance has
          // really been heard (services/playback/session.ts).
          useHistoryStore.getState().addPlay(song);
          playbackInHistory = true;
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
        // 1.20 — Autoplay gets its songs ready while the list's last ones
        // play; the request never blocks starting the current song.
        if (autoplay && canAutoplay() && songsLeft() <= AUTOPLAY_WHEN_LEFT) void topUpAutoplay();
      }

      /** Songs still to come in this queue (1.15: under shuffle too, the queue order is the play order). */
      function songsLeft(): number {
        const { queue, index } = get();
        return queue.length - index - 1;
      }

      function maybeRecordSkip(manual: boolean): void {
        const { queue, index, duration } = get();
        const song = queue[index];
        const inst = playback;
        if (!manual || !song || !inst || inst.song.id !== song.id || inst.finalized) return;
        inst.endReason = 'manual-skip';
        // 7.2.0 — every verdict reads the HEARD time of this playback instance;
        // the playhead (a seek to the end, a scrub back) is never proof of listening.
        if (inst.run.completed || inst.run.skipped) return; // one verdict per run (repeat-one loops)
        if (!inst.run.played) {
          // Left before it really played: a sign of a restless sitting,
          // but not a verdict on the song, so the long-term profile is left alone.
          useHistoryStore.getState().markSkipped(song.id);
          // An episode says nothing about this sitting's music (personalization/updater).
          if (!isEpisode(song)) noteSessionEvent('skip', song);
          return;
        }
        if (isEarlyLeave(inst.heardSec, inst.durationSec || duration)) {
          inst.run.skipped = true;
          recordSkip(song, Math.round(inst.heardSec * 10) / 10);
          useHistoryStore.getState().markSkipped(song.id);
          void import('@/services/analytics/telemetry').then((m) => m.trackSkip(song)).catch(() => undefined);
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
        const inst = song && playback && playback.song.id === song.id && !playback.finalized ? playback : null;
        if (song && inst) {
          // 7.2.0 — reaching the end is a completion only when most of the song
          // was heard: seeking to the last seconds and letting it end is not.
          if (!inst.run.completed && isCompletion(inst.heardSec, inst.durationSec || duration)) {
            if (!inst.run.played) {
              inst.run.played = true;
              recordPlay(song);
              emitPlaybackEvent({ kind: 'counted', instanceId: inst.id, song, heardSec: inst.heardSec });
            }
            inst.run.completed = true;
            recordComplete(song, Math.round(inst.heardSec * 10) / 10);
            useHistoryStore.getState().markCompleted(song.id);
          }
          finalizePlayback(repeat === 'one' ? 'repeat' : 'ended');
        }
        // v5.12.0 — sleep after N songs counts down here; the last one stops.
        const songsDone = sleepSongsLeft > 0 ? sleepSongsLeft - 1 : 0;
        if (sleepSongsLeft > 0) set({ sleepSongsLeft: songsDone });
        if (sleepAfterTrack || (sleepSongsLeft === 1) || (sleepAt && Date.now() >= sleepAt)) {
          clearSleepTimeout();
          set({ sleepAt: null, sleepAfterTrack: false, sleepSongsLeft: 0, isPlaying: false });
          audioEngine.pause();
          void import('@/features/focus/focusSounds').then((m) => m.useFocusStore.getState().stop()).catch(() => undefined); // 15.0 — the focus sound sleeps too
          toast('Sleep timer: playback stopped');
          return;
        }
        if (repeat === 'one' && song) {
          // Each loop is a new playback instance of the same RUN: its seconds
          // count, but the run never learns a second PLAY or COMPLETE.
          playback = newPlaybackInstance(song, { run: inst?.run });
          noteSeek(playback, 0);
          playbackInHistory = true;
          audioEngine.seek(0);
          audioEngine.play();
          return;
        }
        get().next(false);
      }

      function playCurrent(): void {
        const { queue, index, isPlaying } = get();
        const song = queue[index];
        if (!song || isPlaying) return;
        if (audioEngine.currentSongId !== song.id) {
          startTrack(song, true);
          return;
        }
        if (castInterceptPlayPause(true)) {
          // v7.0.0 — the silent local element is the clock that drives
          // 'ended' → next while casting, so it follows the receiver.
          audioEngine.play();
          set({ isPlaying: true });
          return;
        }
        audioEngine.play();
      }

      function pauseCurrent(): void {
        transition += 1;
        if (!get().isPlaying) {
          // Already paused (say, by a phone call): a pause pressed now is a
          // deliberate one, so the pending auto-resume is called off.
          audioEngine.lastInterruptionAt = 0;
          return;
        }
        if (castInterceptPlayPause(false)) {
          audioEngine.pause();
          set({ isPlaying: false });
          return;
        }
        audioEngine.pause();
      }

      // Spotify: Autoplay switched off takes its songs out of what comes next.
      useSettingsStore.subscribe((now, before) => {
        if (before.autoplay && !now.autoplay && !radio) {
          invalidateQueue();
          apply(dropAutoplay(snap()));
        }
      });

      return {
        queue: [],
        runs: [],
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
        streamKbps: null,
        followMode: false,
        context: null,
        autoplayLoading: false,

        initEngine: () => {
          if (engineInitialized) return;
          engineInitialized = true;
          loadListOrder();
          audioEngine.init({
            onTime: (currentTime, duration) => {
              set({ currentTime, duration });
              // 7.2.0 — the playback instance credits only what was heard: no
              // seeks, no pauses, no buffering, no undeclared jumps.
              const inst = playback;
              if (inst && !inst.finalized && get().queue[get().index]?.id === inst.song.id) {
                const heard = creditTick(inst, currentTime, duration, { rate: get().rate, buffering: get().isBuffering });
                if (heard > 0) {
                  if (!playbackInHistory) {
                    useHistoryStore.getState().addPlay(inst.song);
                    playbackInHistory = true;
                  }
                  emitPlaybackEvent({ kind: 'credit', instanceId: inst.id, songId: inst.song.id, seconds: heard });
                  if (!inst.run.played && inst.heardSec >= playThreshold(inst.durationSec)) {
                    inst.run.played = true;
                    recordPlay(inst.song);
                    emitPlaybackEvent({ kind: 'counted', instanceId: inst.id, song: inst.song, heardSec: inst.heardSec });
                  }
                }
              }
              // v5.17.0 — sleep timer: fade the last 30 s toward silence and
              // stop on the minute instead of waiting for the song to end.
              const sleepAtNow = get().sleepAt;
              if (sleepAtNow) {
                const left = sleepAtNow - Date.now();
                if (left <= 0) {
                  // One stop per deadline: the wall-clock timeout below is the
                  // fallback for a paused player, so it is disarmed here.
                  clearSleepTimeout();
                  set({ sleepAt: null, sleepAfterTrack: false, sleepSongsLeft: 0, isPlaying: false });
                  audioEngine.pause();
                  // Mute rides on the element's own flag; writing 0 here would
                  // leave the engine silent after an un-mute.
                  restoreVolume();
                  void import('@/features/focus/focusSounds').then((m) => m.useFocusStore.getState().stop()).catch(() => undefined); // 15.0 — the focus sound sleeps too
                  toast('Sleep timer: playback stopped');
                  return;
                }
                if (left < 30_000 && !get().muted && !useCastStore.getState().connected) audioEngine.setVolume(Math.max(0.04, get().volume * (left / 30_000)));
              }
              // v5.12.0 — A-B repeat: bounce back to A the moment B passes.
              const { loopA, loopB } = get();
              if (loopA != null && loopB != null && loopB > loopA && currentTime >= loopB) {
                if (playback) noteSeek(playback, loopA);
                audioEngine.seek(loopA);
              }
              updatePositionState(duration, currentTime, get().rate);
              const playing = get().queue[get().index];
              const _sec5 = Math.floor(currentTime / 5); if (playing && _sec5 !== _lastResumedSec && Math.floor(currentTime) % 5 === 0) { _lastResumedSec = _sec5; saveResume(playing, currentTime, duration); }
              // 1.16 — crossfade: the last seconds overlap the next song, which
              // starts now on the preloaded element and rises while this one
              // falls. Where the engine cannot overlap (iPhone Safari, the sound
              // chain on) this song only fades out, as before.
              const { repeat, queue, index, sleepAt: sleeping, sleepAfterTrack, sleepSongsLeft, loopB: looping } = get();
              const xf = useSettingsStore.getState();
              const plan = crossfadeArmed ? null : crossfadePlan({
                seconds: xf.crossfade ? xf.crossfadeSeconds : 0,
                left: duration - currentTime,
                duration,
                next: repeat === 'one' ? null : queue[index + 1] ?? (repeat === 'all' ? queue[0] : null),
                off: useTogether.getState().mode !== 'idle' || useCastStore.getState().connected || location.pathname.endsWith('/karaoke'),
                fadeOnly: !!(sleeping || sleepAfterTrack || sleepSongsLeft) || looping != null,
              });
              if (plan) {
                crossfadeArmed = true;
                const ms = ((duration - currentTime) * 1000) / (get().rate || 1);
                if (plan === 'overlap' && audioEngine.overlap(ms)) {
                  overlapMs = ms;
                  handleEnded(); // credits the song, then next() starts the incoming one
                  overlapMs = 0;
                } else audioEngine.fadeOut(ms);
              }
            },
            onPlayState: (isPlaying) => {
              set({ isPlaying });
              // A pause the engine did not request (a call took the audio):
              // tell the Android service so it resumes when the call ends.
              updatePlaybackState(isPlaying, !isPlaying && audioEngine.lastInterruptionAt > 0);
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
              // 7.2.0 — the report and every async answer are checked against
              // the playback INSTANCE that failed (it changes whenever the
              // current track changes, including a replay of the same song), and
              // the refetch is aborted when the track changes: a late success
              // can never reload, and a late failure never skip, the song the
              // listener chose since.
              const inst = playback;
              const cur = get().queue[get().index];
              if (!inst || inst.finalized || !cur || cur.id !== songId || inst.song.id !== songId) return;
              if (!refetchTried.has(inst)) {
                refetchTried.add(inst);
                refetchAbort?.abort();
                const ctrl = new AbortController();
                refetchAbort = ctrl;
                const stillCurrent = (): boolean => !ctrl.signal.aborted && playback === inst && !inst.finalized;
                void import('@/services/api')
                  .then(({ getSong }) => getSong(songId))
                  .then((fresh) => {
                    if (!stillCurrent()) return;
                    const urls = orderedSources(fresh, useSettingsStore.getState().audioQuality);
                    if (urls.length && audioEngine.reloadWithSources(urls)) return;
                    failPlayback(inst);
                  })
                  .catch(() => {
                    if (stillCurrent()) failPlayback(inst);
                  });
                return;
              }
              failPlayback(inst);
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

        playQueue: (songs, startIndex = 0, opts = {}) => {
          if (!songs.length) return;
          // 13.9 — a visitor browsing signed out is asked to sign in; the tap plays after.
          if (!requireAccount('listen', () => get().playQueue(songs, startIndex, opts))) return;
          // 1.15 — "Shuffle play": shuffle goes on and the list starts on a random song.
          const randomStart = opts.shuffle === true;
          const selectedIndex = randomStart
            ? Math.floor(Math.random() * songs.length)
            : Number.isFinite(startIndex) ? Math.min(Math.max(0, Math.floor(startIndex)), songs.length - 1) : 0;
          const seed = songs[selectedIndex];
          // C2 — kid mode: an explicit-flagged song never starts playback.
          if (seed.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          if (roomAsk && !opts.room) return roomAsk(seed);
          resetSkipGuard(); // manual play — the user vouches for the sources
          finalizePlayback('replaced');
          invalidateQueue();
          radio = false;
          feed = null;
          autoMetaById.clear();
          // A search hit plays alone (Autoplay follows it); anything else plays as the list it is.
          const list = opts.asSeed ? [seed] : stripExplicit(songs);
          // 1.15 — what this is playing from: the caller's words, else the page the listener is on.
          const context = opts.from !== undefined ? opts.from : contextFromPage();
          if (randomStart && !get().shuffle) set({ shuffle: true });
          contextList = list;
          saveListOrder();
          const startAt = opts.startAt && Number.isFinite(opts.startAt) && opts.startAt > 0 ? opts.startAt : 0;
          // Spotify: the listener's Next in queue stays through a new list (a
          // Listen Together room's plays are the host's, not this listener's).
          const keepQueued = !opts.room && !get().followMode;
          const next = startList(snap(), list, list.indexOf(seed), { shuffle: get().shuffle, keepQueued });
          apply(trimPlayed(next, PLAYED_KEEP), { currentTime: startAt, duration: 0, loopA: null, loopB: null, context });
          startTrack(seed, true, { startAt });
        },

        playSong: (song, opts) => get().playQueue([song], 0, { startAt: opts?.startAt || undefined, room: opts?.room }),

        setSleepSongs: (n) => {
          // v7.0.0 — a minutes timer replaced by "after N songs" used to keep its
          // timeout armed and stop playback at the old deadline anyway.
          clearSleepTimeout();
          if (get().sleepAt != null) restoreVolume(); // undo a fade already in progress
          set({ sleepSongsLeft: Math.max(0, Math.round(n)), sleepAfterTrack: false, sleepAt: null });
        },
        setLoopPoint: (which) => {
          const { currentTime, loopA, loopB } = get();
          if (which === 'A') set({ loopA: currentTime, loopB: loopB != null && loopB > currentTime ? loopB : null });
          else if (loopA != null && currentTime > loopA + 0.5) set({ loopB: currentTime });
          else set({ loopA: Math.max(0, currentTime - 10), loopB: currentTime });
        },
        clearLoop: () => set({ loopA: null, loopB: null }),
        playAt: (index) => {
          const { queue } = get();
          if (index < 0 || index >= queue.length || index === get().index) return;
          if (!requireAccount('listen', () => get().playAt(index))) return;
          resetSkipGuard(); // manual play
          maybeRecordSkip(true);
          const from = index === get().index + 1 ? queue[get().index] : null;
          const next = jumpTo(snap(), index);
          apply(next, { currentTime: 0, duration: 0, loopA: null, loopB: null });
          startTrack(next.queue[next.index], true, { from });
        },

        enqueue: (song, opts) => {
          if (song.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          if (roomAsk) return roomAsk(song);
          if (!get().queue.length) {
            get().playQueue([song]);
            return;
          }
          if (isQueued(snap(), song.id)) {
            if (!opts?.quiet) toast('Already in queue');
            return;
          }
          recordQueueAdd(song);
          // Spotify: Add to queue puts the song at the end of Next in queue,
          // after the playing song and every song added before it.
          const before = get().index;
          apply(addToQueue(dropFromAutoplay(snap(), new Set([song.id])), [song]));
          if (get().runs[before + 1] === 'queued' && get().queue[before + 1] === song) preloadUpcoming();
          // 10.1 — the snackbar shows which song went in, and opens the queue.
          if (!opts?.quiet) toast('Added to queue', { image: bestImage(song.images, 50), action: { label: 'View', onClick: () => toastNavigate('/queue') } });
        },

        enqueueAll: (songs, opts) => {
          const s = snap();
          const fresh = stripExplicit(songs).filter((song, i, all) => isValidSong(song) && !isQueued(s, song.id) && all.findIndex((x) => x.id === song.id) === i);
          if (!fresh.length) {
            if (!opts?.quiet) toast('Already in queue');
            return;
          }
          if (roomAsk) {
            for (const song of fresh) roomAsk(song);
            return;
          }
          if (!s.queue.length) {
            get().playQueue(fresh, 0, { from: null });
            return;
          }
          for (const song of fresh) recordQueueAdd(song);
          apply(addToQueue(dropFromAutoplay(s, new Set(fresh.map((x) => x.id))), fresh));
          preloadUpcoming();
          if (!opts?.quiet) toast(fresh.length === 1 ? 'Added 1 song to queue' : tr('Added {n} songs to queue', { n: fresh.length }));
        },

        extendList: (songs) => {
          const fresh = stripExplicit(songs).filter(isValidSong);
          if (!fresh.length || !get().queue.length) return;
          contextList = [...contextList, ...fresh];
          saveListOrder();
          const s = snap();
          const next = upcoming(s);
          const lastList = [s.index, ...next.filter((e) => e.run !== 'autoplay').map((e) => e.at)].pop() ?? s.index;
          const at = lastList + 1;
          apply({
            queue: [...s.queue.slice(0, at), ...fresh, ...s.queue.slice(at)],
            runs: [...s.runs.slice(0, at), ...fresh.map((): QueueRun => 'context'), ...s.runs.slice(at)],
            index: s.index,
          });
          preloadUpcoming();
        },

        removeAt: (i) => {
          const { queue, index, isPlaying } = get();
          if (i < 0 || i >= queue.length) return;
          const removingCurrent = i === index;
          if (queue.length === 1) {
            get().clearQueue();
            return;
          }
          const next = removeEntry(snap(), i);
          apply(next);
          if (removingCurrent) {
            // The playing track was removed — load whatever now occupies the
            // slot (keeping play/pause state) so audio and UI stay in sync.
            set({ currentTime: 0 });
            startTrack(next.queue[next.index], isPlaying);
          } else if (i === index + 1) preloadUpcoming();
        },

        moveInQueue: (from, to) => {
          const before = get().queue[get().index + 1];
          apply(moveEntry(snap(), from, to));
          if (get().queue[get().index + 1] !== before) preloadUpcoming();
        },

        clearUserQueue: () => {
          apply(clearQueued(snap()));
          preloadUpcoming();
        },

        clearQueue: () => {
          finalizePlayback('cleared');
          playback = null;
          refetchAbort?.abort();
          refetchAbort = null;
          invalidateQueue();
          radio = false;
          feed = null;
          clearSleepTimeout();
          autoMetaById.clear();
          contextList = [];
          saveListOrder();
          audioEngine.pause();
          set({ queue: [], runs: [], index: 0, isPlaying: false, currentTime: 0, duration: 0, context: null, autoplayLoading: false });
          // 8.1.0 — an empty queue ends the media session: notification, lock-screen controls and the widget clear.
          updateMediaMetadata(null);
        },

        togglePlay: () => {
          if (toRoom('toggle')) return;
          transition += 1;
          const { isPlaying, queue, index } = get();
          const song = queue[index];
          if (!song) return;
          if (!isPlaying && !requireAccount('listen', () => get().togglePlay())) return;
          haptic('light');
          if (audioEngine.currentSongId !== song.id) {
            startTrack(song, true);
            return;
          }
          if (castInterceptPlayPause(!isPlaying)) {
            // Keep the silent local clock in step with the receiver: left
            // running, it reached the end of a paused song and started the next one.
            if (isPlaying) audioEngine.pause();
            else audioEngine.play();
            set({ isPlaying: !isPlaying });
            return;
          }
          if (isPlaying) audioEngine.pause();
          else audioEngine.play();
        },

        next: (manual = false) => {
          if (manual && toRoom('next')) return;
          const { queue, index, shuffle, repeat } = get();
          if (!queue.length) return;
          if (manual) haptic('light');
          maybeRecordSkip(manual);
          const playing = queue[index];
          const go = (at: number): void => {
            const from = get().queue[at - 1] ?? null;
            apply(trimPlayed({ ...snap(), index: at }, PLAYED_KEEP), { currentTime: 0, duration: 0 });
            startTrack(get().queue[get().index], true, { from });
          };
          if (index + 1 < queue.length) {
            go(index + 1);
            return;
          }
          // The end of the queue. Repeat all: the list again from its top.
          const list = contextList.length ? contextList : queue.filter((_, i) => get().runs[i] === 'context');
          if (repeat === 'all' && list.length) {
            apply(repeatList(snap(), list, { shuffle }));
            if (get().queue.length > index + 1) go(index + 1);
            return;
          }
          // Autoplay: wait (paused) for songs like these, then carry on.
          if (playing && canAutoplay() && !isEpisode(playing)) {
            const version = queueVersion;
            const ticket = ++transition;
            set({ isPlaying: false, autoplayLoading: true });
            audioEngine.pause();
            void topUpAutoplay({ urgent: true }).then((added) => {
              if (version !== queueVersion || ticket !== transition || get().queue[get().index] !== playing) return;
              set({ autoplayLoading: false });
              if (!canAutoplay()) return;
              if (added || get().index < get().queue.length - 1) {
                if (get().queue.length > get().index + 1) go(get().index + 1);
                return;
              }
              // Never a silent stop: say why, so the listener can act.
              toast('Autoplay couldn’t find more songs right now — pick something or start a radio');
            });
            return;
          }
          // Nothing more to play: stop at the end of the last song.
          set({ isPlaying: false });
          audioEngine.pause();
        },

        playbackInstance: () => playback,

        startRadio: (song, opts = {}) => {
          const seed = song ?? get().queue[get().index];
          if (!seed) return;
          if (!requireAccount('listen', () => get().startRadio(song, opts))) return;
          // 8.2.0 — Radio seeds: distinct, valid, Kid-mode safe, at most RADIO_SEED_MAX.
          const seen = new Set<string>();
          const list = stripExplicit([seed, ...(opts.seeds ?? []).filter(isValidSong)])
            .filter((s) => !seen.has(s.id) && !!seen.add(s.id))
            .slice(0, RADIO_SEED_MAX);
          if (!list.length) return;
          if (roomAsk) return roomAsk(list[0]);
          finalizePlayback('replaced');
          invalidateQueue();
          radio = true;
          feed = opts.feed ?? null;
          feedMisses = 0;
          autoMetaById.clear();
          contextList = list;
          saveListOrder();
          const context: QueueContext | null = opts.from !== undefined ? opts.from : { kind: 'radio', label: `${list[0].title} radio`, path: '/radio' };
          const next = startList(snap(), list, 0, { keepQueued: !get().followMode });
          apply(trimPlayed(next, PLAYED_KEEP), { currentTime: 0, duration: 0, isPlaying: true, loopA: null, loopB: null, context });
          startTrack(list[0], true);
          // Ask for the first continuation at once, so the queue shows where the radio goes.
          void topUpAutoplay();
        },

        prev: () => {
          if (toRoom('prev')) return;
          transition += 1;
          const { queue, index, currentTime } = get();
          if (!queue.length) return;
          haptic('light');
          if (currentTime > 3 || index === 0) {
            if (playback) noteSeek(playback, 0);
            audioEngine.seek(0);
            return;
          }
          const back = normalize({ ...snap(), index: index - 1 });
          apply(back, { currentTime: 0, duration: 0 });
          startTrack(back.queue[back.index], true);
        },

        seek: (seconds) => {
          // 7.2.0 — a declared seek: the playback instance re-bases instead of crediting the jump.
          if (playback) noteSeek(playback, seconds);
          if (castInterceptSeek(seconds)) {
            audioEngine.seek(seconds); // the local clock decides when the song "ends"
            set({ currentTime: seconds });
            return;
          }
          // A seek (esp. backward) while the crossfade tail is ramping would
          // otherwise leave the track stuck at silence — un-arm and restore.
          if (crossfadeArmed) {
            crossfadeArmed = false;
            restoreVolume();
          }
          audioEngine.seek(seconds);
          set({ currentTime: seconds });
        },

        setVolume: (v) => {
          const volume = Math.min(1, Math.max(0, v));
          // While casting, volume belongs to the receiver; the local element stays silent.
          if (!castInterceptVolume(volume)) audioEngine.setVolume(volume);
          // Raising the volume un-mutes — in the state too, or the UI kept showing "muted".
          if (volume > 0 && get().muted) {
            audioEngine.setMuted(false);
            set({ volume, muted: false });
          } else {
            set({ volume });
          }
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
          // Spotify: with repeat on there is no Autoplay; off again, it comes back near the end.
          if (next !== 'off') {
            invalidateQueue();
            apply(dropAutoplay(snap()));
          } else if (get().isPlaying && canAutoplay() && songsLeft() <= AUTOPLAY_WHEN_LEFT) void topUpAutoplay();
        },

        toggleShuffle: () => {
          const on = !get().shuffle;
          // A followed host's queue is not the listener's to reorder.
          if (get().followMode) {
            set({ shuffle: on });
            return;
          }
          // 1.15 — the queue itself is reordered, so it shows what will really
          // play and Back returns to the song before; off puts the list back.
          const next = on ? shuffleOn(snap()) : shuffleOff(snap(), contextList.map((s) => s.id));
          apply(next, { shuffle: on });
          preloadUpcoming();
        },

        setSleepTimer: (minutes) => {
          clearSleepTimeout();
          if (get().sleepAt != null) restoreVolume(); // cancelled or replaced inside the final fade
          set({ sleepAt: minutes == null ? null : Date.now() + minutes * 60_000, sleepAfterTrack: false });
          if (minutes != null) {
            toast(tr('Sleeping in {n} min', { n: minutes }));
            sleepTimer = window.setTimeout(() => {
              sleepTimer = null;
              // The playing path (onTime) already stopped at the deadline, or the
              // timer was replaced: nothing left to do.
              if (get().sleepAt == null || !get().isPlaying) { set({ sleepAt: null }); return; }
              // Gentle 8s fade to silence, then pause.
              audioEngine.fadeOutAndPause(8000, () => {
                set({ isPlaying: false, sleepAt: null });
                toast('Sleep timer: paused');
              });
            }, minutes * 60_000);
          }
        },

        setSleepAfterTrack: (v) => {
          clearSleepTimeout();
          if (get().sleepAt != null) restoreVolume();
          set({ sleepAfterTrack: v, sleepAt: null });
          if (v) toast('Will stop after this song');
        },

        setFollowMode: (followMode) => set({ followMode }),
      };
    },
    {
      name: KEYS.player,
      version: 1,
      // v7.0.0 — progress ticks `set` ~4×/s and none of the persisted fields
      // change: the write is skipped unless one did (it used to re-serialise the
      // whole queue every tick), is dropped while a restore waits for its reload,
      // and a full device no longer throws into playback.
      storage: createDedupedStorage<PersistedPlayerState>(),
      partialize: (s): PersistedPlayerState => ({
        queue: s.queue,
        runs: s.runs,
        index: s.index,
        repeat: s.repeat,
        shuffle: s.shuffle,
        volume: s.volume,
        muted: s.muted,
        rate: s.rate,
        context: s.context,
      }),
      // Pre-v1 records share this shape — real validation lives in merge().
      migrate: (persisted) => persisted as PersistedPlayerState,
      // localStorage is untrusted input: drop malformed queue entries and clamp
      // scalars so a corrupt/legacy record can never brick the player (DQA-06).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedPlayerState>;
        // 7.2.0 — a queue stored by an older build can carry energy/tempo an AI
        // classifier once guessed. They were never measured, so they are dropped
        // rather than passed on as catalogue metadata.
        const storedRuns = alignRuns(Array.isArray(p.queue) ? p.queue : [], p.runs);
        const runs = Array.isArray(p.queue) ? storedRuns.filter((_, i) => isValidSong((p.queue as unknown[])[i])) : [];
        const queue = (Array.isArray(p.queue) ? p.queue.filter(isValidSong) : []).map((song) => {
          if (song.energy === undefined && song.tempo === undefined) return song;
          const rest: Song = { ...song };
          delete rest.energy;
          delete rest.tempo;
          return rest;
        });
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
          ...normalize({ queue, runs, index: queue.length ? Math.min(Math.max(0, rawIndex), queue.length - 1) : 0 }),
          context: queue.length && isQueueContext(p.context) ? p.context : null,
        };
      },
    },
  ),
);

export function useCurrentSong(): Song | null {
  return usePlayerStore((s) => s.queue[s.index] ?? null);
}
