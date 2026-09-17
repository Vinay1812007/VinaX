/**
 * v7.1.0 — the name a greeting should use. The stored display name is whatever
 * the listener (or the device) supplied, and a device-style name such as
 * "Vinays'S CG-IT-SA-NA-001 MacBook Air M1" turned Home's title into three
 * lines. A greeting wants a first name: the possessive owner of a device
 * name, else the first word — never an asset tag, never more than 18 characters.
 */
const DEVICE_WORDS = /\b(macbook|imac|iphone|ipad|galaxy|pixel|laptop|desktop|pc|phone|tablet|android|windows|air|pro|mini|max|ultra)\b/i;
/** Asset tags and serial-like tokens: CG-IT-SA-NA-001, DESKTOP-7F3K2, SM-G998B. */
const TAG = /^[A-Z0-9]{1,12}(?:[-_][A-Z0-9]{1,12})+$|^(?=.*\d)[A-Z0-9]{5,}$/;

const titleCase = (w: string): string => (w ? w[0].toLocaleUpperCase() + w.slice(1).toLocaleLowerCase() : w);

export function greetingName(raw: string | null | undefined): string {
  const name = (raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) return '';
  // "Vinay's MacBook", "Vinays'S …" → the owner before the possessive.
  const owner = /^([\p{L}][\p{L}\p{M}.-]{0,30}?)(?:['’]s|s['’]s?)(?=\s|$)/iu.exec(name);
  const looksLikeDevice = DEVICE_WORDS.test(name) || name.split(' ').some((w) => TAG.test(w));
  let first = owner && looksLikeDevice ? owner[1] : name.split(' ').find((w) => !TAG.test(w) && !DEVICE_WORDS.test(w)) ?? '';
  first = first.replace(/['’]s?$/i, '');
  if (!first || !/\p{L}/u.test(first)) return '';
  // Leave a name the listener typed with its own casing; only fix shouting / all-lower device strings.
  if (looksLikeDevice || first === first.toUpperCase() || first === first.toLowerCase()) first = titleCase(first);
  return first.length > 18 ? `${first.slice(0, 17)}…` : first;
}
