/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The Cast web SDK as a CastTransport. Loaded with the SDK itself, when the
 * device sheet first opens (services/cast ensureCastSdk), never in the first
 * load. Receiver: Google's Default Media Receiver — the Android app's
 * VinaxCastOptionsProvider.java names the same one.
 */
import { useCastStore, setCastTransport } from './index';
import { castSessionStarted, castSessionEnded, castRemoteTime, castRemotePlaying } from './session';

// Minimal globals for Google Cast SDK
declare global {
  interface Window {
    __onGCastApiAvailable: (isAvailable: boolean) => void;
    cast: any;
    chrome: any;
  }
}

let booted = false;

function onSdk(isAvailable: boolean): void {
  if (!isAvailable || booted) return;
  booted = true;
  const fw = window.cast.framework;
  const media = window.chrome.cast.media;

  const context = fw.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  const player = new fw.RemotePlayer();
  const controller = new fw.RemotePlayerController(player);

  setCastTransport({
    load: (m, opts) => {
      const info = new media.MediaInfo(m.url, m.contentType);
      info.metadata = new media.MusicTrackMediaMetadata();
      info.metadata.title = m.title;
      info.metadata.artist = m.artist;
      info.metadata.images = m.image ? [{ url: m.image }] : [];
      const request = new media.LoadRequest(info);
      request.autoplay = opts.autoplay;
      request.currentTime = opts.startTime;
      const session = context.getCurrentSession();
      return session ? session.loadMedia(request) : Promise.reject(new Error('No cast session'));
    },
    // The SDK only toggles: toggle when the TV is not already where the listener asked.
    setPlaying: (play) => {
      if (player.isPaused === play) controller.playOrPause();
    },
    seek: (seconds) => {
      player.currentTime = seconds;
      controller.seek();
    },
    setVolume: (level) => {
      player.volumeLevel = level;
      controller.setVolumeLevel();
    },
    requestSession: () => {
      void Promise.resolve(context.requestSession()).catch(() => undefined); // closing the picker rejects
    },
  });

  useCastStore.setState({ available: true });

  context.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, (event: any) => {
    const state = event.sessionState;
    if (state === fw.SessionState.SESSION_STARTED || state === fw.SessionState.SESSION_RESUMED) {
      castSessionStarted(context.getCurrentSession()?.getCastDevice().friendlyName ?? null);
    } else if (state === fw.SessionState.SESSION_ENDED) {
      castSessionEnded();
    }
  });

  const url = (): string | undefined => player.mediaInfo?.contentId;
  controller.addEventListener(fw.RemotePlayerEventType.CURRENT_TIME_CHANGED, () => {
    if (player.isMediaLoaded) castRemoteTime(player.currentTime, url(), !player.isPaused);
  });
  controller.addEventListener(fw.RemotePlayerEventType.IS_PAUSED_CHANGED, () => {
    if (player.isMediaLoaded) castRemotePlaying(!player.isPaused, url());
  });
}

/** Ready for the SDK: call before its script is added. */
export function bootWebCast(): void {
  window.__onGCastApiAvailable = onSdk;
  // Race guard: if the framework globals already exist (the script ran
  // first), start now so Cast still initializes.
  if (window.cast?.framework && window.chrome?.cast) onSdk(true);
}
