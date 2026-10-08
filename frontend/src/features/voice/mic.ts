/**
 * 11.3.2 — opening the microphone, and making sure it is a working one.
 *
 * The owner's Chrome used a virtual audio cable ("BlackHole 2ch (Virtual)")
 * as its microphone for the site: getUserMedia succeeded, the track was live,
 * and every sample was exactly zero. Voice chat waited forever and dictation
 * "didn't hear anything". Chrome keeps its own microphone choice per site, so
 * the Mac's default (the built-in mic) was never used.
 *
 * openMic():
 *   1. opens the listener's chosen microphone (Settings → Voice → Microphone),
 *      else the browser's choice;
 *   2. listens for a moment: a stream of pure digital silence (every sample
 *      exactly 0 — a real mic always carries some noise) is a dead input;
 *   3. then tries the system default and every other input in turn, keeps the
 *      first that is not silent, remembers it, and says which one it took.
 *
 * Nothing is recorded or sent here; only the level is read.
 */

export const MIC_KEY = 'vinax.ai.micDevice';

export interface MicInput {
  id: string;
  label: string;
}

export interface OpenedMic {
  stream: MediaStream;
  /** The microphone in use, by its name. */
  label: string;
  /** Set when a silent microphone was replaced: the silent one's name. */
  replaced?: string;
  /** Every input was silent (the stream is the first one, kept open anyway). */
  allSilent?: boolean;
}

export function loadMicChoice(): string {
  try {
    return localStorage.getItem(MIC_KEY) ?? '';
  } catch {
    return '';
  }
}

/** '' = the browser's choice. */
export function saveMicChoice(id: string): void {
  try {
    if (id) localStorage.setItem(MIC_KEY, id);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    /* private mode */
  }
}

/** The microphones this browser offers (names once access was granted). */
export async function listMics(): Promise<MicInput[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
      .map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' }));
  } catch {
    return [];
  }
}

const constraints = (deviceId?: string): MediaStreamConstraints => ({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
});

/** True when the stream carries nothing but exact zeros for `ms`. A real
 *  microphone — even in a silent room, even with noise suppression — never
 *  produces a run of perfect zeros; a virtual cable with nothing playing does. */
export async function isDigitallySilent(stream: MediaStream, ms = 700): Promise<boolean> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return false;
  let ctx: AudioContext | null = null;
  try {
    ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    // A context that cannot run reads as silence — say "not silent" rather than guess.
    if (ctx.state !== 'running') return false;
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const end = performance.now() + ms;
    // The first frames of a fresh track can be zeros on any device: give it a beat.
    await new Promise((r) => setTimeout(r, 120));
    while (performance.now() < end) {
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i += 1) if (buf[i] !== 0) return false;
      await new Promise((r) => setTimeout(r, 60));
    }
    return true;
  } catch {
    return false;
  } finally {
    void ctx?.close().catch(() => undefined);
  }
}

const firstTrack = (s: MediaStream): MediaStreamTrack | undefined => (typeof s.getAudioTracks === 'function' ? s.getAudioTracks()[0] : undefined);
const trackLabel = (s: MediaStream): string => firstTrack(s)?.label || 'Microphone';
const trackDevice = (s: MediaStream): string => firstTrack(s)?.getSettings?.().deviceId ?? '';
const stop = (s: MediaStream): void => s.getTracks().forEach((t) => t.stop());

/**
 * Open a working microphone (see the file header). Rejects like getUserMedia
 * when access is refused or no microphone exists.
 */
export async function openMic(opts: { check?: boolean } = {}): Promise<OpenedMic> {
  const chosen = loadMicChoice();
  let first: MediaStream;
  try {
    first = await navigator.mediaDevices.getUserMedia(constraints(chosen || undefined));
  } catch (err) {
    // The chosen microphone is gone (unplugged): forget it and use the browser's choice.
    const name = (err as { name?: string } | null)?.name;
    if (!chosen || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
    saveMicChoice('');
    first = await navigator.mediaDevices.getUserMedia(constraints());
  }
  if (opts.check === false || !(await isDigitallySilent(first))) return { stream: first, label: trackLabel(first) };

  const silentLabel = trackLabel(first);
  const tried = new Set([trackDevice(first)]);
  const candidates = await listMics();
  // The system default first, then the rest in the browser's order.
  const order = [...candidates.filter((d) => d.id === 'default'), ...candidates.filter((d) => d.id !== 'default')];
  for (const d of order) {
    if (tried.has(d.id)) continue;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia(constraints(d.id));
    } catch {
      continue;
    }
    tried.add(trackDevice(s));
    if (!(await isDigitallySilent(s))) {
      stop(first);
      // Remember the working one, so the next chat opens it straight away.
      saveMicChoice(d.id);
      return { stream: s, label: trackLabel(s), replaced: silentLabel };
    }
    stop(s);
  }
  return { stream: first, label: silentLabel, allSilent: true };
}
