/**
 * 8.5.0 — POST /api/ai/dj — the AI DJ under the /api/ai family. The same
 * handler as /api/dj (which installed app builds keep calling).
 *
 * POST, not GET: VinaX keeps listening history on the device, so the caller
 * sends the listening context and the pool of songs the app already checked;
 * the server stores none of it. A GET answers 405 (allow: POST, OPTIONS).
 *
 *   request  { context: { recentlyPlayed, recentlyCompleted, skippedSongs,
 *              likedSongs, topSongs, preferredArtists, avoidArtists, … },
 *              pool: [{ id, title, artist, language?, album?, year?, known?,
 *              mood?, energy?, tempo? }] (3–60), count?: 1–20 (default 8),
 *              discover?: boolean, maxDiscover?: 0–6, wantSegues?: boolean }
 *   200      { intro, songs: [{ songId, title, artist, reason, segue,
 *              confidence, fromPool }], model }
 *   400      bad_request | empty_context | pool_too_small   413 too_large
 *   429      rate_limited   503 ai_not_configured | ai_disabled | ai_over_budget
 *
 * Every pool pick is matched back to the pool by id or canonical title +
 * artist; discoveries (fromPool false) are verified in the catalogue by the
 * app before they can play; intro, reasons and segues keep to what the pool
 * says (_lib/grounding.ts).
 */
export { onRequestGet, onRequestOptions, onRequestPost } from '../dj';
