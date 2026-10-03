import type { Song } from '@/types';
import { canonicalKey } from './identityCore';

/**
 * 9.1.0 — the canonical key of a Song, in its own module.
 *
 * It used to live in ./songIdentity, which now also holds the compatibility
 * wrappers over ./exposure — and ./exposure needs the key. Splitting the two
 * lines of code out keeps the dependency one-way
 * (songIdentity → exposure → songKey → identityCore) instead of a cycle, with
 * one definition of the key rather than two that could drift.
 *
 * The normalisation itself is ./identityCore, kept byte-identical with the
 * Worker's copy.
 */

/** Primary credited artist for a song — the identity half of the canonical key. */
export function primaryArtist(s: Song): string {
  return s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '';
}

/** Canonical WORK key straight from a Song ("title|artist", normalised). */
export function songKey(s: Song): string {
  return canonicalKey(s.title, primaryArtist(s));
}
