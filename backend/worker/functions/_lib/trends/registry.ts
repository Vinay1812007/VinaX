/**
 * Every trend provider, in display order: public charts, then editorial, then
 * the web source.
 * Adding a provider means adding an adapter here — nothing else in the
 * pipeline is provider-specific.
 */
import { editorialProvider } from './editorial';
import { shortVideoProvider } from './shortVideo';
import type { TrendProvider } from './types';
import { videoChartProvider } from './videoChart';
import { webSignalProvider } from './webSignal';

// 8.3.1 — the web source runs and reads LAST: the job matches editorial
// entries before it spends catalogue calls on web mentions (it may take at
// most a third of a run's budget, webSignal.ts `maxMatchShare`), and in a
// limited list an owner's editorial pick is never pushed out by web items.
// Its items only ever reach listeners after the owner accepts them.
export const PROVIDERS: readonly TrendProvider[] = [videoChartProvider, shortVideoProvider, editorialProvider, webSignalProvider];

export function providerById(id: string): TrendProvider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Operational thresholds, documented in docs/trends.md. */
export const TRENDS_POLICY = {
  /** A source whose last successful run is older than this is labelled `stale`. The job runs every 6 hours. */
  staleAfterHours: 18,
  /** Stored observations and unrefreshed matches are deleted after this many days (the video platform allows at most 30). */
  retentionDays: 28,
  /** Run records and long-expired editorial rows are deleted after this many days. */
  operationalRetentionDays: 90,
  /** Momentum compares the current snapshot with the newest snapshot of the same source/region/chart observed this long before it… */
  momentumMinWindowHours: 6,
  /** …but no longer than this. */
  momentumMaxWindowHours: 48,
  /** Catalogue calls the matcher may spend in one run, across all items. */
  matchBudgetPerRun: 20,
} as const;
