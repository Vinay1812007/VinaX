/* eslint-disable @typescript-eslint/no-explicit-any */
import { registerPlugin } from '@capacitor/core';
import type { Song } from '@/types';
import { bestImage } from '@/utils/images';
import { artworkDataUrl } from '@/utils/artwork';
import { isNativePlatform } from '@/services/native';

export interface MediaHandlers {
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seekTo(seconds: number): void;
  /** Relative seek — lock screens and headsets send ±10s jumps. */
  seekBy(delta: number): void;
}

export interface MediaSessionLogEntry {
  ts: number;
  call: string;
  ok: boolean;
  detail?: string;
}

/** VinaX's own native plugin (android/native-android/VinaxMediaPlugin.java). */
interface VinaxMediaPlugin {
  setMetadata(o: { title: string; artist: string; album: string; artwork: string }): Promise<void>;
  setPlaybackState(o: { playbackState: 'playing' | 'paused' | 'none' }): Promise<void>;
  setPosition(o: { duration: number; position: number; playbackRate: number }): Promise<void>;
  provideChildren(o: { parentId: string; items: { id: string; title: string; subtitle: string; iconUrl?: string; playable: boolean }[] }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    event: 'action' | 'requestChildren',
    cb: (data: any) => void,
  ): Promise<{ remove: () => void }>;
}

const native = isNativePlatform();
const VinaxMedia = native ? registerPlugin<VinaxMediaPlugin>('VinaxMedia') : null;

const log: MediaSessionLogEntry[] = [];
function record(call: string, ok: boolean, detail?: string): void {
  log.push({ ts: Date.now(), call, ok, detail });
  if (log.length > 12) log.shift();
}
export function getMediaSessionLog(): MediaSessionLogEntry[] {
  return [...log].reverse();
}

void (async () => {
  try {
    const { Capacitor } = await import('@capacitor/core');
    record(
      `env: platform=${Capacitor.getPlatform()} native=${native} pluginAvailable=${Capacitor.isPluginAvailable('VinaxMedia')}`,
      native && Capacitor.isPluginAvailable('VinaxMedia'),
    );
  } catch (err) {
    record('env-check', false, String(err));
  }
})();

let _actionListenerHandle: { remove: () => void } | null = null;
let _childrenListenerHandle: { remove: () => void } | null = null;
// In-flight guard: two quick setMediaHandlers() calls (e.g. store rehydrate +
// first-play) can both slip past the remove() before either resolves, leaving
// stale duplicate listeners that fire play/pause twice per remote press.
let _pendingActionHandlerSetup: Promise<{ remove: () => void }> | null = null;
let _pendingChildrenHandlerSetup: Promise<{ remove: () => void }> | null = null;

const webSupported = (): boolean => typeof navigator !== 'undefined' && 'mediaSession' in navigator;

async function handleAutomotiveBrowse(parentId: string): Promise<void> {
  if (!native || !VinaxMedia) return;
  const items: { id: string; title: string; subtitle: string; iconUrl?: string; playable: boolean }[] = [];
  
  try {
    if (parentId === 'vinax_root') {
      items.push(
        { id: 'cat_nowplaying', title: 'Now Playing Queue', subtitle: 'Current session', playable: false },
        { id: 'cat_favorites', title: 'Favorites', subtitle: 'Saved songs', playable: false }
      );
    } else if (parentId === 'cat_nowplaying') {
      const { usePlayerStore } = await import('@/store/playerStore');
      const queue = usePlayerStore.getState().queue;
      for (const song of queue) {
        items.push({
          id: `song_${song.id}`,
          title: song.title,
          subtitle: song.subtitle,
          iconUrl: bestImage(song.images, 300),
          playable: true,
        });
      }
    } else if (parentId === 'cat_favorites') {
      const { useLibraryStore } = await import('@/store/libraryStore');
      const favs = useLibraryStore.getState().favorites;
      for (const song of favs) {
        items.push({
          id: `song_${song.id}`,
          title: song.title,
          subtitle: song.subtitle,
          iconUrl: bestImage(song.images, 300),
          playable: true,
        });
      }
    }
  } catch (e) {
    record('autoBrowse', false, String(e));
  }
  
  void VinaxMedia.provideChildren({ parentId, items });
}

