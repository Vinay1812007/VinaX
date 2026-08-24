/** Locks the female-first TTS voice preference for voice chat: 'Ava' above
 *  all (same language family first, then any Ava), known female voices next,
 *  then exact tag → primary language → default → any. A refactor that lets
 *  the pick fall back to the first random male voice fails here. */
import { describe, expect, it } from 'vitest';
import { pickSynthVoice } from './pickSynthVoice';

const v = (name: string, lang: string, def = false): SpeechSynthesisVoice =>
  ({ name, lang, default: def, localService: true, voiceURI: name }) as SpeechSynthesisVoice;

describe('pickSynthVoice', () => {
  it('prefers an Ava voice over everything else', () => {
    const voices = [v('Rishi', 'en-IN'), v('Samantha', 'en-US'), v('Ava (Premium)', 'en-US')];
    expect(pickSynthVoice('en-IN', voices)?.name).toBe('Ava (Premium)');
  });

  it('prefers the Ava in the requested language family when there are two', () => {
    const voices = [v('Ava', 'fr-FR'), v('Microsoft Ava Online (Natural) - English (United States)', 'en-US')];
    expect(pickSynthVoice('en-IN', voices)?.lang).toBe('en-US');
  });

  it('takes any Ava when none matches the family', () => {
    const voices = [v('Lekha', 'hi-IN'), v('Ava (Premium)', 'en-US')];
    expect(pickSynthVoice('te-IN', voices)?.name).toBe('Ava (Premium)');
  });

  it('matches Ava as a whole word only — never inside another name', () => {
    const voices = [v('Java Voice', 'en-US'), v('Veena', 'en-IN')];
    expect(pickSynthVoice('en-IN', voices)?.name).toBe('Veena');
  });

  it('falls back to known female voices when no Ava is installed, in order', () => {
    const voices = [v('Daniel', 'en-GB'), v('Google US English', 'en-US'), v('Samantha', 'en-US')];
    expect(pickSynthVoice('en-IN', voices)?.name).toBe('Samantha');
    const chrome = [v('Daniel', 'en-GB'), v('Google US English', 'en-US'), v('Google UK English Female', 'en-GB')];
    expect(pickSynthVoice('en-IN', chrome)?.name).toBe('Google UK English Female');
    const windows = [v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US')];
    expect(pickSynthVoice('en-US', windows)?.name).toContain('Zira');
    // v3.0.4 reorder: brightest first — Samantha now outranks Veena, and Apple's Karen (AU) slots in right after Veena.
    const apple = [v('Veena', 'en-IN'), v('Samantha', 'en-US')];
    expect(pickSynthVoice('en-IN', apple)?.name).toBe('Samantha');
    const au = [v('Google UK English Female', 'en-GB'), v('Karen', 'en-AU'), v('Veena', 'en-IN')];
    expect(pickSynthVoice('en-IN', au)?.name).toBe('Veena');
    expect(pickSynthVoice('en-IN', [v('Google UK English Female', 'en-GB'), v('Karen', 'en-AU')])?.name).toBe('Karen');
  });

  it('uses the exact language tag when no preferred female voice exists', () => {
    const voices = [v('Lekha', 'hi-IN'), v('Rishi', 'en-IN'), v('Daniel', 'en-GB')];
    expect(pickSynthVoice('en-IN', voices)?.name).toBe('Rishi');
  });

  it('falls back to the primary language, then the default, then any voice', () => {
    expect(pickSynthVoice('en-IN', [v('Daniel', 'en-GB')])?.name).toBe('Daniel');
    expect(pickSynthVoice('en-IN', [v('Thomas', 'fr-FR'), v('Lekha', 'hi-IN', true)])?.name).toBe('Lekha');
    expect(pickSynthVoice('en-IN', [v('Thomas', 'fr-FR')])?.name).toBe('Thomas');
  });

  it('returns null for an empty list', () => {
    expect(pickSynthVoice('en-IN', [])).toBeNull();
  });
});
