/**
 * SpeechSynthesis voice picker for voice chat — aims TTS at a warm female
 * voice: 'Ava' first (the premium female voice on Apple devices; desktop Edge
 * ships an 'Ava Multilingual' too), then known female voices per platform,
 * then the closest language match. Returning a real voice (not null) makes
 * speak() reliable on browsers that silently drop utterances with an empty
 * voice on some devices.
 *
 * Voices load ASYNC in Chrome: getVoices() is [] until `voiceschanged` fires.
 * This module kicks the load at import and refreshes the cache on every
 * `voiceschanged`; the live engine re-picks per utterance (opts.getVoice()),
 * so a list that populates mid-session upgrades the voice on the very next
 * sentence spoken.
 */

let voiceCache: SpeechSynthesisVoice[] = [];

const refreshVoiceCache = (): void => {
  try {
    voiceCache = window.speechSynthesis.getVoices();
  } catch {
    voiceCache = [];
  }
};

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoiceCache();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceCache);
  } catch {
    /* engines without the event still refresh on every pick below */
  }
}

/** 'Ava' as a whole word of the voice name — matches 'Ava', 'Ava (Premium)'
 *  and 'Microsoft Ava Online (Natural) - English (United States)', never
 *  a substring hit like 'Java'. */
const AVA = /\bava\b/i;

/** Known female voices, brightest-sounding first: Apple ('Samantha' en-US,
 *  'Veena' en-IN, 'Karen' en-AU), Chrome desktop ('Google UK English Female',
 *  'Google US English'), Windows ('Microsoft Zira'). Applied on English
 *  lanes — voice chat speaks en-IN. */
const FEMALE_EN = ['samantha', 'veena', 'karen', 'google uk english female', 'microsoft zira', 'google us english'];

/** Pick a SpeechSynthesisVoice for a language tag. Preference order: an 'Ava'
 *  voice (same language family first, then any), a known female English voice,
 *  an exact tag match, the same primary language, the default, any voice.
 *  Pass `voiceList` to pick from a known list (tests); otherwise the live
 *  speechSynthesis list is used. */
export const pickSynthVoice = (lang: string, voiceList?: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
  let voices = voiceList;
  if (!voices) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    refreshVoiceCache();
    voices = voiceCache;
  }
  if (!voices.length) return null;
  const want = lang.toLowerCase();
  const primary = want.split('-')[0];
  const family = (v: SpeechSynthesisVoice): string => v.lang.toLowerCase().split('-')[0];
  // 1) Ava — in the requested language family when installed, else any Ava.
  const ava = voices.find((v) => AVA.test(v.name) && family(v) === primary) ?? voices.find((v) => AVA.test(v.name));
  if (ava) return ava;
  // 2) Known female voices on the English lanes.
  if (primary === 'en') {
    for (const name of FEMALE_EN) {
      const hit = voices.find((v) => v.name.toLowerCase().includes(name));
      if (hit) return hit;
    }
  }
  // 3) Exact tag → 4) same primary language → 5) default → any.
  const exact = voices.find((v) => v.lang.toLowerCase() === want);
  if (exact) return exact;
  const samePrimary = voices.find((v) => family(v) === primary);
  if (samePrimary) return samePrimary;
  return voices.find((v) => v.default) ?? voices[0] ?? null;
};
