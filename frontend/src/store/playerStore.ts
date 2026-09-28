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
import { toast } from './toastStore';
import { useHistoryStore } from './historyStore';
import { useSettingsStore } from './settingsStore';
import { useCastStore, castInterceptPlayPause, castInterceptSeek, castInterceptVolume, castMime } from '@/services/cast';
import { bestImage } from '@/utils/images';
import { isValidSong, noteUnavailable, queueAfterClearFrom, reorderQueue, resetSkipGuard, sortQueueTail, type QueueSortKind } from './playerGuards';
import { kidModeOn, stripExplicit } from '@/services/kidMode';
import { getRecommendationContext } from '@/services/recommendation/context';
import type { NextSongsPlan } from '@/services/recommendation/engine';
import { NEXT_URGENT_DEADLINE_MS } from '@/services/recommendation/deadlines';
import { songKey } from '@/services/recommendation/songIdentity';
import { admitSongs } from '@/services/recommendation/admission';
import { isTuneIntent, randomTune, type TuneIntent } from '@/services/recommendation/tune';
import { noteSessionEvent } from '@/services/personalization/sessionIntent';
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
  /** v6.5.0 — the active "Tune this queue" intent (cleared by a fresh play). */
  tuneIntent: TuneIntent | null;

  initEngine(): void;
  setSleepSongs(n: number): void;
  setLoopPoint(which: 'A' | 'B'): void;
  clearLoop(): void;
  /**
   * Start playback. With the DJ takeover setting on (default), any list of
   * two or more songs is treated as a seed: the tapped song starts and the
   * AI DJ builds what follows (the 3.9 behaviour). `keepList` forces the
   * tapped list to become the queue (Queue Builder plans, explicit queues).
   */
  playQueue(songs: Song[], startIndex?: number, opts?: { keepList?: boolean }): void;
  playSong(song: Song): void;
  /** v6.5.0 — reshape what comes next: keeps what played and the current song, rebuilds the rest for the intent. */
  /** `null` (v7.1.0) drops the active intent and rebuilds what follows without one. */
  tuneQueue(intent: TuneIntent | null): void;
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
  /**
   * Endless radio from a song (default: the one playing). 8.2.0 — AI Radio:
   * `seeds` play first after the song (a mood's or a request's picks, up to
   * RADIO_SEED_MAX in all) and `tune` steers every continuation the DJ adds.
   */
  startRadio(song?: Song, opts?: { seeds?: Song[]; tune?: TuneIntent | null }): void;
  /** v6.3.0 — songs the recommender appended (not hand-queued), after the current one. */
  autoTail(): Song[];
  isAutoQueued(id: string): boolean;
  /** v6.3.0 — swap the recommender's tail for a new order, keeping hand-queued songs in place. */
  replaceAutoTail(songs: Song[]): void;
  /** 7.2.0 — was this entry queued by the listener ("Add to queue", "Play next", "Keep this song")? */
  isManualQueued(id: string): boolean;
  /** 7.2.0 — keep an automatic entry: it becomes the listener's own and survives a rebuild or an AI refinement. */
  keepSong(id: string): void;
  /** 7.2.0 — the listener asked for new automatic picks: rebuild everything automatic after the current song. */
  regenerateAutoTail(): void;
  /** 7.2.0 — put back the upcoming entry the last `removeAt` took out (while the same song is playing). */
  undoRemove(): boolean;
  /** 7.2.0 — the playback instance measuring the current track (see services/playback/session.ts). */
  playbackInstance(): Readonly<PlaybackInstance> | null;
  /** 7.2.0 — how an automatic entry got into the queue (null for the listener's own songs). */
  autoMeta(id: string): AutoEntryMeta | null;
  /** v6.3.0 — Queue Builder: install a planned queue, replacing everything or appending after the current song. */
  applyPlan(songs: Song[], mode: 'replace' | 'append'): void;
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

/** 8.2.0 — AI Radio: the most songs a radio starts with before the DJ takes over. */
export const RADIO_SEED_MAX = 5;
/** How many songs one continuation adds. */
const NEXT_BATCH = 5;
/** 7.2.0 — inside the last seconds of a song the next track is committed: an AI refinement leaves it alone. */
const NEXT_COMMIT_WINDOW_SEC = 30;
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
let _lastResumedSec = -1; // throttle: write at most once per 5-second mark
let lastUnavailableToastAt = 0;

