/**
 * VinaX AI Live voice — what the pickers show: each Gemini voice's
 * character (Google's own one-word descriptions, checked 2026-11-05) and
 * the language a new listener starts in (the device's, when Live voice can
 * hold to it; else English).
 */

export const VOICE_STYLES: Readonly<Record<string, string>> = {
  Kore: 'Firm', Puck: 'Upbeat', Charon: 'Informative', Aoede: 'Breezy', Fenrir: 'Excitable',
  Leda: 'Youthful', Orus: 'Firm', Zephyr: 'Bright', Sulafat: 'Warm', Achird: 'Friendly',
  Callirrhoe: 'Easy-going', Autonoe: 'Bright', Enceladus: 'Breathy', Iapetus: 'Clear', Umbriel: 'Easy-going',
  Algieba: 'Smooth', Despina: 'Smooth', Erinome: 'Clear', Algenib: 'Gravelly', Rasalgethi: 'Informative',
  Laomedeia: 'Upbeat', Achernar: 'Soft', Alnilam: 'Firm', Schedar: 'Even', Gacrux: 'Mature',
  Pulcherrima: 'Forward', Zubenelgenubi: 'Casual', Vindemiatrix: 'Gentle', Sadachbia: 'Lively', Sadaltager: 'Knowledgeable',
};

/** "Kore · Firm" (or just the name for a voice without a description). */
export const voiceLabel = (v: string): string => (VOICE_STYLES[v] ? `${v} · ${VOICE_STYLES[v]}` : v);

/** The language codes Live voice can hold to (the server's LIVE_LANGUAGES). */
export const LIVE_LANGUAGE_CODES = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'bn', 'mr', 'gu', 'pa', 'ur', 'ar', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'tr', 'id', 'ja', 'ko', 'zh'] as const;

/** The device's language when Live voice can hold to it, else English. */
export function deviceLanguage(): string {
  const base = (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase().split('-')[0];
  return (LIVE_LANGUAGE_CODES as readonly string[]).includes(base) ? base : 'en';
}

/**
 * The typed chat as context for Live voice: its latest turns, artifacts and
 * code left out (they are not for speaking), each turn cut short.
 */
export function chatContext(thread: ReadonlyArray<{ role: string; text: string }>, turns = 12, chars = 500): Array<{ role: 'user' | 'assistant'; text: string }> {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const m of thread) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.text
      .replace(/<artifact\b[\s\S]*?(?:<\/artifact>|$)/g, ' (an artifact) ')
      .replace(/```[\s\S]*?(?:```|$)/g, ' (some code) ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, chars);
    if (text) out.push({ role: m.role, text });
  }
  return out.slice(-turns);
}
