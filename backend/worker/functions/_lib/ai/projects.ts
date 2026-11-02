/**
 * VinaX AI — projects (schema version 9: ai_projects, plus project_id on
 * ai_conversations and ai_attachments). A project is a named workspace: a
 * description, instructions every chat in it follows, and knowledge files
 * every chat in it can read. Knowledge files are ordinary attachments with
 * project_id set and no conversation, uploaded through POST
 * /api/ai/attachments?projectId=, so they are checked, stored and read like
 * any other file. Every read is filtered by the session's account.
 */
import { db, q, type DbEnv, type Rows, type Value } from '../db';
import { ATT_COLS, type AttachmentRow } from './attachments';
import { geminiUri, imageData, type Memo } from './materialize';
import { storageRemove } from './storage';
import type { ProjectPrompt } from './prompt';
import type { AiEnv, ModelSpec, NormalizedMessage } from './types';

export const PROJECT_LIMITS = Object.freeze({ name: 60, description: 300, instructions: 8_000 });
/** Projects one account may hold. */
export const MAX_PROJECTS = 100;
/** Knowledge files in one project. */
export const MAX_PROJECT_FILES = 20;
/** Text kept across one project's knowledge files (text files and PDFs' text). */
export const MAX_PROJECT_CHARS = 200_000;
/** Knowledge images a vision model is sent with each reply; the rest are named. */
export const KNOWLEDGE_IMAGES = 5;

