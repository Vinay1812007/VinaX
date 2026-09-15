# QA Matrix — core flows × platforms

Run before declaring a release week "green". ✅ = verified this cycle.

## Platforms
- Chrome desktop (macOS/Windows) · Safari desktop · Firefox desktop
- Android Chrome (phone) · Android WebView (APK) · iOS Safari (phone)
- Android TV browser (D-pad)

## Core flows (each platform)
1. Cold load → Home renders < 3 s, no error boundary, no stuck splash.
2. Search → play a song → full player → seek/pause/next → lock-screen controls
   (metadata, ±10 s, next/prev).
3. Synced lyrics: open, karaoke fill tracks, immersive mode, close.
4. Queue: selected album or playlist tracks remain in order; Play next, reorder and
   remove controls work, and playback stops at the end unless repeat is enabled.
5. VinaX AI: send prompt (streaming caret → clean render), engine switch, web search,
   voice mode (orb states), chat title in tab.
6. Listen Together: host + guest phone via invite link — audio starts on tap, ~1 s sync,
   guest adds a song (appears with credit), host ends → guest notified.
7. Downloads (Android APK), offline route, PWA install (web).
8. Theme: dark/light/AMOLED switch; living color changes with artwork.
9. Trust: privacy/terms/dmca/contact render, export + erase work.

## Known platform caveats
- iOS Safari: no Web Speech recognition in some versions → voice chat hides.
- Android WebView: Media Session via native plugin (not navigator.mediaSession).
- Firefox: no speculation-rules prefetch (progressive enhancement).
