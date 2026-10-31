/**
 * VinaX AI — conversation storage in Supabase (schema version 4:
 * ai_conversations, ai_messages, ai_attachments). The Worker is the only
 * client. Every conversation read is filtered by the session's account, and
 * messages are only touched after their conversation passed that check.
 */
import { db, q, type DbEnv, type Rows, type Value } from '../db';
import type { MessagePart } from './types';

export interface ConversationRow {
  id: string;
  account_id: string;
  title: string | null;
  starred: boolean;
  model_pref: string | null;
  active_leaf_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  parent_id: string | null;
  role: 'user' | 'assistant';
  content: MessagePart[];
  thinking: string | null;
  thinking_ms: number | null;
  sources: unknown;
  artifacts: unknown;
  model_id: string | null;
  provider: string | null;
  stop_reason: string | null;
  usage: unknown;
  created_at: string;
}

const CONV_COLS = 'id,account_id,title,starred,model_pref,active_leaf_id,created_at,updated_at,deleted_at';
const MSG_COLS = 'id,conversation_id,parent_id,role,content,thinking,thinking_ms,sources,artifacts,model_id,provider,stop_reason,usage,created_at';

/** Messages one conversation may hold; past this the chat asks for a new one. */
export const MAX_MESSAGES = 2_000;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** The account's conversation, or null (missing, deleted or someone else's). */
export function getConversation(env: DbEnv, accountId: string, id: string): Promise<Value<ConversationRow | null>> {
  return db.one<ConversationRow>(env, 'ai_conversations', q().eq('id', id).eq('account_id', accountId).is('deleted_at', 'null').select(CONV_COLS));
}

export async function createConversation(env: DbEnv, row: { id: string; account_id: string; title: string; model_pref: string | null }): Promise<Rows<ConversationRow>> {
  const now = new Date().toISOString();
  return db.insert<ConversationRow>(env, 'ai_conversations', { ...row, starred: false, created_at: now, updated_at: now }, { returning: true });
}

export function updateConversation(env: DbEnv, accountId: string, id: string, patch: Partial<Pick<ConversationRow, 'title' | 'starred' | 'active_leaf_id' | 'model_pref' | 'updated_at' | 'deleted_at'>>): Promise<Rows<ConversationRow>> {
  return db.update<ConversationRow>(env, 'ai_conversations', q().eq('id', id).eq('account_id', accountId).is('deleted_at', 'null').select(CONV_COLS), patch, { returning: true });
}

export function listMessages(env: DbEnv, conversationId: string): Promise<Rows<MessageRow>> {
  return db.select<MessageRow>(env, 'ai_messages', q().eq('conversation_id', conversationId).select(MSG_COLS).order('created_at', 'asc').limit(MAX_MESSAGES));
}

export function insertMessage(env: DbEnv, row: Partial<MessageRow> & Pick<MessageRow, 'id' | 'conversation_id' | 'parent_id' | 'role' | 'content'>): Promise<Rows<MessageRow>> {
  return db.insert<MessageRow>(env, 'ai_messages', { created_at: new Date().toISOString(), ...row });
}

/** Change a message of a conversation that already passed the ownership check. */
export function updateMessage(env: DbEnv, conversationId: string, id: string, patch: Partial<Pick<MessageRow, 'content' | 'thinking' | 'artifacts' | 'model_id' | 'provider' | 'stop_reason' | 'usage'>>): Promise<Rows<MessageRow>> {
  return db.update<MessageRow>(env, 'ai_messages', q().eq('id', id).eq('conversation_id', conversationId), patch);
}

/** Every chat of the account with its messages, as one JSON document (`ai_export`). */
export function exportChats(env: DbEnv, accountId: string): Promise<Value<unknown>> {
  return db.rpc<unknown>(env, 'ai_export', { p_account: accountId });
}

export interface ListOptions {
  /** Return conversations updated before this time (ISO), for paging. */
  before?: string | null;
  /** Search text: titles and message text. */
  query?: string | null;
  limit?: number;
}

/** The account's conversations, newest first. A search goes through `ai_conversation_search` (titles and message text). */
export async function listConversations(env: DbEnv, accountId: string, o: ListOptions = {}): Promise<Rows<ConversationRow>> {
  const limit = Math.max(1, Math.min(100, o.limit ?? 30));
  const text = (o.query ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (text) {
    // The function escapes the LIKE wildcards itself.
    const r = await db.rpc<ConversationRow[]>(env, 'ai_conversation_search', { p_account: accountId, p_query: text, p_before: o.before ?? null, p_limit: limit });
    return r.ok ? { ok: true, rows: Array.isArray(r.value) ? r.value : [] } : { ...r, rows: [] };
  }
  const query = q().eq('account_id', accountId).is('deleted_at', 'null').select(CONV_COLS).order('updated_at', 'desc').limit(limit);
  if (o.before) query.lt('updated_at', o.before);
  return db.select<ConversationRow>(env, 'ai_conversations', query);
}

/** Soft delete: hidden at once, purged by the hourly housekeeping a day later. */
export function deleteConversation(env: DbEnv, accountId: string, id: string): Promise<Rows<ConversationRow>> {
  return updateConversation(env, accountId, id, { deleted_at: new Date().toISOString() });
}

/** What the page is sent for one conversation (no account id). */
export function publicConversation(c: ConversationRow): Record<string, unknown> {
  return { id: c.id, title: c.title, starred: c.starred, modelPref: c.model_pref, activeLeafId: c.active_leaf_id, createdAt: c.created_at, updatedAt: c.updated_at };
}

/** `label` names the model that answered (registry name and provider), when it is still known. */
export function publicMessage(r: MessageRow, label?: (modelId: string) => { name: string; provider: string } | null): Record<string, unknown> {
  const named = r.model_id && label ? label(r.model_id) : null;
  return {
    id: r.id,
    parentId: r.parent_id,
    role: r.role,
    content: r.content,
    thinking: r.thinking,
    thinkingMs: r.thinking_ms,
    sources: r.sources ?? null,
    artifacts: r.artifacts ?? null,
    model: r.model_id ? { id: r.model_id, name: named?.name ?? r.model_id, provider: named?.provider ?? r.provider } : null,
    stopReason: r.stop_reason,
    usage: r.usage ?? null,
    createdAt: r.created_at,
  };
}
