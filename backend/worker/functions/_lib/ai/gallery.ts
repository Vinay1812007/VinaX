/**
 * VinaX AI — the artifacts gallery: every artifact the account's chats made,
 * read from what each reply already saved (ai_messages.artifacts). Nothing
 * new is stored. The list is metadata only (`ai_artifact_list` in
 * schema.sql: the newest version per artifact id per chat, deleted chats
 * left out); one artifact's versions come with their content.
 */
import { db, q, type DbEnv, type Value } from '../db';
import { ARTIFACT_TYPES, type ArtifactType } from './artifacts';
import { getConversation, MAX_MESSAGES } from './store';

export const GALLERY_PAGE = 30;

/** Artifact ids are slugs (artifacts.ts): lower-case letters, digits and dashes. */
export const ARTIFACT_ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

export const isKind = (v: unknown): v is ArtifactType => typeof v === 'string' && (ARTIFACT_TYPES as readonly string[]).includes(v);

interface ListRow {
  conversation_id: string;
  conversation_title: string | null;
  artifact_id: string;
  message_id: string;
  kind: string | null;
  title: string | null;
  language: string | null;
  incomplete: boolean | null;
  versions: number;
  created_at: string;
  key: string;
}

export interface GalleryItem {
  conversationId: string;
  conversationTitle: string | null;
  artifactId: string;
  messageId: string;
  kind: ArtifactType;
  title: string;
  language: string | null;
  incomplete: boolean;
  versions: number;
  createdAt: string;
}

/** The cursor is the last row's time and key, so the next page starts right after it. */
export function encodeCursor(at: string, key: string): string {
  return `${at}~${key}`;
}

export function decodeCursor(cursor: string | null): { at: string; key: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf('~');
  if (i <= 0) return null;
  const at = cursor.slice(0, i);
  const key = cursor.slice(i + 1);
  if (Number.isNaN(Date.parse(at)) || at.length > 40) return null;
  const [conv, id, extra] = key.split('/');
  if (extra !== undefined || !conv || !id || !/^[0-9a-f-]{36}$/i.test(conv) || !ARTIFACT_ID.test(id)) return null;
  return { at, key };
}

const kindOf = (v: unknown): ArtifactType => (isKind(v) ? v : 'code');

export function publicItem(r: ListRow): GalleryItem {
  const kind = kindOf(r.kind);
  return {
    conversationId: r.conversation_id,
    conversationTitle: r.conversation_title,
    artifactId: r.artifact_id,
    messageId: r.message_id,
    kind,
    title: r.title || (kind === 'code' ? 'Code' : kind.toUpperCase()),
    language: r.language || null,
    incomplete: !!r.incomplete,
    versions: Math.max(1, Number(r.versions) || 1),
    createdAt: r.created_at,
  };
}

export interface ListOptions {
  kind?: ArtifactType | null;
  query?: string | null;
  cursor?: { at: string; key: string } | null;
  limit?: number;
}

/** One page of the account's artifacts, newest first. */
export async function listArtifacts(env: DbEnv, accountId: string, o: ListOptions = {}): Promise<Value<{ items: GalleryItem[]; nextCursor: string | null }>> {
  const limit = Math.max(1, Math.min(100, o.limit ?? GALLERY_PAGE));
  const text = (o.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const r = await db.rpc<ListRow[]>(env, 'ai_artifact_list', {
    p_account: accountId,
    p_kind: o.kind ?? null,
    p_query: text || null,
    p_before: o.cursor?.at ?? null,
    p_before_key: o.cursor?.key ?? null,
    p_limit: limit,
  });
  if (!r.ok) return r;
  const rows = Array.isArray(r.value) ? r.value : [];
  const last = rows[rows.length - 1];
  return { ok: true, value: { items: rows.map(publicItem), nextCursor: rows.length === limit && last ? encodeCursor(last.created_at, last.key) : null } };
}

export interface ArtifactVersion {
  messageId: string;
  createdAt: string;
  type: ArtifactType;
  title: string;
  language: string | null;
  content: string;
  incomplete: boolean;
}

interface SavedArtifact { id?: unknown; type?: unknown; title?: unknown; language?: unknown; content?: unknown; incomplete?: unknown }

/**
 * Every version of one artifact in one of the account's chats, oldest first
 * (every branch). Null when the chat is missing, deleted or someone else's,
 * or holds no such artifact.
 */
export async function artifactVersions(env: DbEnv, accountId: string, conversationId: string, artifactId: string): Promise<Value<{ conversationTitle: string | null; versions: ArtifactVersion[] } | null>> {
  const c = await getConversation(env, accountId, conversationId);
  if (!c.ok) return c;
  if (!c.value) return { ok: true, value: null };
  const m = await db.select<{ id: string; created_at: string; artifacts: unknown }>(
    env,
    'ai_messages',
    q().eq('conversation_id', c.value.id).not('artifacts', 'is', 'null').select('id,created_at,artifacts').order('created_at', 'asc').limit(MAX_MESSAGES),
  );
  if (!m.ok) return m;
  const versions: ArtifactVersion[] = [];
  for (const row of m.rows) {
    if (!Array.isArray(row.artifacts)) continue;
    for (const a of row.artifacts as SavedArtifact[]) {
      if (!a || a.id !== artifactId) continue;
      const type = kindOf(a.type);
      versions.push({
        messageId: row.id,
        createdAt: row.created_at,
        type,
        title: typeof a.title === 'string' && a.title ? a.title : type === 'code' ? 'Code' : type.toUpperCase(),
        language: typeof a.language === 'string' && a.language ? a.language : null,
        content: typeof a.content === 'string' ? a.content : '',
        incomplete: a.incomplete === true,
      });
    }
  }
  return { ok: true, value: versions.length ? { conversationTitle: c.value.title, versions } : null };
}
