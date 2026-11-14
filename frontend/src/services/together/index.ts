import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';
import { Flight } from '@/features/together/sync';
import type { Song } from '@/types';

const BASE = isNativePlatform() ? 'https://www.vinaxmusic.online/api/room' : '/api/room';

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
  /** 1.14 — the handle of the guest who added it: they may take it out again. */
  h?: string | null;
}

/** 1.14 — someone in the room, by the handle the server shows them by. */
export interface RoomPerson {
  h: string;
  name: string;
  /** 1.14 — the member's app version and Listen Together sync protocol (absent: an app older than 1.14). */
  app?: string;
  sync?: number;
}

/**
 * 1.14 — the Listen Together sync protocol this app speaks. Raise it when a
 * change means older apps can no longer keep in step with newer ones: the
 * room then says whose app needs updating. Apps older than 1.14 send none.
 */
export const SYNC_PROTOCOL = 2;

/** This app's version ("1.14.0"), without any build suffix. */
export function appVersion(): string {
  return (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '').split('+')[0];
}

/** 1.14 — what a guest can ask the host's app to do. */
export type JamCmd = 'play' | 'pause' | 'next' | 'prev' | 'add' | 'remove';

/** A guest's command, as the host's poll lists it. */
export interface RoomControl {
  id: string;
  cmd: JamCmd;
  h: string;
  by: string;
  at: string;
  song?: Song;
  songId?: string;
}

export interface RoomMessage { by: string; text: string; at: string; id?: string }

/** The name this device gives a room. */
export function myName(): string {
  return me().name;
}

export interface RoomState {
  host_name: string | null;
  song: Song | null;
  position: number;
  playing: boolean;
  updated_at: string;
  queue: RoomTrack[];
  requests: RoomTrack[];
  /** 15.0 — the room's short chat and how many voted to skip the current song. */
  messages?: RoomMessage[];
  skipVotes?: number;
  /** 1.14 — guests may play, pause and skip; and the host's handle (null: a host app older than 1.14). */
  guestControl?: boolean;
  hostH?: string | null;
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

/** 10.0 — what a host push achieved. `gone` (the room no longer exists) and
 *  `forbidden` (this device no longer holds the host token) used to be
 *  swallowed, so a host kept "broadcasting" to nobody. */
export type UpdateResult = 'ok' | 'gone' | 'forbidden' | 'error';

/**
 * How long a host push spends getting to the server. The server stamps a push
 * when it ARRIVES, but the position inside it was read when it left, so every
 * guest placed the host that much behind where it really was. Each push now
 * measures the trip (round trip minus the server's own time, halved) and the
 * next one is sent that far ahead.
 */
const uplink = new Flight();
/** True once the server has said it honours `at` (1.12.11). Until then, and
 *  against an older Worker, a push leads by the measured uplink instead. */
let serverStamps = false;

/**
 * `position` is the host's playhead right now. A host that has worked out the
 * server's clock passes `at`, the server moment (ms) the position was read
 * at, and the push is exact however long it takes to arrive. Without it (the
 * first push of a session, an older Worker) a playing position is sent as
 * where the playhead will be when the push lands.
 */
export async function updateRoom(
  code: string,
  song: Song | null,
  position: number,
  playing: boolean,
  queue: RoomTrack[] = [],
  consumedIds: string[] = [],
  at?: number,
  jam?: { guestControl: boolean },
): Promise<UpdateResult> {
  try {
    const stamped = serverStamps && typeof at === 'number' && Number.isFinite(at);
    const lands = playing && !stamped ? position + uplink.ms / 1000 : position;
    const sent = performance.now();
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', code, hostToken: getHostToken(code), song, position: lands, playing, queue, consumedIds, ...(stamped ? { at } : {}), ...(jam ? { guestControl: jam.guestControl, deviceId: me().deviceId } : {}) }),
    });
    if (res.ok) {
      const rtt = performance.now() - sent;
      // A Worker older than 1.12.10 does not say how long it took: then the
      // trip cannot be told from the database's time, and nothing is added.
      const answer = (await res.json().catch(() => null)) as { took?: unknown; stamps?: unknown } | null;
      const took = answer?.took;
      if (typeof took === 'number' && Number.isFinite(took) && took >= 0) uplink.add(Math.max(0, rtt - took) / 2);
      serverStamps = answer?.stamps === true;
      return 'ok';
    }
    if (res.status === 404) return 'gone';
    if (res.status === 403) return 'forbidden';
    return 'error';
  } catch {
    return 'error';
  }
}

