import type { Song } from '@/types';
import { getOfflineSources } from '@/services/downloads';

export type AudioQualityPref = 'low' | 'medium' | 'high';

/** Parse the bitrate (kbps) out of a quality label like "320kbps", "320" or "320 kbps". */
function bitrateOf(quality: string): number {
  const m = String(quality).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Order a song's audio variants by the user's quality preference — by NUMERIC
 * bitrate, so it's robust to however each upstream labels its streams (some
 * return "320kbps", some "320", some list them low-to-high). "high" always puts
 * the highest available bitrate first; "medium"/"low" target ~160/~96 kbps and
 * fall back to the nearest. Previously an unrecognized label sorted the LOWEST
 * bitrate first, so headphones/Bluetooth got 48-96 kbps even on "high".
 */
/**
 * Bluetooth/output-handoff recovery policy: a source that has actually played
 * gets ONE same-position retry before stepping down a tier; a URL that never
 * played advances immediately. Pure so the rule is locked by unit tests.
 */
export function recoveryAction(srcPlayedOk: boolean, retriedCurrentSrc: boolean): 'retry-same' | 'advance' {
  return srcPlayedOk && !retriedCurrentSrc ? 'retry-same' : 'advance';
}

export function orderedSources(song: Song, pref: AudioQualityPref): string[] {
  const target = pref === 'high' ? Infinity : pref === 'low' ? 96 : 160;
  return [...song.audio]
    .filter((v) => v.url)
    .sort((a, b) => {
      const ba = bitrateOf(a.quality);
      const bb = bitrateOf(b.quality);
      if (pref === 'high') return bb - ba;
      return Math.abs(ba - target) - Math.abs(bb - target) || bb - ba;
    })
    .map((v) => v.url);
}

export interface EngineCallbacks {
  onTime(current: number, duration: number): void;
  onPlayState(playing: boolean): void;
  onBuffering(buffering: boolean): void;
  onEnded(): void;
  /** All audio sources for the current song failed. */
  onFatalError(songId: string): void;
  /** Fired whenever the active stream changes — bitrate (kbps) or null if unknown/offline. */
  onSource?(bitrate: number | null): void;
  /** Autoplay was blocked by the browser (needs a user gesture). */
  onBlocked?(): void;
}

/**
 * Singleton playback engine over a single HTMLAudioElement. Owns source
 * fallback (a bad CDN URL silently advances to the next quality variant),
 * keeps listeners attached exactly once, and reports state upward through
 * callbacks — the Zustand player store is the single consumer.
 */
class AudioEngine {
  private el: HTMLAudioElement | null = null;
  private sinkId = '';
  private cb: EngineCallbacks | null = null;
  private song: Song | null = null;
  private sources: string[] = [];
  private sourceIdx = 0;
  /** Set on element pauses we didn't request — call / audio-focus loss. */
  lastInterruptionAt = 0;
  private lastIntentionalPause = 0;
  private wantAutoplay = false;
  private lastTime = 0;
  private srcPlayedOk = false;
  private retriedCurrentSrc = false;
  private pendingSeek = 0;
  private stallTimer: number | null = null;

