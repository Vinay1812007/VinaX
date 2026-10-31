/**
 * VinaX AI — hourly housekeeping for chats and their files:
 *   - chats deleted more than a day ago are removed, with their messages,
 *     their attachment rows and their stored files;
 *   - files added but never sent (no conversation) for a day are removed.
 * At most 200 of each per run, so a backlog clears over a few hours without
 * using up the run's requests. Never throws.
 */
import { DAY_MS, db, q, since, type DbEnv } from '../db';
import { storageRemove } from './storage';

export async function purgeAiChats(env: DbEnv, now = Date.now()): Promise<{ chats: number | string; files: number | string }> {
  let chats: number | string = 0;
  let files: number | string = 0;
  const dead = await db.select<{ id: string }>(env, 'ai_conversations', q().lt('deleted_at', since(DAY_MS, now)).select('id').limit(200));
  if (!dead.ok) chats = `failed: ${dead.error}`;
  else if (dead.rows.length) {
    const ids = dead.rows.map((r) => r.id);
    const att = await db.select<{ storage_path: string }>(env, 'ai_attachments', q().in('conversation_id', ids).select('storage_path'));
    if (att.ok && att.rows.length) await storageRemove(env, att.rows.map((r) => r.storage_path));
    const gone = await db.remove(env, 'ai_conversations', q().in('id', ids));
    chats = gone.ok ? ids.length : `failed: ${gone.error}`;
  }
  const loose = await db.select<{ id: string; storage_path: string }>(env, 'ai_attachments', q().is('conversation_id', 'null').lt('created_at', since(DAY_MS, now)).select('id,storage_path').limit(200));
  if (!loose.ok) files = `failed: ${loose.error}`;
  else if (loose.rows.length) {
    await storageRemove(env, loose.rows.map((r) => r.storage_path));
    const gone = await db.remove(env, 'ai_attachments', q().in('id', loose.rows.map((r) => r.id)));
    files = gone.ok ? loose.rows.length : `failed: ${gone.error}`;
  }
  return { chats, files };
}
