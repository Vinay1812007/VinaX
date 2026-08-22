/**
 * Minimal single-DES ECB *decryptor* — exists for exactly one job: turning
 * JioSaavn's `encrypted_media_url` into the direct, unsigned CDN URL
 * (https://aac.saavncdn.com/...) without a play-time upstream round trip.
 *
 * Why (2026-08-20 playback outage): /api/cat/stream resolved streams via
 * upstream `song.generateAuthToken`, but the signed web.saavncdn.com URLs
 * that call returns to Cloudflare-edge callers started answering
 * "Access Denied" — every play stalled and the client skipped every track.
 * The encrypted URL decrypts (DES-ECB, JioSaavn's fixed public key) to a
 * permanent unsigned CDN URL that plays without any token, so decryption
 * is now the primary resolver and generateAuthToken only a fallback.
 *
 * WebCrypto has no DES (rightly — it's obsolete as a cipher), hence this
 * from-the-FIPS-46-3-spec implementation. It is NOT security code: the key
 * is public and ships in every JioSaavn client; this is format-unwrapping,
 * not cryptography. Decrypt-only, 8-byte key, ECB, PKCS#5 unpadding.
 */

/* ---------------------------------------------------------------- tables */
// Initial permutation (IP) and its inverse (FP), 1-based bit positions.
const IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
// Expansion of the 32-bit half-block to 48 bits.
const E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
// Permutation applied to the S-box output.
const P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
// The eight S-boxes, each 4 rows × 16 columns.
const SBOX = [
  [
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
  ],
  [
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
  ],
  [
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
  ],
  [
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
  ],
  [
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
  ],
  [
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
  ],
  [
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
  ],
  [
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
  ],
];
// Key schedule: PC-1 (64→56), PC-2 (56→48), and per-round left-shifts.
const PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
const PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

/* ------------------------------------------------------------- bit utils */
/** bits[] are 0/1 values, index 0 = most-significant bit of the block. */
function bytesToBits(bytes: Uint8Array, off: number, count: number): number[] {
  const bits = new Array<number>(count * 8);
  for (let i = 0; i < count; i++) {
    const b = bytes[off + i];
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (b >>> (7 - j)) & 1;
  }
  return bits;
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    out[i] = b;
  }
  return out;
}

/** table entries are 1-based source positions, per the FIPS diagrams. */
function permute(src: number[], table: number[]): number[] {
  const out = new Array<number>(table.length);
  for (let i = 0; i < table.length; i++) out[i] = src[table[i] - 1];
  return out;
}

function rotl(half: number[], n: number): number[] {
  return half.slice(n).concat(half.slice(0, n));
}

/* ------------------------------------------------------------------ core */
/** 16 round keys of 48 bits each, in ENCRYPTION order. */
function keySchedule(key8: Uint8Array): number[][] {
  const pc1 = permute(bytesToBits(key8, 0, 8), PC1);
  let c = pc1.slice(0, 28);
  let d = pc1.slice(28);
  const keys: number[][] = [];
  for (let r = 0; r < 16; r++) {
    c = rotl(c, SHIFTS[r]);
    d = rotl(d, SHIFTS[r]);
    keys.push(permute(c.concat(d), PC2));
  }
  return keys;
}

function feistel(right: number[], subkey: number[]): number[] {
  const x = permute(right, E);
  for (let i = 0; i < 48; i++) x[i] ^= subkey[i];
  const out: number[] = new Array(32);
  for (let s = 0; s < 8; s++) {
    const o = s * 6;
    const row = (x[o] << 1) | x[o + 5];
    const col = (x[o + 1] << 3) | (x[o + 2] << 2) | (x[o + 3] << 1) | x[o + 4];
    const v = SBOX[s][row * 16 + col];
    out[s * 4] = (v >>> 3) & 1;
    out[s * 4 + 1] = (v >>> 2) & 1;
    out[s * 4 + 2] = (v >>> 1) & 1;
    out[s * 4 + 3] = v & 1;
  }
  return permute(out, P);
}

/** Decrypt one 8-byte block in place-free style (subkeys applied reversed). */
function decryptBlock(block: number[], keys: number[][]): number[] {
  const ip = permute(block, IP);
  let left = ip.slice(0, 32);
  let right = ip.slice(32);
  for (let r = 15; r >= 0; r--) {
    const f = feistel(right, keys[r]);
    const next = left.map((b, i) => b ^ f[i]);
    left = right;
    right = next;
  }
  // Final swap then inverse permutation.
  return permute(right.concat(left), FP);
}

/* ------------------------------------------------------------------- API */
/** DES-ECB decrypt with PKCS#5 unpadding. Returns null on malformed input. */
export function desEcbDecrypt(data: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (key.length !== 8 || data.length === 0 || data.length % 8 !== 0) return null;
  const keys = keySchedule(key);
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 8) {
    out.set(bitsToBytes(decryptBlock(bytesToBits(data, off, 8), keys)), off);
  }
  // PKCS#5: last byte is the pad length, 1..8, all pad bytes equal.
  const pad = out[out.length - 1];
  if (pad < 1 || pad > 8) return null;
  for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) return null;
  return out.subarray(0, out.length - pad);
}

// JioSaavn's fixed media-URL key — public, ships in every official client.
const MEDIA_KEY = new TextEncoder().encode('38346591');

function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * encrypted_media_url (base64) → direct CDN URL, or null when the input is
 * not a well-formed encrypted URL (caller falls back to generateAuthToken).
 */
export function decryptMediaUrl(encrypted: string): string | null {
  const bytes = b64ToBytes(encrypted.trim());
  if (!bytes) return null;
  const plain = desEcbDecrypt(bytes, MEDIA_KEY);
  if (!plain) return null;
  const url = new TextDecoder().decode(plain).trim();
  if (!/^https?:\/\/[\w.-]+\/\S+$/.test(url)) return null;
  return url.replace(/^http:/, 'https:');
}
