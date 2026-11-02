/**
 * VinaX AI — shared chats (schema version 8: ai_shares). A share is a
 * snapshot of one chat's active branch, taken when its owner creates or
 * updates the link. It holds what the chat showed: the text of each turn
 * (artifacts are inside it), files as names only, web sources. Reasoning,
 * model details and file contents are left out. One link per chat.
 */
import { db, q, type DbEnv, type Rows, type Value } from '../db';
import { pathTo, latestLeaf } from './history';
import type { ConversationRow, MessageRow } from './store';

export interface ShareFile {
  name: string;
  kind: 'image' | 'pdf' | 'text';
}

export interface ShareSource {
  n: number;
  url: string;
  title: string;
  site: string;
  snippet?: string;
}

export interface ShareMessage {
  role: 'user' | 'assistant';
  text: string;
  files?: ShareFile[];
  sources?: { via: 'grounding' | 'search'; items: ShareSource[]; entryPointHtml?: string };
  createdAt: string;
}

export interface ShareRow {
  id: string;
  account_id: string;
  conversation_id: string;
  title: string;
  messages: ShareMessage[];
  message_count: number;
  bytes: number;
  created_at: string;
  updated_at: string;
}

/** The largest snapshot kept (its JSON, in bytes). */
export const MAX_SHARE_BYTES = 1_000_000;

/** 128 random bits, base64url: 22 characters. */
export const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
export const isShareId = (v: unknown): v is string => typeof v === 'string' && SHARE_ID.test(v);

export function newShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const SUMMARY_COLS = 'id,conversation_id,title,message_count,created_at,updated_at';
const KINDS = new Set(['image', 'pdf', 'text']);
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanSources(raw: unknown): ShareMessage['sources'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as { via?: unknown; items?: unknown; entryPointHtml?: unknown };
  if (!Array.isArray(s.items)) return undefined;
  const items: ShareSource[] = [];
  for (const it of s.items.slice(0, 20)) {
    const x = it as Record<string, unknown>;
    const url = clip(x?.url, 2_000);
    if (typeof x?.n !== 'number' || !/^https?:\/\//i.test(url)) continue;
    items.push({ n: x.n, url, title: clip(x.title, 300), site: clip(x.site, 120), ...(typeof x.snippet === 'string' ? { snippet: clip(x.snippet, 500) } : {}) });
  }
  if (!items.length) return undefined;
  const html = clip(s.entryPointHtml, 20_000);
  return { via: s.via === 'grounding' ? 'grounding' : 'search', items, ...(html ? { entryPointHtml: html } : {}) };
}

/** The active branch as the snapshot shows it. Empty replies (failed, stopped at once) are left out. */
export function snapshotOf(conv: Pick<ConversationRow, 'active_leaf_id'>, rows: readonly MessageRow[]): ShareMessage[] {
  const leaf = conv.active_leaf_id && rows.some((r) => r.id === conv.active_leaf_id) ? conv.active_leaf_id : latestLeaf(rows)?.id ?? null;
  const out: ShareMessage[] = [];
  for (const m of pathTo(rows, leaf)) {
    const parts = Array.isArray(m.content) ? m.content : [];
    const text = parts.filter((p) => p?.type === 'text').map((p) => String(p.text ?? '')).filter(Boolean).join('\n\n');
    const files: ShareFile[] = parts
      .filter((p) => p?.type === 'attachment')
      .map((p) => ({ name: clip(p.name, 200) || 'file', kind: (KINDS.has(String(p.kind)) ? p.kind : 'text') as ShareFile['kind'] }));
    if (!text.trim() && !files.length) continue;
    const sources = m.role === 'assistant' ? cleanSources(m.sources) : undefined;
    out.push({ role: m.role, text, ...(files.length ? { files } : {}), ...(sources ? { sources } : {}), createdAt: m.created_at });
  }
  return out;
}

export const byteSize = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

/** The title a share shows. */
export const shareTitle = (title: string | null): string => (title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'VinaX AI chat';

/** Anyone's share, by its id; null when missing or its chat was deleted (the purge removes the row later). */
export async function getShare(env: DbEnv, id: string): Promise<Value<ShareRow | null>> {
  const r = await db.one<ShareRow>(env, 'ai_shares', q().eq('id', id).select('id,conversation_id,title,messages,message_count,created_at,updated_at'));
  if (!r.ok || !r.value) return r;
  const live = await db.one<{ id: string }>(env, 'ai_conversations', q().eq('id', r.value.conversation_id).is('deleted_at', 'null').select('id'));
  if (!live.ok) return live;
  return { ok: true, value: live.value ? r.value : null };
}

export function shareOfConversation(env: DbEnv, accountId: string, conversationId: string): Promise<Value<ShareRow | null>> {
  return db.one<ShareRow>(env, 'ai_shares', q().eq('conversation_id', conversationId).eq('account_id', accountId).select(SUMMARY_COLS));
}

export function listShares(env: DbEnv, accountId: string, conversationId?: string | null): Promise<Rows<ShareRow>> {
  const query = q().eq('account_id', accountId).select(SUMMARY_COLS).order('updated_at', 'desc').limit(200);
  if (conversationId) query.eq('conversation_id', conversationId);
  return db.select<ShareRow>(env, 'ai_shares', query);
}

/** Remove one share of the account ([] = nothing matched). */
export function removeShare(env: DbEnv, accountId: string, id: string): Promise<Rows<ShareRow>> {
  return db.remove<ShareRow>(env, 'ai_shares', q().eq('id', id).eq('account_id', accountId), { returning: true });
}

/** Remove the share of a chat (when the chat is deleted). */
export function removeSharesOf(env: DbEnv, accountId: string, conversationId: string): Promise<Rows<ShareRow>> {
  return db.remove<ShareRow>(env, 'ai_shares', q().eq('conversation_id', conversationId).eq('account_id', accountId));
}

/** What the owner's page is told about a share. */
export function publicShareSummary(r: Pick<ShareRow, 'id' | 'conversation_id' | 'title' | 'message_count' | 'created_at' | 'updated_at'>): Record<string, unknown> {
  return { id: r.id, conversationId: r.conversation_id, title: r.title, messageCount: r.message_count, createdAt: r.created_at, updatedAt: r.updated_at };
}
