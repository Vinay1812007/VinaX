import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDjStore } from '@/store/djStore';
import { audioEngine } from '@/services/audio/engine';
import { onSpeakingChange, readAloud, setReadAloudVoiceFallback, stopReadAloud } from '@/features/ai/readAloud';

/** Same key and shape VinaX AI stores the Settings → Voice choice under: `model|persona`, or 'device'. */
const VOICE_PICK_KEY = 'vinax.aiVoice';

/** The persisted studio-voice choice, or null for the device voice. */
export function persistedVoicePick(): { model: string; voice: string } | null {
  try {
    const v = window.localStorage.getItem(VOICE_PICK_KEY);
    if (!v || v === 'device') return null;
    const [model, voice] = v.split('|');
    return model && voice ? { model, voice } : null;
  } catch {
    return null;
  }
}

/**
 * v5.12.0 — radio-DJ voice: every song is announced as it starts.
 * v6.2.0 — it now SAYS what the AI DJ wrote for the song (the segue line
 * from the last set it sequenced) and falls back to "Now playing …" when
 * there is none; it speaks in the listener's chosen studio voice with the
 * device voice as the offline fallback (features/ai/readAloud), and the
 * music ducks while the DJ talks, then comes back. Off by default; skipped
 * while a Listen Together session is being followed, and whenever the same
 * song merely resumes.
 */
let lastAnnounced = '';
let started = false;
let ducked = false;
const DUCK_LEVEL = 0.35;

/** What the DJ says for a song: its written segue when the AI DJ set one, else the plain intro. */
export function announcementFor(song: { title: string; subtitle: string; artists: Array<{ name: string }> }, segue: string | undefined): string {
  if (segue && segue.trim()) return segue.trim();
  const artist = song.artists[0]?.name ?? song.subtitle.split(',')[0] ?? '';
  return artist ? `Now playing ${song.title}, by ${artist}` : `Now playing ${song.title}`;
}

function duck(on: boolean): void {
  const s = usePlayerStore.getState();
  if (on && !ducked && !s.muted) {
    ducked = true;
    audioEngine.setVolume(Math.max(0.04, s.volume * DUCK_LEVEL));
  } else if (!on && ducked) {
    ducked = false;
    audioEngine.setVolume(s.muted ? 0 : s.volume);
  }
}

export function initDjVoice(): void {
  if (started || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  started = true;
  // Speak in the chosen studio voice everywhere, not only while the AI page is open.
  setReadAloudVoiceFallback(persistedVoicePick);
  onSpeakingChange((id) => duck(!!id && id.startsWith('dj:')));
  usePlayerStore.subscribe((state, prev) => {
    const song = state.queue[state.index];
    const before = prev.queue[prev.index];
    if (!song || !state.isPlaying) return;
    if (song.id === before?.id && prev.isPlaying) return;
    if (song.id === lastAnnounced) return;
    if (!useSettingsStore.getState().djVoice || state.followMode) return;
    lastAnnounced = song.id;
    const line = announcementFor(song, useDjStore.getState().segues[song.id]);
    stopReadAloud();
    readAloud(`dj:${song.id}`, line);
  });
}
