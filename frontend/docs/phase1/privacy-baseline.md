# Privacy & Compliance Baseline — hard requirements

## 1. Data inventory (everything the client touches)

**On-device only (localStorage, 18 keys):** taste profile (artist/language affinities,
recent song ids), play history (≤150 entries), favorites, saved collections, queue, settings
(languages, theme, intensity, consent flags), device id (random UUID, rooms only), user
first name (optional, local greeting), VinaX AI chat history, onboarding/tour flags.

**Leaves the device — anonymous, purpose-bound:**
- AI requests (DJ/home/playlist/assistant/VinaX AI): bounded, human-readable taste snapshot
  (languages, top artists/songs, recency, time-of-day) — no ids, no name, capped lengths.
- Telemetry (only with explicit consent toggle): web-vitals, error reports, aggregate play
  counters — coarse country from CF edge header; **IP never stored**.
- Listen Together: room code, display name, device UUID, playback state — deleted on
  session end; heartbeats expire in 12 s.
- No cookies. No third-party trackers. Cloudflare Insights beacon is currently **blocked by
  our own CSP** (script-src) — decision: keep blocked or remove the injection in Phase 5.

## 2. Server-side stores (Supabase)

`vinax_rooms`/`vinax_room_members` (ephemeral, code-keyed), `vinax_events` (anonymous
telemetry + AI observability with `@lane` tags), feedback/blocklist tables. No user table
exists anywhere. Admin dashboard is token-gated (`ADMIN_TOKEN`).

## 3. Hard requirements (every phase must hold these)

1. **No accounts, ever** — no signup, login, OAuth, or mandatory identity of any kind.
2. **Personalization is computed and stored on-device** — recommendation signals never
   leave the device except as the bounded anonymous snapshot above.
3. **No third-party trackers/ads/fingerprinting**; first-party analytics remain opt-in,
   aggregate-only, IP-free.
4. **Export & erase** stay one tap away (Settings → Your Data) and must keep working.
5. **Any new off-device signal** requires: anonymity, opt-in, documentation in this file —
   BEFORE it ships.
6. **AI prompts must never include** device ids, names, or raw history dumps — only the
   capped snapshot format defined in `src/services/ai/taste.ts`.
7. **Free stays free** — no paywalls, no feature-gating behind data collection.

## 4. Compliance posture

DMCA/contact routes live; terms state third-party catalog sourcing; privacy page reflects
the inventory above (re-verify wording in Phase 3 trust-pages pass). GDPR/DPDP stance:
no personal data processed server-side beyond ephemeral room display names → no consent
banner required; telemetry consent is still explicit in onboarding.
