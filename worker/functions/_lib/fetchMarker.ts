/**
 * Package B3 — model-initiated live search: the `[[FETCH: query]]` marker.
 *
 * The system prompt (assistant modes only) tells the model: if the question
 * truly needs fresh web data, open the reply with EXACTLY one marker line and
 * stop. The SSE probe gate feeds the accumulating lead text through
 * `probeFetchMarker` on every delta:
 *
 *   'wait'   — could still become a marker (or is one, unclosed); keep buffering
 *   'no'     — definitely ordinary text; release the gate
 *   'marker' — complete marker: `q` is the search query, `rest` any trailing
 *              text after `]]` (usually empty)
 *
 * Kept pure and dependency-free so the boundary cases (split across deltas,
 * quoted queries, absurdly long non-markers) are unit-testable without a
 * streaming harness.
 */

const OPEN = '[[FETCH:';
/** A real search query is short; anything past this is prose, not a marker. */
const MAX_MARKER_LEN = 420;

export type FetchProbe =
  | { state: 'wait' }
  | { state: 'no' }
  | { state: 'marker'; q: string; rest: string };

export function probeFetchMarker(lead: string): FetchProbe {
  if (!lead) return { state: 'wait' };
  // Shorter than the opening token and still matching its prefix — undecided.
  if (lead.length < OPEN.length) {
    return OPEN.startsWith(lead) ? { state: 'wait' } : { state: 'no' };
  }
  if (!lead.startsWith(OPEN)) return { state: 'no' };
  const close = lead.indexOf(']]');
  if (close < 0) {
    // Opened like a marker but never closes — past the cap it's just text.
    return lead.length > MAX_MARKER_LEN ? { state: 'no' } : { state: 'wait' };
  }
  const q = lead
    .slice(OPEN.length, close)
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
  const rest = lead.slice(close + 2).replace(/^\s+/, '');
  // An empty query is not a usable marker — treat the whole thing as text.
  if (!q) return { state: 'no' };
  return { state: 'marker', q: q.slice(0, 300), rest };
}