/** Exactly what persist() writes to localStorage (see partialize). */
type PersistedPlayerState = Pick<PlayerState, 'queue' | 'index' | 'repeat' | 'shuffle' | 'volume' | 'muted' | 'rate'>;

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => {
      let queueVersion = 0;
      let transition = 0;
      let radio = false;
      let recommendationJob: { version: number; promise: Promise<boolean> } | null = null;
      /** 7.2.0 — cancels the in-flight plan and its AI refinement when the queue moves on. */
      let planAbort: AbortController | null = null;
      /** 7.2.0 — the latest accepted plan. Its validated reserve tops up a queue about to run
       *  dry, and — for a queue in the same language — is the last-good fallback. */
      let lastPlan: NextSongsPlan | null = null;
      let batchSeq = 0;
      const autoMetaById = new Map<string, AutoEntryMeta>();
      /** Ids the recommender appended. Persisted with the queue (7.2.0) so a
       *  reload does not turn every entry into "the list you started". */
      const autoIds = new Set<string>();
      /** v7.0.0 — ids the listener queued by hand ("Add to queue" / "Play next"). They
       *  outrank everything automatic: they sit ahead of the recommender's tail,
       *  survive a re-plan and a "Tune this queue", and are never reordered. */
      const manualIds = new Set<string>();
      /** 7.2.0 — the playback instance measuring the current track (heard time, verdicts). */
      let playback: PlaybackInstance | null = null;
      /** Whether the current instance already has its history entry. */
      let playbackInHistory = false;
      /** Instances that already had their one fresh-URL retry after every source failed. */
      const refetchTried = new WeakSet<PlaybackInstance>();
      /** Cancels an in-flight song-detail refetch when the track changes. */
      let refetchAbort: AbortController | null = null;
      /** The last upcoming entry `removeAt` took out, for Undo. */
      let lastRemoval: { song: Song; at: number; manual: boolean; auto: AutoEntryMeta | null; anchorId: string | null } | null = null;
      /** Put the engine back at the listener's volume after a sleep fade was cancelled or finished. */
      // While casting the local element is only a silent clock: it must never become audible over the receiver.
      const restoreVolume = (): void => audioEngine.setVolume(useCastStore.getState().connected ? 0 : get().volume);
      function clearSleepTimeout(): void {
        if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null; }
      }
      const canExtend = () => (radio || useSettingsStore.getState().autoplay) && !get().followMode && get().repeat === 'off';
      function invalidateQueue(): void {
        queueVersion += 1;
        transition += 1;
        // Obsolete work is cancelled, not just ignored: the plan's reads and the DJ request stop.
        planAbort?.abort();
        planAbort = null;
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

      function markAuto(songs: Song[], meta: Omit<AutoEntryMeta, 'pos'>): void {
        songs.forEach((song, pos) => {
          autoIds.add(song.id);
          manualIds.delete(song.id);
          autoMetaById.set(song.id, { ...meta, pos });
        });
        saveOwnership();
      }

      /** 7.2.0 — who queued what, written next to the queue (not inside the
       *  de-duplicated player record, which must not change on a progress tick). */
      function saveOwnership(): void {
        setLocal(KEYS.queueOwnership, { v: 1, auto: [...autoIds], manual: [...manualIds] });
      }

      /** Restore ownership for the rehydrated queue; ids no longer in it are dropped. */
      function loadOwnership(): void {
        const stored = getLocal<{ v?: number; auto?: unknown; manual?: unknown }>(KEYS.queueOwnership, { v: 1 });
        const ids = new Set(get().queue.map((s) => s.id));
        const take = (raw: unknown, into: Set<string>): void => {
          if (!Array.isArray(raw)) return;
          for (const id of raw) if (typeof id === 'string' && ids.has(id)) into.add(id);
        };
        take(stored?.auto, autoIds);
        take(stored?.manual, manualIds);
      }

      /** Distinct lead artists in a continuation (diversity, for opt-in quality telemetry). */
      function distinctLeads(songs: Song[]): number {
        return new Set(songs.map((s) => (s.artists[0]?.name ?? s.subtitle ?? '').trim().toLowerCase()).filter(Boolean)).size;
      }

      function languageViolations(songs: Song[], lock: string | null): number {
        return lock ? songs.filter((s) => s.language && s.language !== 'unknown' && s.language !== lock).length : 0;
      }

      /** Append an accepted plan through the current-state gate; commit its side effects for what went in. */
      function acceptPlan(plan: NextSongsPlan): number {
        const queue = get().queue;
        if (!queue.length) return 0;
        const { admitted } = admitSongs(plan.songs, { queue, index: get().index });
        if (!admitted.length) return 0;
        const batch = (batchSeq += 1);
        markAuto(admitted, { alg: plan.alg, picker: plan.picker, batch });
        set({ queue: [...queue, ...admitted] });
        plan.commit(admitted);
        lastPlan = plan;
        preloadUpcoming();
        emitPlaybackEvent({ kind: 'served', batch, alg: plan.alg, picker: plan.picker, fallback: plan.fallback, latencyMs: plan.latencyMs, n: admitted.length, discovery: admitted.filter((s) => plan.discoveryIds.has(s.id)).length, languageViolations: languageViolations(admitted, plan.language), distinctArtists: distinctLeads(admitted), relaxed: plan.relaxed, refinementPending: !!plan.refinement });
        if (plan.refinement) {
          const version = queueVersion;
          void plan.refinement.then((refined) => {
            if (!('songs' in refined)) {
              emitPlaybackEvent({ kind: 'refined', batch, applied: false, fallback: refined.rejected, latencyMs: plan.latencyMs, n: 0, discovery: 0, languageViolations: 0, distinctArtists: 0, relaxed: [] });
              return;
            }
            // A refinement for a queue the listener has since changed is dropped (and never committed).
            const placed = version === queueVersion && canExtend() ? applyRefinement(refined, batch) : [];
            const n = placed.length;
            emitPlaybackEvent({
              kind: 'refined', batch, applied: n > 0, fallback: n > 0 ? null : 'ai_rejected', latencyMs: refined.latencyMs, n,
              // Measured on what the AI order actually placed, so the quality
              // panel compares like with like against the local batch.
              discovery: placed.filter((s) => refined.discoveryIds.has(s.id)).length,
              languageViolations: languageViolations(placed, refined.language),
              distinctArtists: distinctLeads(placed),
              relaxed: refined.relaxed,
            });
          });
        }
        return admitted.length;
      }

      /** Is the track after the current one committed, so an AI refinement must not swap it? */
      function nextCommitted(): boolean {
        const { queue, index, currentTime, duration } = get();
        const next = queue[index + 1];
        if (!next) return false;
        if (!autoIds.has(next.id) || crossfadeArmed) return true;
        return duration > 0 && duration - currentTime <= NEXT_COMMIT_WINDOW_SEC;
      }

      /**
       * 7.2.0 — the AI's order for a stretch already queued from the local plan.
       * Only automatic entries that have not started may change: never the
       * current track, never a committed next track, never the listener's own
       * songs (they keep their place ahead of the automatic ones).
       */
      function applyRefinement(refined: NextSongsPlan, batch: number): Song[] {
        const { queue, index } = get();
        const start = index + 1 + (nextCommitted() ? 1 : 0);
        const eligible = queue.slice(start).filter((s) => autoIds.has(s.id));
        if (!eligible.length) return [];
        const eligibleIds = new Set(eligible.map((s) => s.id));
        const { admitted } = admitSongs(refined.songs, { queue, index, replacing: eligibleIds });
        const fresh = admitted.slice(0, eligible.length);
        if (fresh.length < Math.min(3, eligible.length)) return [];
        const others = queue.slice(start).filter((s) => !eligibleIds.has(s.id));
        for (const id of eligibleIds) {
          autoIds.delete(id);
          autoMetaById.delete(id);
        }
        markAuto(fresh, { alg: refined.alg, picker: 'ai', batch });
        set({ queue: [...queue.slice(0, start), ...others, ...fresh] });
        refined.commit(fresh);
        preloadUpcoming();
        return fresh;
      }

      /**
       * 7.2.0 — top the queue up at once from the latest plan's validated
       * reserve when it is about to run dry and no fresh plan is ready. The
       * reserve is re-validated against the song now at the end (same final
       * policy) and passes the current-state gate; a reserve in another
       * language is never used.
       */
      function topUpFromReserve(seedNow: Song): number {
        const plan = lastPlan;
        if (!plan) return 0;
        const lang = seedNow.language && seedNow.language !== 'unknown' ? seedNow.language : null;
        if (plan.language && lang && plan.language !== lang) return 0;
        const { queue, index } = get();
        const picks = plan.topUp(seedNow, NEXT_BATCH, { ids: new Set(queue.map((s) => s.id)), keys: new Set(queue.map(songKey)) });
        const { admitted } = admitSongs(picks, { queue, index });
        if (!admitted.length) return 0;
        const batch = (batchSeq += 1);
        markAuto(admitted, { alg: plan.alg, picker: 'reserve', batch });
        set({ queue: [...queue, ...admitted] });
        plan.commit(admitted);
        emitPlaybackEvent({ kind: 'served', batch, alg: plan.alg, picker: 'reserve', fallback: 'deadline', latencyMs: 0, n: admitted.length, discovery: admitted.filter((s) => plan.discoveryIds.has(s.id)).length, languageViolations: languageViolations(admitted, plan.language), distinctArtists: distinctLeads(admitted), relaxed: [], refinementPending: false });
        return admitted.length;
      }
      async function appendRecommendations(seed: Song, opts: { urgent?: boolean } = {}): Promise<boolean> {
        if (recommendationJob?.version === queueVersion) return recommendationJob.promise;
        const version = queueVersion;
        planAbort?.abort();
        const abort = new AbortController();
        planAbort = abort;
        const promise = (async () => {
          try {
            // 7.2.0 — the engine is loaded on demand: it no longer rides the
            // first load with the player store (the service worker precaches it).
            const { planNextSongs } = await import('@/services/recommendation/engine');
            if (version !== queueVersion || abort.signal.aborted) return false;
            const { queue } = get();
            // 7.2.0 — a plan: the on-device order inside one end-to-end deadline
            // (shorter when the listener is waiting at the end of the queue), and
            // the AI DJ's order as a later refinement of the automatic entries.
            const plan = await planNextSongs(seed, getRecommendationContext(seed, radio ? 'radio' : 'playlist'), {
              // v7.1.0 — the next FIVE: a short, tight stretch re-planned more often follows the
              // listener better than eight songs decided at once (and the DJ answers faster).
              limit: NEXT_BATCH,
              excludeIds: queue.map((song) => song.id),
              excludeKeys: queue.map(songKey),
              tune: get().tuneIntent,
              // The stretch is appended after the last queued song: that is the
              // hand-off the no-repeat-artist rule must judge.
              previous: queue[queue.length - 1] ?? null,
              signal: abort.signal,
              deadlineMs: opts.urgent ? NEXT_URGENT_DEADLINE_MS : undefined,
            });
            // The gate reads the state as it is NOW, after the await: a song hidden
            // or a Kid mode switched on meanwhile never gets in.
            if (version !== queueVersion || !canExtend() || abort.signal.aborted) return false;
            return acceptPlan(plan) > 0;
          } catch {
            return false;
          } finally {
            if (recommendationJob?.version === version) recommendationJob = null;
          }
        })();
        recommendationJob = { version, promise };
        return promise;
      }

      function preloadUpcoming(): void {
        const { queue, index, shuffle } = get();
        if (shuffle) return; // unknown next under shuffle
        const next = queue[index + 1];
        if (!next) return;
        const url = orderedSources(next, useSettingsStore.getState().audioQuality)[0] ?? null;
        audioEngine.preloadNext(url);
      }

      function startTrack(song: Song, autoplay: boolean, opts: { from?: Song | null } = {}): void {
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
        audioEngine.load(song, quality, autoplay);
        crossfadeArmed = false;
        if (autoplay && useSettingsStore.getState().resumePlayback) {
          const at = loadResume()[song.id];
          if (at && at > 20) {
            window.setTimeout(() => {
              if (playback === instance && get().queue[get().index]?.id === song.id) {
                noteSeek(instance, at);
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
          // v7.0.0 — history gets the play at once (the listen clock needs the
          // entry); taste learns from it only once the playback instance has
          // really been heard (services/playback/session.ts).
          useHistoryStore.getState().addPlay(song);
          playbackInHistory = true;
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
        if (autoplay && canExtend() && get().queue.length - get().index <= 2) {
          void appendRecommendations(song);
        }
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
          noteSessionEvent('skip', song);
          return;
        }
        if (isEarlyLeave(inst.heardSec, inst.durationSec || duration)) {
          inst.run.skipped = true;
          recordSkip(song, Math.round(inst.heardSec * 10) / 10);
          useHistoryStore.getState().markSkipped(song.id);
          void import('@/services/analytics/telemetry').then((m) => m.trackSkip(song));
          // v6.3.0 — two skips inside the recommender's tail re-plan the rest of it.
          void import('@/services/recommendation/adaptive').then((m) => m.noteSkipAndMaybeReplan(song));
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
            void import('@/services/recommendation/adaptive').then((m) => m.noteCompleted());
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
        if (castInterceptPlayPause()) {
          audioEngine.pause();
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
        tuneIntent: null,

        initEngine: () => {
          if (engineInitialized) return;
          engineInitialized = true;
          loadOwnership();
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
          const selectedIndex = Number.isFinite(startIndex) ? Math.min(Math.max(0, Math.floor(startIndex)), songs.length - 1) : 0;
          const seed = songs[selectedIndex];
          // C2 — kid mode: an explicit-flagged song never starts playback.
          if (seed.explicit && kidModeOn()) {
            toast('Kid mode is on — that song is marked explicit');
            return;
          }
          resetSkipGuard(); // manual play — the user vouches for the sources
          finalizePlayback('replaced');
          invalidateQueue();
          autoIds.clear();
          autoMetaById.clear();
          manualIds.clear();
          sessionPlayed.clear();
          lastRemoval = null;
          saveOwnership();
          // v6.5.0 — DJ takeover: the tapped song is the seed and the DJ
          // builds the continuation (startTrack asks for it at once because
          // the queue is one song long). Off, or when the caller insists on
          // its list, playback follows the tapped list as before.
          const settings = useSettingsStore.getState();
          const takeover = settings.djTakeover && settings.autoplay && !opts.keepList && !get().followMode && get().repeat === 'off';
          radio = takeover;
          if (takeover) {
            set({ queue: [seed], index: 0, currentTime: 0, duration: 0, loopA: null, loopB: null, tuneIntent: null });
            startTrack(seed, true);
            return;
          }
          const queue = stripExplicit(songs);
          const index = queue.indexOf(seed);
          set({ queue: [...queue], index, currentTime: 0, duration: 0, loopA: null, loopB: null, tuneIntent: null });
          startTrack(seed, true);
        },

        playSong: (song) => get().playQueue([song], 0),

        tuneQueue: (intent) => {
          if (intent !== null && !isTuneIntent(intent)) return;
          const { queue, index } = get();
          const current = queue[index];
          if (!current) return;
          const resolved: TuneIntent | null = intent === 'surprise' ? randomTune() : intent;
          // Keep what played, the current song and anything the listener queued
          // by hand; the rest of what follows is rebuilt.
          invalidateQueue();
          radio = true; // a tuned continuation is endless, like radio
          // 7.2.0 — a rebuild replaces the recommender's picks only. Songs the
          // listener queued by hand AND the list they started (an album, a
          // playlist, a Queue Builder plan) stay: "songs you added stay" has to
          // mean every song the DJ did not choose.
          const kept = [...queue.slice(0, index + 1), ...queue.slice(index + 1).filter((s) => !autoIds.has(s.id))];
          for (const s of queue.slice(index + 1)) autoIds.delete(s.id);
          set({ queue: kept, tuneIntent: resolved });
          void appendRecommendations(current).then((added) => {
            if (!added && get().queue.length === kept.length) toast('Could not retune right now — try again in a moment');
          });
        },
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
          if (index < 0 || index >= queue.length) return;
          resetSkipGuard(); // manual play
          maybeRecordSkip(true);
          const from = index === get().index + 1 ? queue[get().index] : null;
          set({ index, currentTime: 0, duration: 0, loopA: null, loopB: null });
          startTrack(queue[index], true, { from });
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
          // v7.0.0 — a hand-queued song goes ahead of whatever the recommender
          // appended (after the listener's own list and earlier hand-queued
          // songs), not behind eight automatic picks.
          const { index } = get();
          const firstAuto = queue.findIndex((s, i) => i > index && autoIds.has(s.id));
          const at = firstAuto < 0 ? queue.length : firstAuto;
          manualIds.add(song.id);
          saveOwnership();
          set({ queue: [...queue.slice(0, at), song, ...queue.slice(at)] });
          if (firstAuto >= 0) preloadUpcoming();
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
          const current = get().queue;
          const firstAuto = current.findIndex((s, i) => i > get().index && autoIds.has(s.id));
          const at = firstAuto < 0 ? current.length : firstAuto;
          for (const s of fresh) manualIds.add(s.id);
          saveOwnership();
          set({ queue: [...current.slice(0, at), ...fresh, ...current.slice(at)] });
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
          autoIds.delete(song.id);
          manualIds.add(song.id);
          saveOwnership();
          set({
            queue: [...filtered.slice(0, insertAt), song, ...filtered.slice(insertAt)],
            index: newIndex,
          });
          toast('Playing next');
        },

        removeAt: (i) => {
          const { queue, index, isPlaying } = get();
          if (i < 0 || i >= queue.length) return;
          invalidateQueue();
          const removingCurrent = i === index;
          lastRemoval = i > index ? { song: queue[i], at: i, manual: manualIds.has(queue[i].id), auto: autoMetaById.get(queue[i].id) ?? null, anchorId: queue[index]?.id ?? null } : null;
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
          invalidateQueue();
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
          finalizePlayback('cleared');
          playback = null;
          refetchAbort?.abort();
          refetchAbort = null;
          invalidateQueue();
          radio = false;
          clearSleepTimeout();
          autoIds.clear();
          autoMetaById.clear();
          manualIds.clear();
          lastRemoval = null;
          saveOwnership();
          audioEngine.pause();
          set({ queue: [], index: 0, isPlaying: false, currentTime: 0, duration: 0 });
          // 8.1.0 — an empty queue ends the media session: notification, lock-screen controls and the widget clear.
          updateMediaMetadata(null);
        },

        togglePlay: () => {
          transition += 1;
          const { isPlaying, queue, index } = get();
          const song = queue[index];
          if (!song) return;
          haptic('light');
          if (audioEngine.currentSongId !== song.id) {
            startTrack(song, true);
            return;
          }
          if (castInterceptPlayPause()) {
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
              const playing = queue[index];
              if (playing && canExtend()) {
                // 7.2.0 — the validated reserve first: the next song starts at
                // once while a fresh plan is built in the background.
                if (topUpFromReserve(playing) > 0) {
                  set({ index: index + 1, currentTime: 0, duration: 0 });
                  startTrack(get().queue[index + 1], true, { from: playing });
                  return;
                }
                const version = queueVersion;
                const ticket = ++transition;
                // Pause immediately so the existing player contract remains
                // synchronous; resume automatically once the async tail is
                // available — within the urgent deadline, never an AI's leash.
                set({ isPlaying: false });
                audioEngine.pause();
                void appendRecommendations(playing, { urgent: true }).then((added) => {
                  if (version !== queueVersion || ticket !== transition || get().queue[get().index]?.id !== playing.id || !canExtend()) return;
                  if (added || get().index < get().queue.length - 1) get().next(false);
                });
              } else {
                set({ isPlaying: false });
                audioEngine.pause();
              }
              return;
            }
          }
          const from = nextIndex === index + 1 ? queue[index] : null;
          set({ index: nextIndex, currentTime: 0, duration: 0 });
          startTrack(queue[nextIndex], true, { from });
        },

        autoTail: () => {
          const { queue, index } = get();
          return queue.slice(index + 1).filter((s) => autoIds.has(s.id));
        },
        isAutoQueued: (id) => autoIds.has(id),
        replaceAutoTail: (songs) => {
          const { queue, index } = get();
          const head = queue.slice(0, index + 1);
          // Everything that is not the recommender's — the listener's list and
          // hand-queued songs — keeps its place and its order.
          const manualTail = queue.slice(index + 1).filter((s) => !autoIds.has(s.id));
          const replacing = new Set(queue.slice(index + 1).filter((s) => autoIds.has(s.id)).map((s) => s.id));
          // 7.2.0 — the same current-state gate as every automatic mutation:
          // Kid mode, hidden songs and artists, muted languages, soft mutes,
          // identity, recent plays and this sitting's skips all hold here too.
          const { admitted: fresh } = admitSongs(songs, { queue, index, replacing });
          for (const id of replacing) {
            autoIds.delete(id);
            autoMetaById.delete(id);
          }
          markAuto(fresh, { alg: lastPlan?.alg ?? 'replan', picker: 'local', batch: (batchSeq += 1) });
          invalidateQueue();
          set({ queue: [...head, ...manualTail, ...fresh] });
          preloadUpcoming();
        },
        isManualQueued: (id) => manualIds.has(id),
        keepSong: (id) => {
          const { queue, index } = get();
          if (!autoIds.has(id) || !queue.some((s, i) => i > index && s.id === id)) return;
          // It stays where it is, but it is the listener's now: a rebuild or an AI refinement leaves it alone.
          autoIds.delete(id);
          autoMetaById.delete(id);
          manualIds.add(id);
          saveOwnership();
          set({ queue: [...queue] });
        },
        regenerateAutoTail: () => get().tuneQueue(get().tuneIntent),
        undoRemove: () => {
          const r = lastRemoval;
          lastRemoval = null;
          if (!r) return false;
          const { queue, index } = get();
          // Only while the same song is playing, and only if the song is not back already.
          if (!r.anchorId || queue[index]?.id !== r.anchorId || queue.some((s) => s.id === r.song.id)) return false;
          const at = Math.min(Math.max(index + 1, r.at), queue.length);
          invalidateQueue();
          if (r.manual) manualIds.add(r.song.id);
          else if (r.auto) {
            autoIds.add(r.song.id);
            autoMetaById.set(r.song.id, r.auto);
          }
          set({ queue: [...queue.slice(0, at), r.song, ...queue.slice(at)] });
          preloadUpcoming();
          return true;
        },
        playbackInstance: () => playback,
        autoMeta: (id) => autoMetaById.get(id) ?? null,
        applyPlan: (songs, mode) => {
          // 7.2.0 — a plan the listener installs keeps its order; the explicit
          // restrictions (Kid mode, hidden, muted languages, invalid entries) still hold.
          const clean = admitSongs(songs, { queue: get().queue, index: get().index, mode: 'plan' }).admitted;
          if (!clean.length) return;
          if (mode === 'replace') {
            autoIds.clear();
            get().playQueue(clean, 0, { keepList: true });
            return;
          }
          const { queue, index } = get();
          const head = queue.slice(0, index + 1);
          const seen = new Set(head.map((s) => s.id));
          const fresh = clean.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
          for (const s of queue.slice(index + 1)) autoIds.delete(s.id);
          invalidateQueue();
          set({ queue: [...head, ...fresh] });
          preloadUpcoming();
        },

        startRadio: (song, opts = {}) => {
          const seed = song ?? get().queue[get().index];
          if (!seed) return;
          // 8.2.0 — AI Radio seeds: distinct, valid, Kid-mode safe, at most RADIO_SEED_MAX.
          const seen = new Set<string>();
          const queue = stripExplicit([seed, ...(opts.seeds ?? []).filter(isValidSong)])
            .filter((s) => !seen.has(s.id) && !!seen.add(s.id))
            .slice(0, RADIO_SEED_MAX);
          if (!queue.length) return;
          const tune = opts.tune === 'surprise' ? randomTune() : opts.tune && isTuneIntent(opts.tune) ? opts.tune : null;
          finalizePlayback('replaced');
          invalidateQueue();
          radio = true;
          autoIds.clear();
          autoMetaById.clear();
          manualIds.clear();
          lastRemoval = null;
          sessionPlayed.clear();
          set({ queue, index: 0, currentTime: 0, duration: 0, isPlaying: true, tuneIntent: tune });
          startTrack(queue[0], true);
          // Plan the first continuation at once, after the last seed, so Up next shows where the radio goes.
          void appendRecommendations(queue[queue.length - 1]);
        },

        prev: () => {
          transition += 1;
          const { queue, index, currentTime } = get();
          if (!queue.length) return;
          haptic('light');
          if (currentTime > 3 || index === 0) {
            if (playback) noteSeek(playback, 0);
            audioEngine.seek(0);
            return;
          }
          set({ index: index - 1, currentTime: 0, duration: 0 });
          startTrack(queue[index - 1], true);
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
        },

        toggleShuffle: () => set({ shuffle: !get().shuffle }),

        setSleepTimer: (minutes) => {
          clearSleepTimeout();
          if (get().sleepAt != null) restoreVolume(); // cancelled or replaced inside the final fade
          set({ sleepAt: minutes == null ? null : Date.now() + minutes * 60_000, sleepAfterTrack: false });
          if (minutes != null) {
            toast(`Sleeping in ${minutes} min`);
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

        setCurrentAccent: (currentAccent) => set({ currentAccent }),
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
        // 7.2.0 — a queue stored by an older build can carry energy/tempo an AI
        // guessed. They were never measured, and the classifier fills them again
        // from cache when it can, so they are dropped rather than passed on as
        // catalogue metadata (services/ai/recommendations.ts tracks provenance).
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