/** True when this device holds the host token for `code` (survives a reload). */
export function isHostOf(code: string): boolean {
  return !!getHostToken(code);
}

/** Guest: ask the host to add a song to the shared queue. Resolves true only
 *  when the server stored it — the UI used to say "Sent" either way. */
export async function requestSong(code: string, song: Song): Promise<boolean> {
  const r = await post({ action: 'request', code, song, by: me().name });
  return r?.ok === true;
}

export type ControlResult = 'ok' | 'no_control' | 'removed' | 'gone' | 'error';

/**
 * 1.14 — a guest plays, pauses, skips, adds or takes out a song. The host's
 * app carries it out (it owns the music); `id` names the command so it is
 * done once however it arrives.
 */
export async function sendControl(code: string, id: string, cmd: JamCmd, extra: { song?: Song; songId?: string } = {}): Promise<ControlResult> {
  try {
    const m = me();
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'control', code, deviceId: m.deviceId, name: m.name, id, cmd, ...extra }),
    });
    if (res.ok) return 'ok';
    const r = (await res.json().catch(() => null)) as { error?: string } | null;
    if (r?.error === 'no_control') return 'no_control';
    if (r?.error === 'removed') return 'removed';
    if (res.status === 404) return 'gone';
    return 'error';
  } catch {
    return 'error';
  }
}

/** 1.14 — host only: take someone out of the room (by handle). */
export async function removePerson(code: string, who: string): Promise<boolean> {
  const r = await post({ action: 'kick', code, hostToken: getHostToken(code), who });
  return r?.ok === true;
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

/** 15.0 — a chat line, kept by the room for whoever polls or joins later.
 *  1.13: `id` names the line, so a phone that already showed it from the
 *  live line knows the stored copy is the same one. */
export async function sayInRoom(code: string, text: string, id?: string): Promise<boolean> {
  const m = me();
  const r = await post({ action: 'say', code, deviceId: m.deviceId, name: m.name, text, ...(id ? { id } : {}) });
  return r?.ok === true;
}

/** 15.0 — vote to skip the song playing now; resolves the vote count. */
export async function voteSkip(code: string, songId: string): Promise<number | null> {
  const r = (await post({ action: 'skip', code, deviceId: me().deviceId, songId })) as { ok?: boolean; skipVotes?: number } | null;
  return r?.ok ? r.skipVotes ?? null : null;
}

export async function heartbeat(code: string): Promise<void> {
  const m = me();
  // 1.14 — which app this is, so the room can say whose app is too old to keep in step.
  await post({ action: 'heartbeat', code, deviceId: m.deviceId, name: m.name, app: appVersion() || undefined, sync: SYNC_PROTOCOL });
}

export async function leaveRoom(code: string): Promise<void> {
  await post({ action: 'leave', code, deviceId: me().deviceId });
}

/** Leave while the page is closing: a beacon survives the unload where a
 *  fetch would be cancelled. The server parses the body as JSON regardless
 *  of the text/plain type a beacon carries. */
export function leaveRoomBeacon(code: string): void {
  try {
    navigator.sendBeacon?.(BASE, JSON.stringify({ action: 'leave', code, deviceId: me().deviceId }));
  } catch {
    /* best effort */
  }
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
  /** 15.0 — the names members gave, for everyone in the room. */
  names?: string[];
  reactions?: RoomReaction[];
  /** 10.0 — the server's clock (ms) when the poll arrived; absent on older Workers. */
  now?: number;
  /** 1.12.10 — how long (ms) the server then took to answer. */
  took?: number;
  /** 1.13 — where the room's live line is (features/together/live.ts), when the server has one. */
  live?: unknown;
  /** 1.14 — who is here (by handle), this device's handle, and whether the host removed it. */
  people?: RoomPerson[];
  me?: string;
  removed?: boolean;
  /** 1.14 — host only: the guests' commands. */
  controls?: RoomControl[];
  /** 10.0 — client-measured round trip of this poll, and when it landed
   *  (performance.now()), so a follower can project the host's position. */
  rttMs?: number;
  receivedAt?: number;
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
    const sent = performance.now();
    // 1.14 — who is asking: the answer says this device's handle, and whether the host removed it.
    const who = `&member=${encodeURIComponent(me().deviceId)}`;
    const res = await fetch(`${BASE}?code=${encodeURIComponent(code)}${auth}${who}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as RoomPoll;
    const receivedAt = performance.now();
    return { ...body, rttMs: receivedAt - sent, receivedAt };
  } catch {
    return null;
  }
}
