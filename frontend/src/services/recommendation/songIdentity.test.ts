// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canonicalKey, dedupeByIdentity, songKey, versionKind } from './songIdentity';
import { makeSong } from '@/__fixtures__/songs';

describe('canonicalKey', () => {
  it('collapses film tags, years, remixes and dashed version suffixes onto one identity', () => {
    const base = canonicalKey('Monica', 'Anirudh Ravichander');
    for (const title of ['Monica (From "Coolie")', 'Monica (2025 Remix)', 'Monica - Lofi Flip', 'Monica – Slowed + Reverb', 'Monica [Live]', 'MONICA (feat. Someone)', 'Monica - From Coolie']) {
      expect(canonicalKey(title, 'Anirudh Ravichander')).toBe(base);
    }
  });

  it('keeps different songs apart, including ones that differ only by an Indic vowel sign', () => {
    expect(canonicalKey('Monica', 'Anirudh')).not.toBe(canonicalKey('Monica', 'Someone Else'));
    expect(canonicalKey('दिल', 'Arijit Singh')).not.toBe(canonicalKey('दाल', 'Arijit Singh'));
    expect(canonicalKey('నువ్వే', 'Sid Sriram')).not.toBe(canonicalKey('నవ్వు', 'Sid Sriram'));
  });

  it('folds width forms and invisible characters, and credits only the first artist', () => {
    expect(canonicalKey('Ｋｅｓａｒｉｙａ', 'Arijit Singh')).toBe(canonicalKey('Kesariya', 'Arijit Singh'));
    expect(canonicalKey('Kesa​riya', 'Arijit Singh')).toBe(canonicalKey('Kesariya', 'Arijit Singh'));
    expect(canonicalKey('Kesariya', 'Arijit Singh, Pritam')).toBe(canonicalKey('Kesariya', 'Arijit Singh & Pritam'));
  });

  it('never reduces a title that is only a version word to nothing', () => {
    expect(canonicalKey('Remix', 'DJ X').startsWith('remix|')).toBe(true);
    expect(canonicalKey('(Live)', 'Band')).not.toBe(canonicalKey('(Acoustic)', 'Band'));
  });
});

describe('versionKind and dedupeByIdentity', () => {
  it('names the cut', () => {
    expect(versionKind('Monica')).toBe('original');
    expect(versionKind('Monica (From "Coolie")')).toBe('original');
    expect(versionKind('Monica (2011 Remastered)')).toBe('remaster');
    expect(versionKind('Monica (Karaoke Version)')).toBe('alternate');
    expect(versionKind('Monica - Lofi Flip')).toBe('alternate');
  });

  it('keeps the original over a remix at the first position the identity appeared, then the more played cut', () => {
    const remix = makeSong('remix', { title: 'Monica (Remix)', artist: 'Anirudh' });
    const original = makeSong('orig', { title: 'Monica', artist: 'Anirudh', playCount: 10 });
    const other = makeSong('other', { title: 'Hukum', artist: 'Anirudh' });
    const big = makeSong('big', { title: 'Monica (From "Coolie")', artist: 'Anirudh', playCount: 99 });
    expect(dedupeByIdentity([remix, other, original], (s) => s).map((s) => s.id)).toEqual(['orig', 'other']);
    expect(dedupeByIdentity([original, big], (s) => s).map((s) => s.id)).toEqual(['big']);
    expect(songKey(remix)).toBe(songKey(original));
  });
});