  init(cb: EngineCallbacks): void {
    this.cb = cb;
    if (this.el) return;
    const el = new Audio();
    this.applySink(el);
    el.preload = 'auto';
    el.addEventListener('timeupdate', () => {
      this.clearStall();
      this.lastTime = el.currentTime;
      if (el.currentTime > 1.5) this.srcPlayedOk = true;
      this.cb?.onTime(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0);
    });
    el.addEventListener('durationchange', () =>
      this.cb?.onTime(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0),
    );
    el.addEventListener('play', () => this.cb?.onPlayState(true));
    el.addEventListener('pause', () => {
      this.clearStall();
      // A pause we didn't ask for (phone call, audio-focus loss): remember it
      // so the app can auto-resume once it regains the foreground.
      if (Date.now() - this.lastIntentionalPause > 1500 && !el.ended && el.currentTime > 0) {
        this.lastInterruptionAt = Date.now();
      }
      this.cb?.onPlayState(false);
    });
    el.addEventListener('waiting', () => {
      this.cb?.onBuffering(true);
      this.armStall();
    });
    el.addEventListener('playing', () => {
      this.srcPlayedOk = true;
      this.clearStall();
      this.cb?.onBuffering(false);
    });
    el.addEventListener('canplay', () => {
      this.clearStall();
      this.cb?.onBuffering(false);
    });
    el.addEventListener('loadeddata', () => {
      // Resume position after a mid-track source switch (quality fallback or a
      // transient Bluetooth/output-handoff error) so the track never restarts.
      if (this.pendingSeek > 0 && Number.isFinite(el.duration)) {
        try {
          el.currentTime = Math.min(this.pendingSeek, Math.max(0, el.duration - 0.3));
        } catch {
          /* ignore */
        }
        this.pendingSeek = 0;
      }
    });
    el.addEventListener('ended', () => {
      this.clearStall();
      this.cb?.onEnded();
    });
    el.addEventListener('error', () => this.handleMediaError());
    this.el = el;
  }

  get currentSongId(): string | null {
    return this.song?.id ?? null;
  }

  /**
   * Best-effort bitrate (kbps) of the stream playing right now, parsed from the
   * source URL — saavn CDN urls embed it (e.g. ..._320.mp4). null when unknown
   * or playing an offline file.
   */
  currentBitrate(): number | null {
    const url = this.sources[this.sourceIdx];
    if (!url) return null;
    const m = url.match(/[_/](\d{2,3})\.(?:mp4|m4a|mp3|aac)(?:$|\?)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /** Re-apply the chosen output to a (possibly brand-new) element — without
   *  this, the gapless preload element plays on the default speaker and the
   *  output silently "reverts" on the next track. */
  private applySink(target: HTMLAudioElement): void {
    const s = target as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (this.sinkId && typeof s.setSinkId === 'function') {
      s.setSinkId(this.sinkId).catch(() => undefined);
    }
  }

  /** Route playback to a specific output device via setSinkId (Chrome/Edge).
   *  Empty id = system default. Returns false when unsupported or it fails. */
  async setOutputDevice(deviceId: string): Promise<boolean> {
    const el = this.el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!el || typeof el.setSinkId !== 'function') return false;
    try {
      await el.setSinkId(deviceId);
    } catch {
      // Chrome may refuse until the page has a media grant — ask once
      // (explicit user action brought us here), then retry.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        await el.setSinkId(deviceId);
      } catch {
        return false;
      }
    }
    this.sinkId = deviceId;
    const pre = this.preloadEl as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (pre && typeof pre.setSinkId === 'function') {
      try {
        await pre.setSinkId(deviceId);
      } catch {
        /* preload sink is best-effort */
      }
    }
    return true;
  }

  load(song: Song, pref: AudioQualityPref, autoplay: boolean): void {
    if (!this.el) return;
    this.song = song;
    const streaming = orderedSources(song, pref);
    // v5.6.0 — every offline source, best first (blob: → SW route → file
    // bridge), ahead of streaming: a saved song exhausts local copies before
    // it ever touches the network.
    const offline = getOfflineSources(song.id);
    this.sources = offline.length ? [...offline, ...streaming] : streaming;
    this.sourceIdx = 0;
    this.wantAutoplay = autoplay;
    this.lastTime = 0;
    this.srcPlayedOk = false;
    this.retriedCurrentSrc = false;
    this.pendingSeek = 0;
    if (this.sources.length === 0) {
      this.cb?.onFatalError(song.id);
      return;
    }
    this.applySource();
  }

