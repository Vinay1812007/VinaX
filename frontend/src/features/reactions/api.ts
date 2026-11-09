/**
 * 1.12 — public song reactions (backend api/reactions.ts): one per device per
 * song, from a fixed set. The device names itself the way usage reports do
 * (the install id, or the signed id the Worker handed back), so the Worker
 * keeps the same derived id and never the raw one. Counts are public.
 */
import type { Song } from '@/types';
import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { installId } from '@/services/identity/installId';
import { isNativePlatform } from '@/services/native';
import { bestImage } from '@/utils/images';

export const REACTIONS = [
  { id: 'fire', glyph: '🔥', label: 'Fire' },
  { id: 'love', glyph: '❤️', label: 'Love' },
  { id: 'sad', glyph: '😢', label: 'Feels' },
  { id: 'dance', glyph: '🕺', label: 'Dance' },
  { id: 'wow', glyph: '🤩', label: 'Wow' },
] as const;
export type Reaction = (typeof REACTIONS)[number]['id'];
export const isReaction = (v: unknown): v is Reaction => REACTIONS.some((r) => r.id === v);

export interface ReactionCounts { total: number; counts: Partial<Record<Reaction, number>>; mine: Reaction | null }

const ORIGIN = isNativePlatform() ? 'https://www.vinaxmusic.online' : '';
const URL_ = `${ORIGIN}/api/reactions`;

function identity(): { deviceId: string; signed_device_id?: string } {
  const signed = getLocal<string>(KEYS.signedDeviceId, '');
  return { deviceId: installId(), ...(signed ? { signed_device_id: signed } : {}) };
}

function parse(raw: unknown): ReactionCounts {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const counts: Partial<Record<Reaction, number>> = {};
  if (o.counts && typeof o.counts === 'object') for (const [k, v] of Object.entries(o.counts as Record<string, unknown>)) if (isReaction(k)) counts[k] = Number(v) || 0;
  if (typeof o.signed_device_id_next === 'string' && o.signed_device_id_next) setLocal(KEYS.signedDeviceId, o.signed_device_id_next);
  return { total: Number(o.total) || 0, counts, mine: isReaction(o.mine) ? o.mine : null };
}

export async function fetchReactions(songId: string): Promise<ReactionCounts> {
  const id = identity();
  const qs = new URLSearchParams({ song: songId, deviceId: id.deviceId, ...(id.signed_device_id ? { signed_device_id: id.signed_device_id } : {}) });
  const res = await fetch(`${URL_}?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`reactions ${res.status}`);
  return parse(await res.json());
}

/** Set (or, with null / the same one again, take away) this device's reaction. */
export async function setReaction(song: Song, emoji: Reaction | null): Promise<ReactionCounts> {
  const body = { song: song.id, emoji, ...identity(), title: song.title, artist: song.subtitle, image: bestImage(song.images, 150) || undefined, language: song.language ?? undefined };
  const res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`reactions ${res.status}`);
  return parse(await res.json());
}

/** The next state after tapping `emoji`: the same one again takes it away. */
export function toggled(mine: Reaction | null, emoji: Reaction): Reaction | null {
  return mine === emoji ? null : emoji;
}

/** Counts after an optimistic tap, so the bar moves before the Worker answers. Pure. */
export function applyLocally(c: ReactionCounts, next: Reaction | null): ReactionCounts {
  const counts = { ...c.counts };
  let total = c.total;
  if (c.mine) { counts[c.mine] = Math.max(0, (counts[c.mine] ?? 1) - 1); total = Math.max(0, total - 1); }
  if (next) { counts[next] = (counts[next] ?? 0) + 1; total += 1; }
  return { total, counts, mine: next };
}
