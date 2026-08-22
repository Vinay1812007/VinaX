/**
 * Constant-time string comparison for secrets (admin tokens, cron secrets, etc).
 *
 * A `===` compare on strings short-circuits at the first differing byte, so an
 * attacker who can measure request latency can recover a shared secret byte by
 * byte. This helper avoids that leak: it XOR-folds every byte pair regardless
 * of match, and only returns after both strings have been fully consumed.
 *
 * When lengths differ, we still consume `max(a.length, b.length)` bytes so the
 * work performed doesn't reveal the length of the expected secret.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  const len = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    // If i is beyond one buffer's length, treat the missing byte as 0 —
    // `diff` already reflects the length mismatch, so a false positive is
    // impossible.
    const av = i < aBytes.length ? aBytes[i] : 0;
    const bv = i < bBytes.length ? bBytes[i] : 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}
