import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';
import type { Song } from '@/types';

const BASE = isNativePlatform() ? 'https://www.sirimillavinay.online/api/room' : '/api/room';

/**
 * Host tokens are the secret authorizing host-only actions (update, end). The
 * server returns one from `create` and enforces it on subsequent mutations
 * (see audit finding H8). We persist per-code so a host can refresh their tab
 * without losing control of a live session; a rolling 24h cap keeps stale
 * entries from accumulating.
 */
type HostTokenMap = Record<string, { token: string; at: number }>;
const HOST_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function readHostTokens(): HostTokenMap {
  const raw = getLocal<HostTokenMap>(KEYS.roomHostTokens, {} as HostTokenMap);
  return raw ?? ({} as HostTokenMap);
}

function pruneAndPersist(map: HostTokenMap): HostTokenMap {
  const now = Date.now();
  const kept: HostTokenMap = {};
  for (const [code, entry] of Object.entries(map)) {
    if (entry && typeof entry.token === 'string' && now - entry.at < HOST_TOKEN_TTL_MS) {
      kept[code] = entry;
    }
  }
  setLocal(KEYS.roomHostTokens, kept);
  return kept;
}

function rememberHostToken(code: string, token: string): void {
  const map = readHostTokens();
  map[code] = { token, at: Date.now() };
  pruneAndPersist(map);
}

function getHostToken(code: string): string | null {
  const map = pruneAndPersist(readHostTokens());
  return map[code]?.token ?? null;
}

function forgetHostToken(code: string): void {
  const map = readHostTokens();
  delete map[code];
  pruneAndPersist(map);
}

function me(): { deviceId: string; name: string } {
  // Stable, persisted device id so heartbeats/leave use ONE identity per device.
  // (Telemetry sets this too, but only with analytics consent — which is off by
  // default, so we must persist our own to avoid a fresh random id per call.)
  let id = getLocal<string>(KEYS.deviceId, '');
  if (!id) {
    id =
      globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    setLocal(KEYS.deviceId, id);
  }
  return { deviceId: id, name: getLocal<string>(KEYS.userName, '') || 'Listener' };
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface RoomTrack {
  song: Song;
  by: string | null;
}

export interface RoomState {
  host_name: string | null;
  song: Song | null;
  position: number;
  playing: boolean;
  updated_at: string;
  queue: RoomTrack[];
  requests: RoomTrack[];
}

export type CreateRoomResult =
  | { code: string; reason?: undefined }
  | { code: null; reason: 'needs_migration' | 'rate_limited' | 'not_configured' | 'failed' };

/** Create with a DISTINGUISHABLE failure reason — "Could not start a session"
 *  hid a server schema gap (missing host_token column) for weeks because
 *  every failure collapsed to null. */
export async function createRoom(song: Song | null): Promise<CreateRoomResult> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', hostName: me().name, song }),
    });
    const r = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const code = (r?.code as string | undefined) ?? null;
    const hostToken = (r?.hostToken as string | undefined) ?? null;
    if (res.ok && code && hostToken) {
      rememberHostToken(code, hostToken);
      return { code };
    }
    const err = String(r?.error ?? '');
    if (err === 'needs_migration') return { code: null, reason: 'needs_migration' };
    if (err === 'not_configured') return { code: null, reason: 'not_configured' };
    if (res.status === 429) return { code: null, reason: 'rate_limited' };
    return { code: null, reason: 'failed' };
  } catch {
    return { code: null, reason: 'failed' };
  }
}

export async function updateRoom(
  code: string,
  song: Song | null,
  position: number,
  playing: boolean,
  queue: RoomTrack[] = [],
  consumedIds: string[] = [],
): Promise<void> {
  await post({ action: 'update', code, hostToken: getHostToken(code), song, position, playing, queue, consumedIds });
}

/** Guest: ask the host to add a song to the shared queue. */
export async function requestSong(code: string, song: Song): Promise<void> {
  await post({ action: 'request', code, song, by: me().name });
}

/** D11 — the emojis a room reaction may carry (must match the server list). */
export const REACTION_EMOJI = ['❤️', '🔥', '😂', '👏', '🎉', '😍'] as const;

export interface RoomReaction {
  e: string;
  at: string;
}

/** D11 — react to what's playing. Resolves true only when the relay actually
 *  stored it (false until the reaction columns are migrated), so the UI can be
 *  honest about whether anyone else will see it. */
export async function sendReaction(code: string, emoji: string): Promise<boolean> {
  const m = me();
  const r = await post({ action: 'react', code, deviceId: m.deviceId, emoji, name: m.name });
  return r?.ok === true;
}

export async function heartbeat(code: string): Promise<void> {
  const m = me();
  await post({ action: 'heartbeat', code, deviceId: m.deviceId, name: m.name });
}

export async function leaveRoom(code: string): Promise<void> {
  await post({ action: 'leave', code, deviceId: me().deviceId });
}

/** Host only: closes the room for everyone. Guests are told on their next poll. */
export async function endRoom(code: string): Promise<void> {
  await post({ action: 'end', code, hostToken: getHostToken(code) });
  forgetHostToken(code);
}

export interface RoomPoll {
  room: RoomState | null;
  /** Member NAMES — present only when this device is the authorized host
   *  (privacy M-SRV-2: anonymous code-holders never see names). */
  members?: string[];
  /** Always present: how many devices are in the room. */
  memberCount?: number;
  reactions?: RoomReaction[];
}

export async function getRoom(code: string): Promise<RoomPoll | null> {
  try {
    // If WE created this room, prove it — the server only returns member
    // names to the host token (M-SRV-2). The July server change shipped
    // without this client half: guests got `memberCount` while the client
    // still read `members`, so `setMembers(undefined)` crashed the page on
    // the first poll — for every invite-link guest, and for hosts 5s in.
    const hostToken = getHostToken(code);
    const auth = hostToken ? `&hostToken=${encodeURIComponent(hostToken)}` : '';
    const res = await fetch(`${BASE}?code=${encodeURIComponent(code)}${auth}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as RoomPoll;
  } catch {
    return null;
  }
}
