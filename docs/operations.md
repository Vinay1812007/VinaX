# VinaX Operations — SLOs, Chaos, and the Image-CDN Decision

Closing notes for audit §6 (production readiness). Everything here is either
implemented and referenced, or a decision explicitly left to the owner with a
recommendation.

## Service-Level Objectives

Two SLOs are computed live on the admin **Technical Monitoring → Data quality**
panel (endpoint: `/api/admin/dataquality`), each over the newest 5,000 AI
events:

| SLO | Target | Meaning |
| --- | --- | --- |
| AI success | **98%** | AI calls that completed (`ok=true`). Allows a 2% error budget for provider blips the failover ladder can't absorb. |
| AI content delivery | **99%** | AI calls that produced actual content (not `empty`). Empty streams are rescued by the ladder, so sustained burn here means multiple lanes degrading at once. |

**Error budget burned** = observed failure ÷ allowed failure. Under 60% is
green, 60–100% amber, over 100% means the SLO is breached for the window —
check the AI Lab **Lane health** table (per-lane p50/p95/p99, hops, ⚠
auth/quota badges) to find which lane is bleeding.

Availability of the site itself is watched by the **synthetic uptime**
workflow (every 30 min, 3-attempt retry, one deduped GitHub issue per real
outage). Its implicit SLO: no more than one missed probe cycle — the issue IS
the alert. No further tooling needed at this traffic scale.

## Chaos testing

`src/__tests__/chaos-failover.test.ts` drives the **real** `/api/vinaxai`
handler with sabotaged upstreams on every CI run: healthy stream, network-dead
primary, degraded key (400), empty stream (200 with no content), total outage
(honest `engine_unreachable`), and a B3 model-initiated search with all search
providers down. Six scenarios, client-visible assertions only.

Known scope limit: the 18s/10s timeout leashes are not exercised (they need
wall-clock or brittle fake-timer streaming); network-throw covers the same
catch path. If a real incident ever implicates the leashes specifically, add a
single integration run with real timers behind a manual workflow_dispatch.

## Image CDN — recommendation, not implementation

The audit suggested an "image-CDN transform layer." Assessment:

- Artwork is served straight from the catalog CDN with **pre-sized variants**
  (50/150/500px), picked responsively via `bestImage` + `srcset`, and cached
  client-side (400-image cap). The common quality/size win of an image CDN is
  therefore already largely captured.
- The `/img` proxy exists solely for canvas CORS (share cards) — it is not a
  transform layer and shouldn't quietly become one (every proxied image adds
  edge egress on your Cloudflare bill).
- A true transform layer means **Cloudflare Image Resizing/Transformations —
  a paid zone feature and a billing decision**, not a code change. Turning it
  on without measurement would be spend without evidence.

**Recommendation: don't build it now.** Revisit only if Lighthouse LCP on
song/album pages regresses below the CI threshold with artwork as the culprit
— that run is already in CI and will say so. If that day comes, enable
Cloudflare Image Transformations on the zone and rewrite `bestImage` URLs
through `/cdn-cgi/image/` — a ~20-line change best made when the bill has a
justification attached.
