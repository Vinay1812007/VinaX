import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { pickSynthVoice } from '@/features/voice/pickSynthVoice';

/**
 * v5.12.0 — radio-DJ voice. When the listener switches it on, every song is
 * announced as it starts ("Now playing … by …") through the browser's own
 * speech synthesis — no network, no extra permission. Off by default;
 * skipped while a Listen Together session is being followed, and whenever
 * the same song merely resumes.
 */
let lastAnnounced = '';
let started = false;

function say(text: string): void {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickSynthVoice('en-IN');
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 1;
    u.volume = 0.9;
    synth.speak(u);
  } catch {
    /* no speech on this platform */
  }
}

export function initDjVoice(): void {
  if (started || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  started = true;
  usePlayerStore.subscribe((state, prev) => {
    const song = state.queue[state.index];
    const before = prev.queue[prev.index];
    if (!song || !state.isPlaying) return;
    if (song.id === before?.id && prev.isPlaying) return;
    if (song.id === lastAnnounced) return;
    if (!useSettingsStore.getState().djVoice || state.followMode) return;
    lastAnnounced = song.id;
    const artist = song.artists[0]?.name ?? song.subtitle.split(',')[0] ?? '';
    say(artist ? `Now playing ${song.title}, by ${artist}` : `Now playing ${song.title}`);
  });
}
