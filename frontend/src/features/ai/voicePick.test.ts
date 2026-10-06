// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_VOICE, VOICE_PICK_KEY, formatVoicePick, migrateVoicePick, parseVoicePick, readVoicePick } from './voicePick';
import { parseVoiceCatalog, voiceLabel } from './chat/voices';

beforeEach(() => localStorage.clear());

describe('voice pick (10.3)', () => {
  it('reads provider|model|voice, and the device voice as none', () => {
    expect(parseVoicePick('gemini|speech-1|Kore')).toEqual({ provider: 'gemini', model: 'speech-1', voice: 'Kore' });
    expect(parseVoicePick(DEVICE_VOICE)).toBeNull();
    expect(parseVoicePick('')).toBeNull();
    expect(parseVoicePick('a|b|c|d')).toBeNull();
  });

  it('migrates an older model|persona choice to its provider, so a listener keeps their voice', () => {
    expect(migrateVoicePick('canopylabs/orpheus-v1-english|autumn')).toBe('groq|canopylabs/orpheus-v1-english|autumn');
    expect(migrateVoicePick('gemini|speech-1|Kore')).toBe('gemini|speech-1|Kore');
    expect(migrateVoicePick('nonsense')).toBe(DEVICE_VOICE);
    localStorage.setItem(VOICE_PICK_KEY, 'canopylabs/orpheus-v1-english|troy');
    expect(readVoicePick()).toEqual({ provider: 'groq', model: 'canopylabs/orpheus-v1-english', voice: 'troy' });
    expect(localStorage.getItem(VOICE_PICK_KEY)).toBe('groq|canopylabs/orpheus-v1-english|troy');
    expect(formatVoicePick({ provider: 'nvidia', model: 'm', voice: 'v' })).toBe('nvidia|m|v');
  });
});

describe('GET /api/voices (10.3)', () => {
  it('reads every speech model per provider, in menu order', () => {
    const c = parseVoiceCatalog({
      configured: true,
      providers: [
        { id: 'gemini', label: 'Gemini', models: [{ id: 'speech-1', name: 'Speech One', voices: ['Kore', 'Puck'] }] },
        { id: 'groq', label: 'Groq', models: [{ id: 'voice-1', name: 'Voice One', voices: ['autumn'] }, { id: 'silent', name: 'Silent', voices: [] }] },
        { id: 'elsewhere', models: [{ id: 'x', voices: ['y'] }] },
      ],
    });
    expect(c.providers.map((p) => [p.id, p.models.map((m) => m.id)])).toEqual([
      ['groq', ['voice-1']],
      ['gemini', ['speech-1']],
    ]);
  });

  it('reads an older server (one provider: models × personas) as that provider’s voices', () => {
    const c = parseVoiceCatalog({
      configured: true,
      models: [{ id: 'canopylabs/orpheus-v1-english', label: 'Orpheus English' }],
      personas: [{ id: 'autumn', label: 'Autumn', tone: 'Warm' }, { id: 'troy', label: 'Troy', tone: 'Deep' }],
    });
    expect(c.providers).toEqual([
      { id: 'groq', label: 'Groq', models: [{ id: 'canopylabs/orpheus-v1-english', name: 'Orpheus English', voices: ['autumn', 'troy'] }] },
    ]);
    expect(parseVoiceCatalog(null)).toEqual({ configured: false, providers: [] });
    expect(voiceLabel('autumn')).toBe('Autumn');
  });
});
