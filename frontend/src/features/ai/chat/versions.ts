/**
 * 11.2 — editing a message in place, with its earlier versions kept.
 *
 * Editing a message used to copy the whole thread into a new "· before edit"
 * chat and cut this one back to before the message. Now the edit happens in
 * the same chat: the message gets the new text, everything after it is asked
 * again, and what it replaced — the old text AND the turns that followed it —
 * stays on the message as an earlier version the listener can switch back to.
 *
 * Shape (types.ts): a user message that has been edited carries `versions`
 * (oldest first) and `version` (the one on screen). The version on screen
 * keeps `after: []` — its turns are the thread itself; every other version
 * keeps the turns that followed it. No React here.
 */
import type { Msg, MsgVersion } from './types';

/** At most this many versions per message; the oldest goes first. */
export const MAX_VERSIONS = 10;
/** Versions inside versions (an edit inside an earlier version's turns) are
 *  kept this many levels deep when a stored chat is read back. */
export const MAX_VERSION_DEPTH = 3;

const clampVersion = (v: number | undefined, length: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length ? v : length - 1;

/** Which version a message shows and how many it has (1 / 1 when never edited). */
export function versionOf(m: Pick<Msg, 'versions' | 'version'>): { at: number; count: number } {
  const count = m.versions?.length ?? 0;
  if (count < 2) return { at: 0, count: 1 };
  return { at: clampVersion(m.version, count), count };
}

const snapshot = (m: Msg, after: Msg[]): MsgVersion => ({ content: m.content, ...(m.images?.length ? { images: m.images } : {}), after });

/**
 * The user message at `i` edited to `content`: the version on screen is kept
 * with the turns that follow it, and the new text becomes the latest version
 * (attachments stay with it). The caller asks for a reply to the result.
 */
export function editedMessage(messages: Msg[], i: number, content: string): Msg {
  const m = messages[i];
  const had = m.versions && m.versions.length > 1 ? m.versions.slice() : [snapshot(m, [])];
  const at = clampVersion(m.version, had.length);
  had[at] = snapshot(m, messages.slice(i + 1));
  const versions = [...had, { content, ...(m.images?.length ? { images: m.images } : {}), after: [] }].slice(-MAX_VERSIONS);
  return { role: 'user', content, ...(m.images?.length ? { images: m.images } : {}), versions, version: versions.length - 1 };
}

/**
 * The thread with the message at `i` switched to version `target`: the version
 * on screen is put away with its turns, and the target's text and turns come
 * back in place. Null when there is nothing to switch to.
 */
export function showVersion(messages: Msg[], i: number, target: number): Msg[] | null {
  const m = messages[i];
  if (!m || m.role !== 'user' || !m.versions || m.versions.length < 2) return null;
  const at = clampVersion(m.version, m.versions.length);
  if (!Number.isInteger(target) || target < 0 || target >= m.versions.length || target === at) return null;
  const versions = m.versions.slice();
  versions[at] = snapshot(m, messages.slice(i + 1));
  const next = versions[target];
  versions[target] = { ...next, after: [] };
  const user: Msg = { ...m, content: next.content, versions, version: target };
  if (next.images?.length) user.images = next.images;
  else delete user.images;
  return [...messages.slice(0, i), user, ...next.after];
}

/** Only pictures the chat itself made: a data URL, or the '' a stored chat
 *  keeps where one used to be (never a remote address). */
const isInlinePicture = (u: unknown): u is string =>
  typeof u === 'string' && (u === '' || (u.startsWith('data:image/') && u.length < 6_000_000));

/**
 * A stored message's `versions` / `version`, checked field by field (stored
 * chats and imports are read back the same way). `reviveAfter` reads each
 * following turn — and is handed the depth, so versions nested in versions
 * stop at MAX_VERSION_DEPTH. Returns {} when there is nothing valid to keep.
 */
export function reviveVersions(
  raw: unknown,
  version: unknown,
  reviveAfter: (m: unknown, depth: number) => Msg | null,
  depth = 0,
): Pick<Msg, 'versions' | 'version'> {
  if (depth >= MAX_VERSION_DEPTH || !Array.isArray(raw)) return {};
  const versions: MsgVersion[] = [];
  for (const v of raw.slice(-MAX_VERSIONS)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.content !== 'string') continue;
    const images = Array.isArray(r.images) ? r.images.filter(isInlinePicture).slice(0, 6) : [];
    const after = Array.isArray(r.after) ? r.after.map((x) => reviveAfter(x, depth + 1)).filter((x): x is Msg => x !== null) : [];
    versions.push({ content: r.content, ...(images.length ? { images } : {}), after });
  }
  if (versions.length < 2) return {};
  const at = clampVersion(typeof version === 'number' ? version : undefined, versions.length);
  versions[at] = { ...versions[at], after: [] };
  return { versions, version: at };
}

/** Apply `fn` to every message a version keeps (for the persist strip). */
export function mapVersionTurns(m: Msg, fn: (m: Msg) => Msg): Msg {
  if (!m.versions?.length) return m;
  return { ...m, versions: m.versions.map((v) => ({ ...v, after: v.after.map(fn) })) };
}
