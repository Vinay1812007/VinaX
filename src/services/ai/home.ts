import { isNativePlatform } from '@/services/native';

const ENDPOINT = isNativePlatform() ? 'https://www.sirimillavinay.online/api/home' : '/api/home';

export interface AiSection {
  title: string;
  query: string;
}

/**
 * Cross-visit anti-repeat memory for AI-designed home shelves (v3.7.1).
 *
 * Without this, the server's varietySeed alone let the taste snapshot dominate
 * the prompt — consecutive Home builds landed on the same top-of-mind shelves
 * ("Trending in Telugu", "A.R. Rahman deep cuts", …). We remember the last N
 * shelves the client actually rendered and hand them to the server as an
 * avoidShelves list; the server both prompts the model against them AND
 * structurally filters them from the response.
 */
const SHOWN_KEY = 'vinax.home.shown.v1';
const SHOWN_CAP = 30;

interface StoredShelf {
  title: string;
  query: string;
  at: number;
}

function loadShown(): StoredShelf[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SHOWN_KEY) || '[]') as unknown;
    return Array.isArray(raw)
      ? (raw as StoredShelf[])
          .filter(
            (s) => s && typeof (s as StoredShelf).title === 'string' && typeof (s as StoredShelf).query === 'string',
          )
          .slice(0, SHOWN_CAP)
      : [];
  } catch {
    return [];
  }
}

/** Merge newly-shown shelves in (newest first), dedupe by title, cap at SHOWN_CAP. */
export function recordShown(sections: AiSection[]): void {
  if (!sections.length) return;
  try {
    const now = Date.now();
    const merged: StoredShelf[] = [
      ...sections.map((s) => ({ title: s.title, query: s.query, at: now })),
      ...loadShown(),
    ];
    const seen = new Set<string>();
    const dedup: StoredShelf[] = [];
    for (const s of merged) {
      const k = s.title.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      dedup.push(s);
    }
    window.localStorage.setItem(SHOWN_KEY, JSON.stringify(dedup.slice(0, SHOWN_CAP)));
  } catch {
    /* ignore */
  }
}

/** Ask the AI for personalized home sections. Returns [] on any failure or when
 *  the AI isn't configured, so Home falls back to its normal shelves. */
export async function getAiHomeSections(context: Record<string, unknown>): Promise<AiSection[]> {
  let res: Response;
  const avoidShelves = loadShown().map((s) => ({ title: s.title, query: s.query }));
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vinax-client': isNativePlatform() ? 'app' : 'web' },
      body: JSON.stringify({ context, avoidShelves }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = (await res.json().catch(() => null)) as { sections?: AiSection[] } | null;
  const sections = Array.isArray(data?.sections)
    ? data.sections.filter((s) => s && typeof s.title === 'string' && typeof s.query === 'string').slice(0, 6)
    : [];
  // Record what the listener will actually see so the NEXT build steers around it.
  if (sections.length) recordShown(sections);
  return sections;
}