  private applySource(): void {
    if (!this.el || !this.song) return;
    this.cb?.onBuffering(true);
    this.el.src = this.sources[this.sourceIdx];
    this.el.load();
    this.cb?.onSource?.(this.currentBitrate());
    if (this.wantAutoplay) {
      this.armStall();
      void this.el.play().catch((err: unknown) => {
        // Autoplay policy rejection — surface paused state, user taps play.
        this.clearStall();
        this.cb?.onPlayState(false);
        this.cb?.onBuffering(false);
        if (err instanceof DOMException && err.name === 'NotAllowedError') this.cb?.onBlocked?.();
      });
    }
  }

  private clearStall(): void {
    if (this.stallTimer != null) {
      window.clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  /** Watchdog: if a source stalls with no progress for ~15s, step to the next
   *  source / song instead of hanging on a slow or dead stream. */
  private armStall(): void {
    this.clearStall();
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      this.advanceSource();
    }, 15000);
  }

  /**
   * An output/device handoff (e.g. Bluetooth A2DP) can momentarily error the
   * element even when the URL is fine. If the current source had been playing,
   * retry it once at the same position before stepping down a quality tier —
   * this stops a Bluetooth connect from restarting the track or dropping it to
   * a lower bitrate. Genuine bad URLs (never played) fall straight through.
   */
  private handleMediaError(): void {
    // Policy is pure + unit-tested (recoveryAction); this method only applies it.
    this.clearStall();
    void import('@/services/analytics/telemetry').then((m) => m.reportError('playback', 'audio element error')).catch(() => undefined);
    if (!this.song) return;
    if (recoveryAction(this.srcPlayedOk, this.retriedCurrentSrc) === 'retry-same') {
      this.retriedCurrentSrc = true;
      this.srcPlayedOk = false;
      this.pendingSeek = this.lastTime;
      this.applySource();
      return;
    }
    this.advanceSource();
  }

  private advanceSource(): void {
    if (!this.song) return;
    if (this.sourceIdx < this.sources.length - 1) {
      this.sourceIdx += 1;
      this.retriedCurrentSrc = false;
      this.srcPlayedOk = false;
      this.pendingSeek = this.lastTime; // resume seamlessly at the new quality
      this.applySource();
    } else {
      this.cb?.onBuffering(false);
      this.cb?.onFatalError(this.song.id);
    }
  }

  /** Retry the current song with freshly-fetched URLs (details refetch). */
  reloadWithSources(urls: string[]): boolean {
    if (!this.el || !this.song || urls.length === 0) return false;
    this.sources = urls;
    this.sourceIdx = 0;
    this.srcPlayedOk = false;
    this.retriedCurrentSrc = false;
    this.pendingSeek = 0;
    this.applySource();
    return true;
  }

  play(): void {
    void this.el?.play().catch((err: unknown) => {
      this.cb?.onPlayState(false);
      if (err instanceof DOMException && err.name === 'NotAllowedError') this.cb?.onBlocked?.();
    });
  }

  pause(): void {
    this.lastIntentionalPause = Date.now();
    this.el?.pause();
  }

  seek(seconds: number): void {
    if (this.el && Number.isFinite(seconds)) this.el.currentTime = Math.max(0, seconds);
  }

  /** User-intended volume; fades animate el.volume toward this. */
  private targetVolume = 1;
  private fadeTimer: number | null = null;

  setVolume(v: number): void {
    this.targetVolume = Math.min(1, Math.max(0, v));
    this.cancelFade();
    if (this.el) this.el.volume = this.targetVolume;
  }

