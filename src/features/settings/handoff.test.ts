import { describe, expect, it } from 'vitest';
import { generatePassphrase, looksLikePassphrase, openProfile, sealProfile } from './handoff';

describe('handoff passphrase (C1)', () => {
  it('generates 6 valid lowercase words', () => {
    const words = generatePassphrase();
    expect(words).toHaveLength(6);
    expect(looksLikePassphrase(words)).toBe(true);
  });

  it('two passphrases differ (sanity, not a proof)', () => {
    // 6 words × 8 bits — a collision here is ~2^-48; a repeat means the RNG broke.
    expect(generatePassphrase().join(' ')).not.toBe(generatePassphrase().join(' '));
  });

  it('looksLikePassphrase rejects wrong shapes', () => {
    expect(looksLikePassphrase([])).toBe(false);
    expect(looksLikePassphrase(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(false); // too short
    expect(looksLikePassphrase(['apple', 'brook', 'tiger', 'lotus', 'pearl', 'COMET'])).toBe(false); // case
  });
});

describe('handoff crypto roundtrip (C1)', () => {
  const profile = JSON.stringify({ app: 'vinax', favorites: ['a', 'b'], nested: { deep: true } });

  it('seals and opens with the right words + salt', async () => {
    const words = generatePassphrase();
    const sealed = await sealProfile(profile, words, 'apple-brook');
    expect(sealed.blob).not.toContain('vinax'); // ciphertext, not plaintext
    const opened = await openProfile(sealed, words, 'apple-brook');
    expect(opened).toBe(profile);
  });

  it('wrong words fail closed (null, never garbage)', async () => {
    const sealed = await sealProfile(profile, ['apple', 'brook', 'tiger', 'lotus', 'pearl', 'comet'], 'salt-one');
    const opened = await openProfile(sealed, ['apple', 'brook', 'tiger', 'lotus', 'pearl', 'maple'], 'salt-one');
    expect(opened).toBeNull();
  });

  it('the salt binds the key — same words, different transfer, no unlock', async () => {
    const words = ['apple', 'brook', 'tiger', 'lotus', 'pearl', 'comet'];
    const sealed = await sealProfile(profile, words, 'salt-one');
    expect(await openProfile(sealed, words, 'salt-two')).toBeNull();
  });

  it('a tampered blob fails GCM authentication', async () => {
    const words = generatePassphrase();
    const sealed = await sealProfile(profile, words, 'salt-x');
    const corrupted = { ...sealed, blob: sealed.blob.slice(0, -4) + 'AAAA' };
    expect(await openProfile(corrupted, words, 'salt-x')).toBeNull();
  });
});
