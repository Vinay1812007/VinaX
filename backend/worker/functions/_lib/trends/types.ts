/**
 * The raw-item vocabulary of the catalogue matcher (matcher.ts).
 *
 * The trend pipeline that fetched, stored and served these items is gone (the
 * 14.0 schema keeps no trend tables). What stays is the pure matching step: given an item as a source wrote it, find the one catalogue recording
 * it names, or none.
 */

/** One item exactly as a source reported it, before any catalogue matching. */
export interface RawTrendItem {
  /** Provider id (`editorial`, …). */
  source: string;
  /** The SOURCE's own id for the item (a video id, an editorial row id). Never a catalogue id. */
  sourceItemId: string;
  /** Evidence link a person can open to check the claim. */
  sourceUrl: string | null;
  /** The item's title as the source wrote it. */
  title: string;
  /** Uploader / credit line as the source wrote it (channel title, editorial artist). */
  credit: string | null;
  region: string;
  /** 1-based position in the source's list. */
  sourceRank: number;
  /** When the source said this (ISO). */
  observedAt: string;
  /** Language signals the source carried (declared audio language, title script…). Evidence, not a verdict. */
  languageEvidence: Record<string, string>;
  /** Counts the source returned, exactly as returned. Never compared across sources. */
  statistics: Record<string, number> | null;
  /** Where the item came from: endpoint, parameters, the policy that governs storing it. */
  provenance: Record<string, unknown>;
  /** Editorial only: the catalogue id the editor named. Still verified before it is trusted. */
  catalogIdHint?: string | null;
  /** Editorial only: the artist the editor named. */
  artistHint?: string | null;
  /** Editorial only: when the pin stops being shown. */
  expiresAt?: string | null;
}