  private cancelFade(): void {
    if (this.fadeTimer != null) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  /** Ramp el.volume from `from` to `to` over `ms`, then run `done`. */
  private fade(from: number, to: number, ms: number, done?: () => void): void {
    if (!this.el) return;
    this.cancelFade();
    // Browsers throttle setInterval to ≥1s (and rAF to ~1 fps) in hidden
    // tabs, so a fade started while the tab is backgrounded would stall
    // audibly mid-ramp (audit finding M8). Jump straight to the target and
    // fire `done` on the next microtask instead — the audible outcome is
    // effectively the same when the user can't hear the tab anyway.
    if (typeof document !== 'undefined' && document.hidden) {
      this.el.volume = Math.min(1, Math.max(0, to));
      queueMicrotask(() => done?.());
      return;
    }
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    this.el.volume = Math.min(1, Math.max(0, from));
    const target = Math.min(1, Math.max(0, to));
    // If the tab is hidden mid-fade, browsers throttle setInterval to ≥1s and
    // the fade stalls audibly. Snap to target and clear the loop the moment
    // visibility flips to hidden, so a foreground → background transition
    // during a crossfade tail never leaves the track lingering at half-volume.
    const onVisibility = (): void => {
      if (typeof document !== 'undefined' && document.hidden) {
        this.cancelFade();
        if (this.el) this.el.volume = target;
        document.removeEventListener('visibilitychange', onVisibility);
        done?.();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    this.fadeTimer = window.setInterval(() => {
      i += 1;
      const t = i / steps;
      if (this.el) this.el.volume = Math.min(1, Math.max(0, from + (to - from) * t));
      if (i >= steps) {
        this.cancelFade();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibility);
        }
        done?.();
      }
    }, 50);
  }

  /** Fade the current track up from silence (crossfade-in on track start). */
  fadeIn(ms = 1200): void {
    this.fade(0, this.targetVolume, ms);
  }

  /** Fade the current track out to silence (crossfade tail). */
  fadeOut(ms = 1200): void {
    this.fade(this.el?.volume ?? this.targetVolume, 0, ms);
  }

  /** Sleep-fade: ramp to silence then pause + callback. */
  fadeOutAndPause(ms: number, done: () => void): void {
    if (!this.el) {
      done();
      return;
    }
    this.fade(this.el.volume, 0, ms, () => {
      // Mark this pause as INTENTIONAL before triggering it. Without this,
      // the `pause` event handler treated the fade's implicit pause as an
      // audio-focus interruption and set lastInterruptionAt — so the next
      // foreground within 30 min would call togglePlay() and defeat the
      // sleep timer (audit finding H3).
      this.lastIntentionalPause = Date.now();
      this.el?.pause();
      if (this.el) this.el.volume = this.targetVolume; // restore for next play
      done();
    });
  }

  setMuted(m: boolean): void {
    if (this.el) this.el.muted = m;
  }

  setRate(r: number): void {
    if (this.el) this.el.playbackRate = r;
  }

  /**
   * Prefetch the likely-next track's audio so track changes feel instant.
   * Uses a detached, muted element — never plays, never fires callbacks.
   */
  private preloadEl: HTMLAudioElement | null = null;

  preloadNext(url: string | null): void {
    if (!url) return;
    // Never burn mobile data on a preload the user won't hear soon: skip when
    // the tab is hidden. The next visibility-visible timeupdate will re-arm.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!this.preloadEl) {
      this.preloadEl = new Audio();
      this.preloadEl.muted = true;
      this.preloadEl.preload = 'auto';
      this.applySink(this.preloadEl);
    }
    if (this.preloadEl.src !== url) {
      // A bad preload URL keeps a stale src on the element and blocks future
      // preloads. On error, clear the src so the next preloadNext() retries
      // cleanly instead of silently failing forever.
      const el = this.preloadEl;
      el.addEventListener(
        'error',
        () => {
          el.removeAttribute('src');
          el.load();
        },
        { once: true },
      );
      el.src = url;
    }
  }

  destroy(): void {
    this.cancelFade();
    this.clearStall();
    if (this.preloadEl) {
      this.preloadEl.pause();
      this.preloadEl.removeAttribute('src');
      this.preloadEl.load();
      this.preloadEl = null;
    }
    if (this.el) {
      this.el.pause();
      this.el.src = '';
    }
    this.el = null;
    this.cb = null;
    this.song = null;
  }
}

export const audioEngine = new AudioEngine();
