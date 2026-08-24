/**
 * Package B5 — multi-turn taste memory for the chat thread.
 *
 * The taste snapshot is rebuilt per request, so without this the model forgets
 * what it already recommended three turns ago and happily serves the same
 * songs again ("I already told you I love Ilaiyaraaja…"). We derive the memory
 * from the thread itself — no extra state to keep in sync: every completed
 * assistant turn is scanned for the "Title — Artist" lines MUSIC_CONDUCT
 * mandates for song picks, and the most recent unique ones ride the taste
 * payload as `alreadyRecommendedThisChat`. The server appends them to the
 * LISTENER PROFILE with a hard don't-repeat rule.
 */

interface ThreadMsg {
  role: 'user' | 'assistant';
  content: string;
}

// One song line: optional list marker, then Title <dash> Artist, both short.
// Accepts em/en/hyphen dashes with surrounding spaces (models vary), strips
// markdown emphasis and quotes. A stray prose match is harmless — the field
// only tells the model what NOT to repeat.
const LINE_RE = /^\s*(?:[-*•]\s*|\d+[.)]\s*)?(.{2,60}?)\s+[—–-]\s+(.{2,60}?)\s*$/;

function cleanPart(s: string): string {
  return s
    .replace(/[*_`]+/g, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/[.,;:!]+$/, '')
    .trim();
}

/** Recent unique "Title — Artist" picks from this thread's assistant turns,
 *  newest last, capped. Empty when the thread has no song recommendations. */
export function extractRecommendedFromThread(messages: ThreadMsg[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.content) continue;
    for (const raw of m.content.split('\n')) {
      const hit = LINE_RE.exec(raw);
      if (!hit) continue;
      const title = cleanPart(hit[1]);
      const artist = cleanPart(hit[2]);
      // Both halves must survive cleaning and not read like a sentence.
      if (title.length < 2 || artist.length < 2) continue;
      if (/[.?!]{1}\s/.test(title) || /[.?!]{1}\s/.test(artist)) continue;
      const line = `${title} — ${artist}`;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  // Keep the most recent picks when the thread is long.
  return out.slice(-max);
}
