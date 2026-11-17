import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';

/**
 * 1.15 — which shared copy (/p/<id>) belongs to which local playlist.
 *
 * The map travels with the library: in the backup file and in the account
 * sync (features/settings/backup.ts), so a second device or a restore still
 * knows its shared copies. The invite token never travels: it is a key, the
 * server hands it back to the owner on a `collab: true` write, and this
 * device keeps the ones it has seen in a separate, device-only key.
 *
 * Stopping a share leaves a mark (`off`) instead of deleting the entry, so a
 * merge with an older copy does not bring the link back. The newer entry
 * (`at`) wins a merge.
 */
export interface ShareLink {
  /** The shared copy's id on the server. */
  id: string;
  /** The server version this account last wrote or merged. */
  version: number;
  public?: boolean;
  /** When this entry last changed (ms). Older copies predate it and count as 0. */
  at: number;
  /** Sharing was stopped: the entry only keeps a merge from reviving it. */
  off?: true;
}
export type ShareMap = Record<string, ShareLink>;

export const SHARE_ID_RE = /^[a-z0-9]{12}$/;
/** The server lists at most 200 shared playlists per owner; leave room for stop marks. */
export const MAX_SHARE_LINKS = 400;
/** Stop marks older than this are dropped: every device has long since merged them. */
const OFF_KEEP_MS = 180 * 86_400_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A clean map, or null when the value is not a map at all. Tokens and unknown fields are dropped. */
export function sanitizeShareMap(v: unknown, now = Date.now()): ShareMap | null {
  if (!isObj(v)) return null;
  const out: ShareMap = {};
  let n = 0;
  for (const [localId, raw] of Object.entries(v)) {
    if (n >= MAX_SHARE_LINKS) break;
    if (!localId || localId.length > 64 || !isObj(raw)) continue;
    const id = typeof raw.id === 'string' && SHARE_ID_RE.test(raw.id) ? raw.id : null;
    if (!id) continue;
    const version = typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 0 ? raw.version : 0;
    const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at >= 0 ? raw.at : 0;
    if (raw.off === true && now - at > OFF_KEEP_MS) continue;
    const link: ShareLink = { id, version, at };
    if (typeof raw.public === 'boolean') link.public = raw.public;
    if (raw.off === true) link.off = true;
    out[localId] = link;
    n += 1;
  }
  return out;
}

/** Union of two maps: per playlist the newer entry wins (this device on a tie); one copy's version never goes back. */
export function mergeShareMaps(mine: ShareMap, theirs: ShareMap): ShareMap {
  const out: ShareMap = { ...mine };
  for (const [localId, b] of Object.entries(theirs)) {
    const a = out[localId];
    if (!a || b.at > a.at) out[localId] = { ...b };
    const won = out[localId];
    const other = won === a ? b : a;
    if (other && !won.off && !other.off && other.id === won.id && other.version > won.version) out[localId] = { ...won, version: other.version };
  }
  return out;
}

// ------------------------------------------------------------- storage --
/** The raw stored map, stop marks included. */
export function readShareMap(): ShareMap {
  return sanitizeShareMap(migrateShareTokens()) ?? {};
}

/** The live links only (no stop marks). */
export function loadShareMap(): ShareMap {
  const all = readShareMap();
  const out: ShareMap = {};
  for (const [k, v] of Object.entries(all)) if (!v.off) out[k] = v;
  return out;
}

export const shareLinkFor = (localId: string): ShareLink | null => loadShareMap()[localId] ?? null;

/** Save (or stop, with null) a playlist's link, and let the account sync carry it. */
export function saveShareLink(localId: string, link: Omit<ShareLink, 'at'> | null, now = Date.now()): void {
  const all = readShareMap();
  const cur = all[localId];
  if (link) all[localId] = { ...link, at: now };
  else if (cur) all[localId] = { id: cur.id, version: cur.version, at: now, off: true };
  else return;
  setLocal(KEYS.sharedPlaylists, all);
  void import('@/services/account/sync').then((m) => m.scheduleSync()).catch(() => undefined);
}

// -------------------------------------------------- invite tokens (device only) --
type TokenMap = Record<string, string>;
const readTokens = (): TokenMap => {
  const v = getLocal<unknown>(KEYS.sharedPlaylistTokens, {});
  return isObj(v) ? (Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as TokenMap) : {};
};

/** The invite token this device has for a shared copy, if any. */
export const inviteTokenFor = (sharedId: string): string | null => readTokens()[sharedId] ?? null;

export function saveInviteToken(sharedId: string, token: string | null): void {
  const all = readTokens();
  if (token) all[sharedId] = token;
  else if (sharedId in all) delete all[sharedId];
  else return;
  setLocal(KEYS.sharedPlaylistTokens, all);
}

/**
 * Older builds kept the token inside the map: move it to the device-only key
 * once. Returns the stored map. The account sync runs this before its first
 * merge, which would otherwise write the map back without tokens.
 */
export function migrateShareTokens(): unknown {
  const raw = getLocal<unknown>(KEYS.sharedPlaylists, {});
  if (!isObj(raw)) return raw;
  let moved = false;
  let tokens: TokenMap | null = null;
  for (const v of Object.values(raw)) {
    if (!isObj(v) || typeof v.id !== 'string' || !('token' in v)) continue;
    tokens ??= readTokens();
    if (typeof v.token === 'string' && v.token && !tokens[v.id]) tokens[v.id] = v.token;
    delete v.token;
    moved = true;
  }
  if (moved && tokens) {
    setLocal(KEYS.sharedPlaylistTokens, tokens);
    setLocal(KEYS.sharedPlaylists, raw);
  }
  return raw;
}