export interface ProjectRow {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

const PROJECT_COLS = 'id,account_id,name,description,instructions,starred,created_at,updated_at';

/** Control characters out (tab and newline kept), runs of blank lines closed up, capped. */
function cleanText(v: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

export type ProjectPatch = Partial<Pick<ProjectRow, 'name' | 'description' | 'instructions' | 'starred'>>;

/**
 * A create or update body, checked. Over-long text is refused (the page
 * holds the same limits), not cut: a cut instruction could change its
 * meaning. `create` needs a name.
 */
export function parseProject(raw: unknown, create: boolean): { ok: true; patch: ProjectPatch } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const b = raw as Record<string, unknown>;
  const patch: ProjectPatch = {};
  if ('name' in b || create) {
    if (typeof b.name !== 'string') return { ok: false };
    const name = b.name.replace(/\s+/g, ' ').trim();
    if (!name || name.length > PROJECT_LIMITS.name) return { ok: false };
    patch.name = name;
  }
  for (const key of ['description', 'instructions'] as const) {
    if (!(key in b) || b[key] == null) { if (key in b) patch[key] = null; continue; }
    if (typeof b[key] !== 'string') return { ok: false };
    const text = cleanText(b[key] as string, Number.MAX_SAFE_INTEGER);
    if (text.length > PROJECT_LIMITS[key]) return { ok: false };
    patch[key] = text || null;
  }
  if ('starred' in b) {
    if (typeof b.starred !== 'boolean') return { ok: false };
    patch.starred = b.starred;
  }
  return { ok: true, patch };
}

/** The account's project, or null (missing or someone else's). */
export function getProject(env: DbEnv, accountId: string, id: string): Promise<Value<ProjectRow | null>> {
  return db.one<ProjectRow>(env, 'ai_projects', q().eq('id', id).eq('account_id', accountId).select(PROJECT_COLS));
}

export function listProjects(env: DbEnv, accountId: string): Promise<Rows<ProjectRow>> {
  return db.select<ProjectRow>(env, 'ai_projects', q().eq('account_id', accountId).select(PROJECT_COLS).order('updated_at', 'desc').limit(MAX_PROJECTS));
}

/** A project's knowledge files, oldest first. */
export function projectFiles(env: DbEnv, accountId: string, projectId: string): Promise<Rows<AttachmentRow>> {
  return db.select<AttachmentRow>(env, 'ai_attachments', q().eq('account_id', accountId).eq('project_id', projectId).select(ATT_COLS).order('created_at', 'asc').limit(MAX_PROJECT_FILES * 2));
}

/** How many knowledge files a project holds and how much text they carry (`except` leaves one out). */
export async function knowledgeUsage(env: DbEnv, accountId: string, projectId: string, except?: string): Promise<Value<{ files: number; chars: number }>> {
  const r = await db.select<{ id: string; extracted_text: string | null }>(env, 'ai_attachments', q().eq('account_id', accountId).eq('project_id', projectId).select('id,extracted_text').limit(MAX_PROJECT_FILES * 2));
  if (!r.ok) return r;
  const rows = r.rows.filter((x) => x.id !== except);
  return { ok: true, value: { files: rows.length, chars: rows.reduce((n, x) => n + (x.extracted_text?.length ?? 0), 0) } };
}

/** Remove the stored bytes of a project's files (the rows go with the project). Best effort. */
export async function removeProjectFiles(env: DbEnv, accountId: string, projectId: string): Promise<void> {
  const r = await db.select<{ storage_path: string }>(env, 'ai_attachments', q().eq('account_id', accountId).eq('project_id', projectId).select('storage_path').limit(MAX_PROJECT_FILES * 2));
  if (r.ok && r.rows.length) await storageRemove(env, r.rows.map((x) => x.storage_path));
}

/** What the page is sent for one project (no account id). */
export function publicProject(p: ProjectRow, counts?: { chats: number; files: number }): Record<string, unknown> {
  return {
    id: p.id, name: p.name, description: p.description, instructions: p.instructions, starred: p.starred, createdAt: p.created_at, updatedAt: p.updated_at,
    ...(counts ? { chatCount: counts.chats, fileCount: counts.files } : {}),
  };
}

/** What the page is sent for one knowledge file (never its text). */
export function publicKnowledgeFile(r: AttachmentRow): Record<string, unknown> {
  return { id: r.id, name: r.name, mime: r.mime, kind: r.kind, size: r.size, ...(r.pages ? { pages: r.pages } : {}), chars: r.extracted_text?.length ?? 0, createdAt: r.created_at };
}

/** The project a chat belongs to, with its knowledge files, loaded once per reply. */
export interface ProjectContext {
  project: ProjectRow;
  files: AttachmentRow[];
  /** Characters of knowledge text (for Auto's long-thread ladder). */
  chars: number;
}

/** The chat's project, or null (none, gone, or the database did not answer: the chat goes on without it). */
export async function loadProjectContext(env: DbEnv, accountId: string, projectId: string | null | undefined): Promise<ProjectContext | null> {
  if (!projectId) return null;
  const [p, f] = await Promise.all([getProject(env, accountId, projectId), projectFiles(env, accountId, projectId)]);
  if (!p.ok || !p.value) return null;
  const files = f.ok ? f.rows : [];
  return { project: p.value, files, chars: files.reduce((n, a) => n + (a.extracted_text?.length ?? 0), 0) };
}

/** Knowledge past this much text (or any PDF) sends Auto to its long-document ladder, so it fits whole. */
export const LONG_KNOWLEDGE_CHARS = 12_000;
export const longKnowledge = (ctx: ProjectContext | null): boolean => !!ctx && (ctx.chars > LONG_KNOWLEDGE_CHARS || ctx.files.some((f) => f.kind === 'pdf'));

/** The project as one model is sent it: text for the system prompt, images and PDF files for the latest question. */
export interface Knowledge {
  prompt: ProjectPrompt;
  images: NonNullable<NormalizedMessage['images']>;
  files: NonNullable<NormalizedMessage['files']>;
}

/**
 * Knowledge for `spec`, the way materialize.ts treats a chat's files: text
 * files as documents; a PDF as a file for a model that reads PDFs, else its
 * text; images for a vision model (at most KNOWLEDGE_IMAGES), else by name.
 */
export async function knowledgeFor(env: AiEnv, spec: ModelSpec, ctx: ProjectContext, memo: Memo): Promise<Knowledge> {
  const documents: ProjectPrompt['documents'] = [];
  const notes: string[] = [];
  const images: Knowledge['images'] = [];
  const files: Knowledge['files'] = [];
  for (const row of ctx.files) {
    if (row.kind === 'image') {
      if (spec.flags.vision && images.length < KNOWLEDGE_IMAGES) {
        const img = await imageData(env, row, memo);
        if (img) { images.push(img); notes.push(`[image: ${row.name} (attached to the user's latest message)]`); }
        else notes.push(`[image: ${row.name} (it could not be loaded)]`);
      } else notes.push(spec.flags.vision ? `[image: ${row.name}]` : `[image: ${row.name} (this model cannot see images)]`);
    } else if (row.kind === 'pdf') {
      const uri = spec.provider === 'gemini' && spec.flags.pdf ? await geminiUri(env, row, memo) : null;
      if (uri) { files.push({ mime: row.mime, uri }); notes.push(`[document: ${row.name} (attached to the user's latest message)]`); }
      else if (row.extracted_text?.trim()) documents.push({ name: row.name, text: row.extracted_text });
      else notes.push(`[document: ${row.name} (its text could not be read)]`);
    } else documents.push({ name: row.name, text: row.extracted_text ?? '' });
  }
  return { prompt: { name: ctx.project.name, instructions: ctx.project.instructions, documents, notes }, images, files };
}

/** The thread with the project's images and PDF files added to the latest question. */
export function withKnowledge(messages: NormalizedMessage[], k: Knowledge | null): NormalizedMessage[] {
  if (!k || (!k.images.length && !k.files.length)) return messages;
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role !== 'user') i--;
  if (i < 0) return messages;
  const m = messages[i];
  const out = messages.slice();
  out[i] = {
    ...m,
    ...(k.images.length ? { images: [...k.images, ...(m.images ?? [])] } : {}),
    ...(k.files.length ? { files: [...k.files, ...(m.files ?? [])] } : {}),
  };
  return out;
}