export async function setMediaHandlers(h: MediaHandlers): Promise<void> {
  if (native && VinaxMedia) {
    // Wait for any in-flight setup to settle so its handle is caught by the
    // remove() below instead of leaking as a duplicate listener.
    if (_pendingActionHandlerSetup) {
      try { await _pendingActionHandlerSetup; } catch { /* ignore */ }
    }
    if (_pendingChildrenHandlerSetup) {
      try { await _pendingChildrenHandlerSetup; } catch { /* ignore */ }
    }
    _actionListenerHandle?.remove();
    _actionListenerHandle = null;
    _childrenListenerHandle?.remove();
    _childrenListenerHandle = null;

    _pendingActionHandlerSetup = VinaxMedia.addListener('action', (d: any) => {
      switch (d.action) {
        case 'play': h.play(); break;
        case 'pause': h.pause(); break;
        case 'nexttrack': h.next(); break;
        case 'previoustrack': h.prev(); break;
        case 'stop': h.pause(); break;
        case 'seekto': if (d.seekTime != null) h.seekTo(d.seekTime); break;
        case 'seekbackward': h.seekBy(-10); break;
        case 'seekforward': h.seekBy(10); break;
        case 'openplayer':
          // Notification body tapped (4.16.1): MainActivity relays the launch
          // intent's open-player extra here — AppLayout listens on 'vx:np'
          // (short name: this chunk is first-load-budgeted) and navigates to
          // the full-screen player.
          window.dispatchEvent(new CustomEvent('vx:np'));
          break;
        case 'playFromId':
          if (d.mediaId && d.mediaId.startsWith('song_')) {
            const id = d.mediaId.replace('song_', '');
            void import('@/services/api')
              .then(({ getSong }) =>
                getSong(id).then((song) => {
                  void import('@/store/playerStore').then(({ usePlayerStore }) => {
                    usePlayerStore.getState().playSong(song);
                  });
                }),
              )
              .catch((err) => {
                // Auto browse "play from id" can miss (network drop, deleted song, dynamic
                // import failure) — log instead of exploding as an unhandled rejection.
                console.warn('[media-session] playFromId failed', err);
              });
          }
          break;
      }
    });
    try {
      const handle = await _pendingActionHandlerSetup;
      _actionListenerHandle = handle;
      record('addListener(action)', true);
    } finally {
      _pendingActionHandlerSetup = null;
    }

    _pendingChildrenHandlerSetup = VinaxMedia.addListener('requestChildren', (d: any) => {
      if (d.parentId) void handleAutomotiveBrowse(d.parentId);
    });
    try {
      const handle = await _pendingChildrenHandlerSetup;
      _childrenListenerHandle = handle;
    } finally {
      _pendingChildrenHandlerSetup = null;
    }
    return;
  }
  if (!webSupported()) return;
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler('play', () => h.play());
    ms.setActionHandler('pause', () => h.pause());
    ms.setActionHandler('nexttrack', () => h.next());
    ms.setActionHandler('previoustrack', () => h.prev());
    ms.setActionHandler('seekto', (e) => { if (e.seekTime != null) h.seekTo(e.seekTime); });
    ms.setActionHandler('seekbackward', (e) => h.seekBy(-(e.seekOffset ?? 10)));
    ms.setActionHandler('seekforward', (e) => h.seekBy(e.seekOffset ?? 10));
  } catch {
    /* per-browser support varies */
  }
}

// Cached current metadata so the lyric line can be pushed cheaply to BOTH the
// native notification and the web Media Session (lock-screen / OS media UI).
let _song: Song | null = null;
let _artwork = '';
let _lyricLine: string | null = null;

function pushNativeMetadata(): void {
  if (!native || !VinaxMedia || !_song) return;
  void VinaxMedia.setMetadata({
    title: _song.title,
    artist: _lyricLine || _song.subtitle,
    album: _song.album?.name ?? 'VinaX',
    artwork: _artwork,
  })
    .then(() => record('setMetadata', true))
    .catch((e) => record('setMetadata', false, String(e)));
}

function pushWebMetadata(): void {
  if (!webSupported()) return;
  navigator.mediaSession.metadata = _song
    ? new MediaMetadata({
        title: _song.title,
        artist: _lyricLine || _song.subtitle,
        album: _song.album?.name ?? 'VinaX',
        artwork: [{ src: bestImage(_song.images, 500), sizes: '500x500', type: 'image/jpeg' }],
      })
    : null;
}

export function updateMediaMetadata(song: Song | null): void {
  _song = song;
  _lyricLine = null;
  _artwork = '';
  if (native && VinaxMedia) {
    if (!song) return;
    pushNativeMetadata(); // show immediately; artwork fills in once decoded
    const artUrl = bestImage(song.images, 500);
    void artworkDataUrl(artUrl)
      .catch(() => null)
      .then((dataUri) => {
        _artwork = dataUri ?? '';
        pushNativeMetadata();
      });
    return;
  }
  pushWebMetadata();
}

/**
 * Lock-screen lyrics: show the current synced line where the artist name
 * normally appears on the lock screen / media controls (native AND web). Pass
 * null to restore the artist name. Only re-sends when the line changes.
 */
export function setLockScreenLyricLine(line: string | null): void {
  if (!_song) return;
  const next = line && line.trim() ? line.trim() : null;
  if (next === _lyricLine) return;
  _lyricLine = next;
  if (native && VinaxMedia) pushNativeMetadata();
  else pushWebMetadata();
}

export function updatePlaybackState(playing: boolean): void {
  if (native && VinaxMedia) {
    void VinaxMedia.setPlaybackState({ playbackState: playing ? 'playing' : 'paused' })
      .then(() => record(`setPlaybackState(${playing ? 'playing' : 'paused'})`, true))
      .catch((e) => record('setPlaybackState', false, String(e)));
    return;
  }
  if (!webSupported()) return;
  navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

let lastSentPosition = -10;
export function updatePositionState(duration: number, position: number, rate: number): void {
  if (!(duration > 0) || position > duration) return;
  if (native && VinaxMedia) {
    if (Math.abs(position - lastSentPosition) < 1) return;
    lastSentPosition = position;
    void VinaxMedia.setPosition({ duration, position, playbackRate: rate }).catch(() => undefined);
    return;
  }
  if (!webSupported() || !navigator.mediaSession.setPositionState) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position, playbackRate: rate });
  } catch {
    /* transient invalid states */
  }
}

export async function runNotificationSelfTest(): Promise<boolean> {
  if (!native || !VinaxMedia) return false;
  try {
    await VinaxMedia.setMetadata({ title: 'VinaX Test Tone', artist: 'Notification self-test', album: 'VinaX', artwork: '' });
    await VinaxMedia.setPlaybackState({ playbackState: 'playing' });
    record('selfTest(start)', true);
    window.setTimeout(() => {
      void VinaxMedia.setPlaybackState({ playbackState: 'paused' }).catch(() => undefined);
    }, 6000);
    return true;
  } catch (err) {
    record('selfTest', false, String(err));
    return false;
  }
}
