/**
 * 15.0 — Auto EQ: with Settings → Sound → "Match the song" on, the equaliser
 * preset follows what is playing. The choice is made on the device from the
 * song's own catalogue fields (genre, vibe, mood, energy, tempo — the ones the
 * recommendation engine already reads), so there is no request and no delay;
 * a song with no useful field keeps the preset the listener chose last.
 *
 * `presetForSong` is pure and tested; `AutoEq` is the subscription that
 * applies it through the settings store (effectsBridge picks the change up
 * like any other preset change). Switching Auto off puts the listener's own
 * preset back.
 */
import { useEffect } from 'react';
import type { Song } from '@/types';
import { EQ_PRESETS } from '@/services/audio/effects';
import { useSettingsStore } from '@/store/settingsStore';
import { useCurrentSong } from '@/store/playerStore';

export type AutoEqPreset = 'flat' | 'bass' | 'vocal' | 'treble' | 'loud' | 'podcast';

const BASS_WORDS = /\b(hip.?hop|rap|trap|edm|dance|club|party|electronic|house|techno|dubstep|bass|workout|gym)\b/;
const VOCAL_WORDS = /\b(melody|melodic|romantic|romance|love|soft|acoustic|unplugged|ballad|classical|carnatic|hindustani|devotional|bhajan|ghazal|sad|soulful|slow)\b/;
const TREBLE_WORDS = /\b(folk|item|peppy|bright|retro|pop|indie)\b/;
const LOUD_WORDS = /\b(mass|rock|metal|anthem|festival|energetic|high.?energy|celebration|wedding|dhol)\b/;
const SPOKEN_WORDS = /\b(podcast|dialogue|dialog|speech|talk|spoken|narration|audiobook)\b/;

/** The preset that fits `song`, or null when nothing about it says. */
export function presetForSong(song: Pick<Song, 'genre' | 'genres' | 'vibe' | 'vibes' | 'mood' | 'energy' | 'tempo' | 'title' | 'album'> | null | undefined): AutoEqPreset | null {
  if (!song) return null;
  const words = [song.genre, ...(song.genres ?? []), song.vibe, ...(song.vibes ?? []), song.mood]
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .join(' ')
    .toLowerCase();
  if (SPOKEN_WORDS.test(words)) return 'podcast';
  if (LOUD_WORDS.test(words)) return 'loud';
  if (BASS_WORDS.test(words)) return 'bass';
  if (VOCAL_WORDS.test(words)) return 'vocal';
  if (TREBLE_WORDS.test(words)) return 'treble';
  // No words: energy and tempo, when measured, still say something.
  const energy = typeof song.energy === 'number' ? song.energy : null;
  const tempo = typeof song.tempo === 'number' ? song.tempo : null;
  if (energy !== null) {
    if (energy >= 0.75) return tempo !== null && tempo >= 125 ? 'bass' : 'loud';
    if (energy <= 0.3) return 'vocal';
  }
  return null;
}

export function AutoEq(): null {
  const song = useCurrentSong();
  const auto = useSettingsStore((s) => s.eqAuto);
  const on = useSettingsStore((s) => s.soundEffects);
  useEffect(() => {
    if (!auto || !on) return;
    const pick = presetForSong(song);
    if (!pick) return;
    const st = useSettingsStore.getState();
    if (st.eqPreset === pick) return;
    st.setEqPreset(pick, EQ_PRESETS[pick]);
  }, [song, auto, on]);
  // Auto off: the preset the listener had chosen comes back.
  useEffect(() => {
    if (auto) return;
    const st = useSettingsStore.getState();
    const own = st.eqOwnPreset;
    if (!own || own === st.eqPreset) return;
    st.setEqPreset(own, own === 'custom' ? st.eqOwnGains ?? undefined : EQ_PRESETS[own]);
  }, [auto]);
  return null;
}
