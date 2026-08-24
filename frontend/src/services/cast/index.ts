/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { isNativePlatform } from '@/services/native';
import { usePlayerStore } from '@/store/playerStore';
import { audioEngine, orderedSources } from '@/services/audio/engine';
import { useSettingsStore } from '@/store/settingsStore';
import { bestImage } from '@/utils/images';

export interface CastState {
  available: boolean;
  connected: boolean;
  deviceName: string | null;
  init: () => void;
}

// Minimal globals for Google Cast SDK
declare global {
  interface Window {
    __onGCastApiAvailable: (isAvailable: boolean) => void;
    cast: any;
    chrome: any;
  }
}

let player: any = null;
let controller: any = null;
let context: any = null;
let castBootstrapped = false;

/** Lazily inject the Google Cast SDK — only when the user opens the device
 *  picker — so it never loads on initial page load (faster, no console noise). */
let sdkRequested = false;
export function ensureCastSdk(): void {
  if (isNativePlatform() || sdkRequested || typeof document === 'undefined') return;
  sdkRequested = true;
  const s = document.createElement('script');
  s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  s.async = true;
  document.head.appendChild(s);
}

export const useCastStore = create<CastState>((set, get) => ({
  available: false,
  connected: false,
  deviceName: null,

  init: () => {
    if (isNativePlatform()) return; // Disable Cast inside Capacitor Android (unstable)

    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      if (!isAvailable || castBootstrapped) return;
      castBootstrapped = true;
      
      context = window.cast.framework.CastContext.getInstance();
      context.setOptions({
        receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });

      player = new window.cast.framework.RemotePlayer();
      controller = new window.cast.framework.RemotePlayerController(player);

      set({ available: true });

      // Listen for connection state changes
      context.addEventListener(
        window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event: any) => {
          const session = event.sessionState;
          if (session === window.cast.framework.SessionState.SESSION_STARTED || session === window.cast.framework.SessionState.SESSION_RESUMED) {
            const castSession = context.getCurrentSession();
            set({ connected: true, deviceName: castSession.getCastDevice().friendlyName });
            
            // Sync currently playing song to Cast device
            const { queue, index } = usePlayerStore.getState();
            const song = queue[index];
            if (song) {
              const url = orderedSources(song, useSettingsStore.getState().audioQuality)[0];
              if (url) {
                const mediaInfo = new window.chrome.cast.media.MediaInfo(url, castMime(url));
                mediaInfo.metadata = new window.chrome.cast.media.MusicTrackMediaMetadata();
                mediaInfo.metadata.title = song.title;
                mediaInfo.metadata.artist = song.subtitle;
                mediaInfo.metadata.images = [{ url: bestImage(song.images, 500) }];
                
                const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
                request.autoplay = usePlayerStore.getState().isPlaying;
                request.currentTime = usePlayerStore.getState().currentTime;

                // Mute local BEFORE the receiver actually starts to avoid the
                // brief interval where both the phone and the TV play the same
                // audio (double-audio during handoff). If the loadMedia call
                // fails, restore the previous local volume so we don't leave
                // the user silently muted.
                const prevVolume = usePlayerStore.getState().volume;
                audioEngine.setVolume(0);
                castSession.loadMedia(request).then(
                  () => {
                    // Keep local muted — playback is on the receiver.
                  },
                  (error: any) => {
                    audioEngine.setVolume(prevVolume);
                    if (import.meta.env.DEV) console.error('Cast load failed:', error);
                  }
                );
              }
            }
          } else if (session === window.cast.framework.SessionState.SESSION_ENDED) {
            set({ connected: false, deviceName: null });
            // Restore local playback volume
            audioEngine.setVolume(usePlayerStore.getState().volume);
          }
        }
      );

      // Listen for Cast remote player time updates to sync local store
      controller.addEventListener(
        window.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED,
        () => {
          if (get().connected && player.isMediaLoaded) {
            usePlayerStore.setState({ currentTime: player.currentTime });
          }
        }
      );
      
      controller.addEventListener(
        window.cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
        () => {
          if (get().connected && player.isMediaLoaded) {
            usePlayerStore.setState({ isPlaying: !player.isPaused });
          }
        }
      );
    };

    // Race guard: cast_sender.js is a classic (non-deferred) script and may
    // load + fire before this handler is attached. If the framework globals
    // already exist, invoke the handler now so Cast still initializes.
    if (window.cast?.framework && window.chrome?.cast) {
      window.__onGCastApiAvailable(true);
    }

    // 4.18.0 (PSI unused-JS pass): the SDK used to auto-inject at idle so
    // discovery was pre-armed — which meant EVERY web visit downloaded and
    // parsed Google's whole Cast framework (and logged a console error when
    // it couldn't phone home) for a picker almost no visit opens. It now
    // loads only when DeviceSheet opens (ensureCastSdk() there); discovery
    // arms a beat after the sheet appears instead of pre-emptively.
  },
}));

export function castMime(url: string): string {
  const m = url.match(/\.(mp4|m4a|aac|mp3|ogg|webm|flac|wav)(?:[?#]|$)/i);
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'wav') return 'audio/wav';
  return 'audio/mp4'; // m4a/mp4/aac, and the upstream default
}

/** Helper to intercept local player actions if casting */
export function castInterceptPlayPause(): boolean {
  const { connected } = useCastStore.getState();
  if (connected && controller) {
    controller.playOrPause();
    return true; // Intercepted
  }
  return false;
}

export function castInterceptSeek(seconds: number): boolean {
  const { connected } = useCastStore.getState();
  if (connected && player && controller) {
    player.currentTime = seconds;
    controller.seek();
    return true; // Intercepted
  }
  return false;
}
