import { describe, it, expect } from 'vitest';
import { normalizeLanguage, languageLabel } from './languages';

describe('normalizeLanguage', () => {
  it('returns null for empty or non-string input', () => {
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('   ')).toBeNull();
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
    expect(normalizeLanguage(42)).toBeNull();
  });
  it('lowercases and trims a known language', () => {
    expect(normalizeLanguage('Telugu')).toBe('telugu');
    expect(normalizeLanguage('  HINDI ')).toBe('hindi');
  });
  it('maps common upstream variants', () => {
    expect(normalizeLanguage('Hindustani')).toBe('hindi');
    expect(normalizeLanguage('Panjabi')).toBe('punjabi');
    expect(normalizeLanguage('Oriya')).toBe('odia');
  });
  it('returns a non-null fallback for unrecognised languages', () => {
    const r = normalizeLanguage('klingon');
    expect(typeof r).toBe('string');
    expect(r).not.toBe('telugu');
  });
});

describe('languageLabel', () => {
  it('returns Unknown for null', () => expect(languageLabel(null)).toBe('Unknown'));
});
