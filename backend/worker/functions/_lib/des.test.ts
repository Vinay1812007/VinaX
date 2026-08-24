/**
 * Pins the DES media-URL decryptor (2026-08-20 playback fix) against a real
 * upstream sample: encrypted_media_url blobs must decrypt to the direct
 * unsigned CDN URL, http upgraded to https, and every malformed input must
 * return null so /api/cat/stream can fall back to generateAuthToken.
 */
import { describe, expect, it } from 'vitest';
import { decryptMediaUrl, desEcbDecrypt } from './des';

// Real encrypted_media_url captured 2026-08-20 (public catalog data).
const SAMPLE_ENC =
  'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyhG7Q4EE4gXPUMxXBqCfbGqS2zdigiLU7KoeGK03QQiciQQvruZRn0hw7tS9a8Gtq';
const SAMPLE_URL = 'https://aac.saavncdn.com/177/7f1d8dfacf14f782e07dd0597699f941_96.mp4';

describe('decryptMediaUrl', () => {
  it('decrypts a real encrypted_media_url to the direct CDN URL', () => {
    expect(decryptMediaUrl(SAMPLE_ENC)).toBe(SAMPLE_URL);
  });

  it('tolerates surrounding whitespace', () => {
    expect(decryptMediaUrl(`  ${SAMPLE_ENC}\n`)).toBe(SAMPLE_URL);
  });

  it('returns null on junk so the caller can fall back', () => {
    expect(decryptMediaUrl('')).toBeNull();
    expect(decryptMediaUrl('not-base64!!')).toBeNull();
    expect(decryptMediaUrl('aGVsbG8=')).toBeNull(); // valid b64, not a DES blob
    // One corrupted character → padding/URL check fails, never garbage out.
    expect(decryptMediaUrl(SAMPLE_ENC.replace('ZRn', 'ZZn'))).toBeNull();
  });
});

describe('desEcbDecrypt', () => {
  it('rejects bad key/data sizes', () => {
    expect(desEcbDecrypt(new Uint8Array(8), new Uint8Array(7))).toBeNull();
    expect(desEcbDecrypt(new Uint8Array(7), new Uint8Array(8))).toBeNull();
    expect(desEcbDecrypt(new Uint8Array(0), new Uint8Array(8))).toBeNull();
  });
});
