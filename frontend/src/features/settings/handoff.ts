/**
 * Package C1 — cross-device handoff crypto. The zero-account promise stays:
 * the profile blob is encrypted ON THIS DEVICE with a key derived from a
 * 6-word passphrase, and only the ciphertext ever reaches the relay, which
 * holds it for 10 minutes at most and burns it on first read. The passphrase
 * travels in the QR's URL *fragment* (never sent to any server) or is typed
 * by hand on the receiving device. Without the words, the relay's copy is
 * useless — to VinaX included.
 */

// 256 short, unambiguous, easy-to-type words (48 bits across 6 words). All
// lowercase, 3-6 letters, no lookalike pairs — chosen for phone keyboards.
const WORDS = (
  'apple arrow autumn baker bamboo basket beach bell berry bird blaze bloom blue boat bold bonus book brave bread breeze brick bridge bright brook brush cabin cake camel candle canoe cargo cedar chair chalk charm cherry chess chief child churn cider cliff cloud clover coast cobra cocoa coin comet coral cotton cousin crane cream crisp crown cubic curly dance dawn delta denim desert dew diary dime dolphin donut door dove dragon dream drift drum dune dusk eagle earth east echo ember engine envoy fable falcon fancy farm feast fern ferry field fig flame flash fleet flint flora flute foam forest fox frost fruit galaxy garden gate gecko gem giant ginger glade glass glide gold goose grape grass green grove guitar habit half harbor hawk hazel heron hill honey horse house humble igloo india iris iron island ivory jade jasmine jelly jewel jolly juice jungle junior kayak kettle king kite kiwi koala lagoon lake lamp lantern laurel lemon level light lily lion lotus lucky lunar mango maple march marble meadow medal melody mesa mint mirror monsoon moon moss motor mound museum music napkin nectar nest night noble north nutmeg oasis ocean olive onion opal orange orbit orchid otter owl oyster palm panda paper peach pearl pebble pepper petal piano pilot pine planet plum pond poppy prism pupil quartz queen quill quilt rabbit radar rain rapid raven reef ridge river robin rocket rose ruby saffron sail salt sandal sapphire scout seed shell shore silk silver sketch sky slate smile snow solar sonic spark spice spring squire star stone storm story sugar summer sunny swan sweet tablet tango teal temple tiger tulip tundra'
).split(/\s+/).filter(Boolean).slice(0, 256); // exactly 2^8 — one uniform byte per word, zero modulo bias

/** 6 random words — ~48 bits of entropy, plenty for a 10-minute one-shot blob. */
export function generatePassphrase(): string[] {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => WORDS[b % WORDS.length]);
}

/** True when every word is plausibly from the handoff wordlist shape. */
export function looksLikePassphrase(words: string[]): boolean {
  return words.length === 6 && words.every((w) => /^[a-z]{3,8}$/.test(w));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** PBKDF2-SHA256 (150k iters, salted by the transfer id) → AES-GCM-256 key.
 *  The id salts the derivation so identical passphrases on two transfers
 *  still yield different keys. */
async function deriveKey(words: string[], transferId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(words.join(' ')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(`vinax-handoff:${transferId}`), iterations: 150_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface SealedBlob {
  /** Base64 ciphertext. */
  blob: string;
  /** Base64 12-byte GCM nonce. */
  iv: string;
}

/** Encrypt the export JSON for the relay. */
export async function sealProfile(json: string, words: string[], transferId: string): Promise<SealedBlob> {
  const key = await deriveKey(words, transferId);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
  return { blob: toB64(cipher), iv: toB64(iv) };
}

/** Decrypt a relay blob. Returns null on a wrong passphrase or tampered data
 *  (GCM authenticates — corruption never yields garbage output). */
export async function openProfile(sealed: SealedBlob, words: string[], transferId: string): Promise<string | null> {
  try {
    const key = await deriveKey(words, transferId);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(sealed.iv) as BufferSource },
      key,
      fromB64(sealed.blob) as BufferSource,
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}
