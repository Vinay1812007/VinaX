<div align="center">

# 🎵 VinaX

### Music tuned to you — free, no login, private by design.

**[▶ Open VinaX](https://www.sirimillavinay.online/)** · **[📱 Android APK](https://www.sirimillavinay.online/download)** · **[🤖 VinaX AI](https://www.sirimillavinay.online/VinaXAI)**

**Release Version: VinaX V1**

![version](https://img.shields.io/badge/release-VinaX%20V1-22d3ee)
![status](https://img.shields.io/badge/status-production-22c55e)
![platform](https://img.shields.io/badge/web%20·%20android%20·%20tv-121212)
![login](https://img.shields.io/badge/accounts-none-22d3ee)
![privacy](https://img.shields.io/badge/personalization-on--device-a78bfa)

</div>

---

## The idea

A music player for Indian and international music in 12+ languages that treats listeners
like adults: **no account, no tracking, no ads, no paywall — ever**. The taste profile,
history and favorites live on the device and never leave it. Personalization is computed
locally; AI features receive only a short, capped, anonymous taste summary.

## What it does

🎧 **Player** — gesture controls, synced karaoke lyrics (romanized + translated + AI
"Meaning"), offline downloads, drive mode, sleep timer, wake-up alarm, lock-screen
controls, and *living color*: the whole app tints itself from the playing artwork.

🤖 **VinaX AI — the VinaX V1 engine family** — a full chat with all seven engines
selectable, each with its own strength and its own signature answer style:
**VinaX FLASH** (everyday chat · the default), **VinaX 20B** (fastest answers),
**VinaX SUPER** (deepest reasoning · the Think engine), **VinaX INSTANT**
(music knowledge · answers in a blink), **VinaX 120B** (the big creative engine that
also runs the AI DJ), **VinaX ULTRA** (the most powerful all-rounder) and
**VinaX NANO 3** (light and quick · loves finding songs — it also works
behind the Search page as a personalized music expert). Live web search, files and images, Think/Research modes, and
hands-free voice chat that works on the web and in the Android app — replying out loud in a
natural studio voice — with every reply wearing a chip naming the engine that actually answered. Ask
"play ⟨song⟩" and the reply is a live mini-player with lyrics singing along. Behind the
app, the same seven lanes drive the AI DJ, AI playlists and the home-screen curator —
with cross-lane failover so one bad engine never takes a feature down. When the AI is
slow the app says "Instant picks" instead of pretending.

🎚 **Tune this queue** — twelve one-tap intents (melody, beats, devotional, heartbreak,
classics, fresh, language switches, surprise) that reshape what plays next, with
on-device scoring as a fallback so tuning works even if the AI doesn't.

👥 **Listen Together** — room-code sessions, everyone at the same second (~1s sync),
live shared queue with credits, host controls, "End for all".

⌨️ **Power tools** — Ctrl/⌘+K command palette (jump anywhere, fire player actions, play
songs as you type), a real right-click menu on every song, and keyboard-first playback.

🔔 **Notifications** — opt-in web push: at most one AI-picked song a day plus rare owner
announcements; the Android app shows them on open. A bell on Home is the notification
center.

📊 **Your VinaX** — on-device stats: plays, hours, top artists, language mix, 🔥 streaks.
Computed here, never uploaded, sharable by choice.

📱 **Everywhere** — installable PWA, auto-updating Android shell APK, TV with D-pad
navigation, capability-based UI (touch/mouse/TV detected by hardware).

## Engineering highlights

- **Stack:** React 19 + TypeScript + Vite 8 (Rolldown) · Tailwind token system ·
  Zustand + TanStack Query · Cloudflare Pages (static frontend) + a Cloudflare Worker backend (60+ edge modules, `worker/`) · Supabase ·
  Capacitor 8 · self-hosted Manrope variable font.
- **Seven AI lanes** (the VinaX V1 engine family: FLASH · 20B · SUPER · INSTANT ·
  120B · ULTRA · NANO 3) with cross-lane failover and per-lane observability — every
  lane has its own key and pinned engine (env names documented in `.env.example`), and
  the admin AI Lab can bench each one live. All lanes share DJ-grade taste conditioning
  from a bounded on-device snapshot.
- **Resilient voice:** live voice chat and mic dictation detect a dead browser speech
  service and fail over to on-device speech recognition (installing the model on first
  use), with honest on-screen errors instead of silent hangs.
- **Quality surface:** a junk-track filter keeps dialogues/BGM/jukebox strips out of
  every AI surface; shelf diversity caps identical covers; design-system auto-tests lock
  brand tokens, theme switching and WCAG contrast into CI.
- **Rendering:** 28 prerendered routes + edge-rendered entity pages (real titles, OG,
  JSON-LD at the CDN) + client SPA player. Live sitemap index.
- **Delivery hardening:** assets can never fall back to HTML, URL-epoch cache lever,
  CSP-hashed boot self-healing, conservative service worker, owner-controlled
  Live/Maintenance switch.
- **Gates on every push:** eslint (0 warnings) → tsc → full vitest suite → build +
  prerender → 155 KB gz first-load budget → Lighthouse → signed APK build.

## Owner console

`/admin` on a separate subdomain, token-gated: 18 dashboards — real-time listening,
growth chart, search & engagement analytics, world map, user management with audited
deletes, AI-lane health, an AI Lab test bench for all seven engines, sent-notification log
with retract, full admin audit trail, content-control blocklist (takedowns propagate in
minutes), weekly This-Week digest, push composer with song/album picker,
Live/Maintenance switch, and a ⌘K palette. Light and dark themes, both properly legible.

## Repository map

```
src/                the app (43 pages, stores, typed services, design tokens)
functions/          edge: AI lanes · rooms · push · admin · cron · sitemaps
public/admin/       owner console (vanilla, token-gated)
supabase/schema.sql full idempotent DB schema
scripts/            prerender · bundle budget · android patch
docs/               design system · QA script · release audits · runbooks
```

## Run it

```bash
npm install && npm run dev     # dev server on :5173 — zero secrets needed
npm test                       # vitest
npm run build                  # typecheck + build + prerender 28 routes
```

Deploy: push to `main` — CI gates, then Cloudflare Pages ships web + admin, and the APK
workflow builds a signed Android release. Every server secret is documented in
`.env.example` (Cloudflare → Pages → Environment variables); none are needed locally.

## The two promises

1. **Free and login-free, always.** No accounts, no paywalls, no ads, no feature-gating.
2. **Private by design.** On-device personalization, opt-in aggregate-only analytics,
   IPs never stored, no cookies, no third-party trackers. Export or erase everything:
   Settings → Your Data.

---

<div align="center">Made with ❤️ for listeners who just want to press play.</div>
