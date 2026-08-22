# Charts & Trending Pipeline

**Sources.** Upstream catalog search + browse modules (trending / top / new-release queries
per language), re-ranked client-side toward the listener's pinned languages.

**Refresh cadence.** TanStack Query staleTime governs in-session freshness (minutes);
each visit re-queries; the Home builder AI re-themes sections per visit via freshnessSeed.
Crawler-facing freshness: sitemap children regenerate daily (edge cache 24h) and the
sitemap index advertises today's lastmod on every fetch.

**Per-language charts.** `/charts` + the 12 language hubs derive from language-scoped
trending queries; JSON-LD ItemList is emitted per hub (top 20).

**No server-side chart computation** exists (by design — no user data pooling). If true
play-count charts are ever wanted, they must come from the opt-in anonymous telemetry
aggregate and be documented in the privacy baseline first.
