import { create } from 'zustand';

/**
 * 9.1.0 — where an evidence-backed recommendation came from, per song, so the
 * app can SHOW it and let the listener open it.
 *
 * Two kinds of thing land here, and they are deliberately kept apart:
 *
 *   chart   a confidently matched entry of a public chart or an editorial pick
 *           (/api/trends). `label` is the owner-configured source name.
 *   web     a song a current web page named, resolved to this recording
 *           (/api/discover). `url` is the page itself.
 *
 * Nothing else may be put here. A catalogue search for popular-sounding words is
 * not evidence, and a song with no row here is simply shown without a source
 * line — never with a guessed one.
 *
 * In memory only: it is a view of the current snapshot, re-filled whenever the
 * signal refreshes, and there is nothing to migrate or persist.
 */
export type EvidenceKind = 'chart' | 'web';

export interface SongEvidence {
  kind: EvidenceKind;
  /** What to show: "Public video chart", "Charting at #3", "A new release". */
  label: string;
  /** A page the listener can open. https only; null when the source gave none. */
  url: string | null;
  /** When the evidence was observed (ISO), when known. */
  observedAt: string | null;
  /** A chart or coverage period the source stated, when it stated one. */
  period: string | null;
}

interface EvidenceState {
  /** Catalogue song id → its evidence. */
  bySong: Record<string, SongEvidence>;
  /** Replace the rows for one kind, leaving the other kind alone. */
  setEvidence(kind: EvidenceKind, rows: Array<[string, SongEvidence]>): void;
  clear(): void;
}

export const useEvidenceStore = create<EvidenceState>((set) => ({
  bySong: {},
  setEvidence: (kind, rows) =>
    set((state) => {
      // Drop this kind's previous rows so a song that has left the chart stops
      // claiming it is on one, then add what the new snapshot says.
      const next: Record<string, SongEvidence> = {};
      for (const [id, e] of Object.entries(state.bySong)) if (e.kind !== kind) next[id] = e;
      for (const [id, e] of rows) if (id && e.label) next[id] = e;
      return { bySong: next };
    }),
  clear: () => set({ bySong: {} }),
}));

/** The evidence for one song, or null. Safe to call during render. */
export function evidenceFor(songId: string): SongEvidence | null {
  return useEvidenceStore.getState().bySong[songId] ?? null;
}

/**
 * One line a listener can read, with the freshness stated when it is known.
 * Deliberately plain: it never says "trending" unless a chart is behind it.
 */
export function evidenceLine(e: SongEvidence, now = Date.now()): string {
  const observed = e.observedAt ? Date.parse(e.observedAt) : NaN;
  const age = Number.isFinite(observed) ? now - observed : NaN;
  const when = !Number.isFinite(age)
    ? ''
    : age < 3_600_000
      ? ' · checked within the hour'
      : age < 86_400_000
        ? ` · checked ${Math.floor(age / 3_600_000)} h ago`
        : ` · checked ${Math.floor(age / 86_400_000)} d ago`;
  const period = e.period ? ` · ${e.period}` : '';
  return `${e.label}${period}${when}`;
}
