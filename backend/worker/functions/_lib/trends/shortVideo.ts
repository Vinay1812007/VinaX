/**
 * The short-video / photo platform's trending audio. Adapter id `instagram`.
 *
 * HONESTLY DISABLED. What the platform documents (checked 2026-09-19, cited
 * in docs/trends.md): its only listing that returns "trending audio" is the
 * Audio API inside Content Publishing (`GET /ig_audio`, trending when no
 * search query is given). That endpoint exists to attach audio to a short
 * video the account is publishing. It needs a business or creator account
 * with a connected page, the platform's business login and the
 * content-publishing permission, and
 * its response carries no rank, no count and no region. Reading it as a
 * popularity chart for a separate music app is not a use we could verify as
 * permitted, and no licensed partner feed of trending audio was found.
 *
 * So this adapter never fetches. It exists so the owner console and the
 * public read can say, truthfully, why this source is absent. Admin-curated
 * editorial imports (editorial.ts) are the supported way to feature a song
 * that is popular there, with an evidence link a person can check.
 */
import { TrendFetchError, type TrendProvider } from './types';

export const SHORT_VIDEO_DISABLED_REASON =
  'No verified API or licensed feed exposes this platform’s trending audio for use by a music app. Its audio listing is part of content publishing (it needs a business account, publishing permission and app review, and returns no rank, count or region). Use an editorial import with an evidence link instead.';

export const shortVideoProvider: TrendProvider = {
  id: 'instagram',
  kind: 'public-chart',
  chart: 'trending-audio',
  snapshotPolicy: 'hourly',
  displayHours: 24,
  label() {
    return 'Short-video audio';
  },
  status() {
    return 'disabled';
  },
  statusReason() {
    return SHORT_VIDEO_DISABLED_REASON;
  },
  maxUnitsPerRun() {
    return 0;
  },
  dailyUnitBudget() {
    return null;
  },
  derivedMetricsAllowed() {
    return false;
  },
  async fetch() {
    throw new TrendFetchError('disabled', SHORT_VIDEO_DISABLED_REASON, { retryable: false });
  },
};
