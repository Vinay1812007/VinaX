/** Shared song identity and recently displayed music for catalog shelves and playlists. */
import type { Song } from '@/types';

/** Recently displayed songs shared by catalog shelves and playlists. */
const SERVED_KEY = 'vinax.flow.served.v1';
const SERVED_CAP = 300;
const SERVED_TTL = 7 * 24 * 60 * 60_000;
let servedMemory: ServedEntry[] = [];

/** Titles that are never songs — they poison queues when a search returns them. */
const JUNK_TITLE = /\b(dialogue|dialogues|bgm|jukebox|trailer|teaser|promo|ringtone|commentary)\b/i;

/** Version decorations that make one song look like many. */
const VERSION_TAG =
  /\s*[([{][^)\]}]*(?:from|remix|remaster|reprise|version|mix|unplugged|reloaded|revisited|slowed|reverb|lofi|lo-fi|19\d{2}|20\d{2})[^)\]}]*[)\]}]/gi;

/** Primary credited artist for a song — the identity half of the canonical key. */
export function primaryArtist(s: Song): string {
  return s.artists?.[0]?.name ?? s.subtitle?.split(',')[0] ?? '';
}

/**
 * Canonical song identity: normalized title + primary artist. "Monica",
 * "Monica (From \"Coolie\")" and "Monica (2025 Remix)" by the same artist all
 * collapse onto one key, so one of them ever reaches a queue or shelf.
 */
export function canonicalKey(title: string, artist: string): string {
  const t = title
    .toLowerCase()
    .replace(VERSION_TAG, '')
    .replace(/\s*[-–—]\s*from\s+.+$/i, '')
    .replace(/\s*(?:feat\.?|ft\.?|featuring)\s+.+$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const a = artist
    .toLowerCase()
    .split(',')[0]
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return `${t}|${a}`;
}

/** Canonical key straight from a Song. */
export function songKey(s: Song): string {
  return canonicalKey(s.title, primaryArtist(s));
}

interface ServedEntry {
  k: string;
  t: number;
}

function loadServed(): ServedEntry[] {
  let raw: unknown = servedMemory;
  try {
    const stored = window.localStorage.getItem(SERVED_KEY);
    if (stored != null) raw = JSON.parse(stored);
  } catch { /* retain session memory when storage is unavailable */ }
  const cutoff = Date.now() - SERVED_TTL;
  return Array.isArray(raw)
    ? raw.filter((e): e is ServedEntry => e && typeof e.k === 'string' && Number.isFinite(e.t) && e.t > cutoff).slice(0, SERVED_CAP)
    : [];
}

/** The shared served-identity set — consult it before surfacing anything. */
export function servedKeySet(): Set<string> {
  return new Set(loadServed().map((e) => e.k));
}

/** Remember served identities so no surface re-serves what another just played. */
export function recordServed(keys: string[]): void {
  if (!keys.length) return;
  try {
    const now = Date.now();
    const merged: ServedEntry[] = [...keys.map((k) => ({ k, t: now })), ...loadServed()];
    const seen = new Set<string>();
    const dedup: ServedEntry[] = [];
    for (const e of merged) {
      if (!seen.has(e.k)) {
        seen.add(e.k);
        dedup.push(e);
      }
    }
    servedMemory = dedup.slice(0, SERVED_CAP);
    window.localStorage.setItem(SERVED_KEY, JSON.stringify(servedMemory));
  } catch {
    /* storage unavailable — memory-less rounds still work, just less varied */
  }
}

/** True when a title is a non-song artifact (dialogue strip, BGM cut, …). */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE.test(title);
}
