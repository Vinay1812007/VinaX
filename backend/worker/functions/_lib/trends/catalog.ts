/**
 * Catalogue lookups for the matcher, recommendations, AI search and the DJ.
 *
 * VinaX has no music provider: the self-hosted JioSaavn catalogue (/api/cat)
 * and every community wrapper were removed. Each lookup throws
 * CatalogUnavailable, which every caller already answers as
 * `catalogue_unavailable` (or a retry on a later run). Plug a new source in
 * here and those callers work again unchanged.
 */
import type { CatalogCandidate } from './matcher';

export class CatalogUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogUnavailable';
  }
}

const NO_CATALOG = 'no music catalogue is configured';

/** Song search. Throws CatalogUnavailable: there is no catalogue. */
export async function searchCatalogSongs(_query: string, _limit = 10, _page = 1): Promise<CatalogCandidate[]> {
  throw new CatalogUnavailable(NO_CATALOG);
}

/** One song by catalogue id. Throws CatalogUnavailable: there is no catalogue. */
export async function lookupCatalogSong(_id: string): Promise<CatalogCandidate | null> {
  throw new CatalogUnavailable(NO_CATALOG);
}

/** "Similar songs" for one song id. Throws CatalogUnavailable: there is no catalogue. */
export async function catalogSongSuggestions(_id: string): Promise<CatalogCandidate[]> {
  throw new CatalogUnavailable(NO_CATALOG);
}
