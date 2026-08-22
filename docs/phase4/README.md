# Phase 4 — Discovery & Personalization

| Plan item | Status | Evidence |
|---|---|---|
| On-device signal model | ✅ pre-existing | taste profile (plays/skips/completes, language & artist affinities, recency); bounded snapshot for AI |
| Recommendation engine | ✅ pre-existing | content-based (related-tracks + language/artist affinity) + AI curation + 40/35/25 era blend + anti-repeat |
| Moods & mixes | ✅ pre-existing | mood stations, weekly mix, made-for-you, freshness seed per visit |
| Charts pipeline | ✅ **documented** | `charts-pipeline.md` |
| Tunability | ✅ pre-existing (+v16.79 rotation fix) | tune chips, language pinning/muting, intensity |
| **Transparency** | ✅ **shipped this phase** | current track shows the DJ's reason in the player; Up Next chip honestly labels "AI DJ" vs "Instant picks" when the 12s AI deadline falls back |
| Search | ✅ pre-existing | typo-tolerant, language-weighted, infinite |

**Privacy guardrail check:** no new off-device signals were introduced; labels and reasons
render from data already on the device. ✅

**Exit:** Made-For-You, Moods, Discover and Charts run on the recommendation + documented
charts systems; search works; users can tune and now *see why* — all without an account. ✅
