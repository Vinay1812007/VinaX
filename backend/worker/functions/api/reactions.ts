/**
 * 2.0 — song reactions are gone from VinaX. Apps from before 2.0 still ask
 * for a song's reactions; they get an empty answer so nothing breaks while
 * they update, and leaving a reaction answers 410 Gone. Nothing is read from
 * or written to the database any more (schema version 25 dropped the
 * `song_reactions` table and its rows).
 *
 *   GET  /api/reactions?song=<id> → { total: 0, counts: {}, mine: null }
 *   POST /api/reactions           → 410 { error: 'reactions_removed' }
 */
import { jsonResponse } from '../_lib/edge';
import { methodNotAllowed } from '../_lib/ratelimit';

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export const onRequestOptions = async (): Promise<Response> => new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (): Promise<Response> =>
  jsonResponse({ total: 0, counts: {}, mine: null }, 200, { ...CORS, 'cache-control': 'public, max-age=3600' });

export const onRequestPut = async (): Promise<Response> => methodNotAllowed();

export const onRequestPost = async (): Promise<Response> => jsonResponse({ error: 'reactions_removed' }, 410, CORS);
