/** Per-version highlights — shown once after each update. Keep newest first. */

export interface ChangeEntry {
  type: 'new' | 'improved' | 'fixed';
  text: string;
}

export interface VersionInfo {
  title?: string;
  changes: ChangeEntry[];
}

/** Structured changelog for v2.0.0+; older versions use plain string arrays. */
export const CHANGELOG_V2: Record<string, VersionInfo> = {
  '5.5.2': {
    title: 'Downloads, one tap away',
    changes: [
      {
        type: 'new',
        text: 'The Android app now has a Downloads tab right in the bottom bar — your saved songs are one tap away, no digging through the Library.',
      },
      {
        type: 'new',
        text: 'Open the app with no internet and it now lands straight on your Downloads — the screen that actually works offline — instead of an empty Home.',
      },
    ],
  },
  '5.5.1': {
    title: 'Downloads that play offline. Every time.',
    changes: [
      {
        type: 'fixed',
        text: 'Downloaded songs now truly play with no internet \u2014 100%. Saved audio is kept inside the app\u2019s own storage and served directly by the app with full seeking, instead of relying on an Android file link that could silently fail. Existing downloads are upgraded automatically the first time you open the app.',
      },
    ],
  },
  '5.5.0': {
    title: 'A smarter queue that never repeats, and 13 AI engines',
    changes: [
      {
        type: 'new',
        text: 'The Next Song algorithm, AI DJ and Home were rebuilt on VinaX Flow: songs are gathered from four corners of the catalog, locked to your language, cleaned of duplicate copies (the same song under different uploads now counts as ONE song), and sequenced like a live DJ set \u2014 no artist twice in a row, a fresh shuffle every round, and one shared memory so Home and the queue stop repeating each other.',
      },
      {
        type: 'new',
        text: 'VinaX AI now has 13 selectable engines \u2014 including AUTO, which reads each question and picks the best engine for it, plus PRO for deep analysis, M3, K3, TRANSLATE for 12+ languages, and GLIMMER for visual-creative ideas. Every engine was live-tested before joining.',
      },
      {
        type: 'improved',
        text: 'Even when an AI engine has a slow minute, your queue never breaks and never repeats: the app builds a valid, varied continuation on its own and the AI only fine-tunes the order when it answers in time.',
      },
      {
        type: 'improved',
        text: 'Translation got honest: the seat now runs on an engine that actually handles Telugu properly, verified live.',
      },
    ],
  },
  '5.4.0': {
    title: 'Downloads work fully offline, and a new AI brain',
    changes: [
      {
        type: 'fixed',
        text: 'Offline downloads finally work like they should: the app now saves everything it needs while you are online, so with no internet Downloads opens instantly and your saved songs play. The flashing screen when tapping the offline downloads link is gone. Open the app online once after updating and you are set.',
      },
      {
        type: 'fixed',
        text: 'The AI DJ was quietly failing and falling back to the same list every time. Its engines now answer fastest-first, made-up picks like (2024 Remix) are cleaned to the real songs, every suggestion must match the song it names before it enters your queue, and even on a bad engine minute you still get a fresh shuffle of real songs from your library — never a repeat, never junk.',
      },
      {
        type: 'new',
        text: 'A new multi-model AI engine under the hood — a dedicated real-time DJ engine, an upgraded Think engine, plus translation, safety and taste models, every one live-tested before it went in, with automatic fallbacks so one slow engine never takes a feature down.',
      },
      {
        type: 'improved',
        text: 'The AI DJ digs through a wider musical neighborhood each round — blending the current song\'s orbit with one of your recent favourites — so back-to-back sessions genuinely differ.',
      },
    ],
  },
  '5.3.0': {
    title: 'Festivals come alive, the AI reads the room',
    changes: [
      {
        type: 'new',
        text: 'Every festival look was redesigned from scratch — all 23 now feel real and different: diyas and sparkles rise on Diwali, colours rain on Holi, petals drift for Onam, snow falls at Christmas, each with its own colours and glow. It all appears and disappears on its own.',
      },
      {
        type: 'new',
        text: 'The AI got much more personal. The AI DJ, next-song picks and your Home now read the moment — the hour, the day of the week (Saturday night leans party, workday midday stays steady), your live energy (skip a few and it changes direction to lift you), and the festival being celebrated, with a festive shelf on Home during one.',
      },
      {
        type: 'new',
        text: 'New Help guides — “Make the app yours” walks you tap-by-tap through themes, accents, the glass dials and your Home layout, and the FAQ now explains the festival looks and the smarter picks.',
      },
      {
        type: 'fixed',
        text: 'The Glass effect and Background blur sliders now actually work on phones — an old battery optimisation was silently ignoring them. The phone range stays battery-friendly: zero still costs nothing.',
      },
      {
        type: 'fixed',
        text: 'Settings reads properly on small screens — wide controls like the accent colours and sliders now sit below their label instead of squeezing the text into one word per line, and the last accent dot is no longer cut off.',
      },
      {
        type: 'fixed',
        text: 'Claiming a username is airtight now — a name that is already taken can no longer be grabbed by a second person.',
      },
    ],
  },
  '5.2.0': {
    title: 'A big one — festivals, faster home, calmer notifications',
    changes: [
      {
        type: 'fixed',
        text: 'Songs play again everywhere. The stream resolver was handing out signed links that started getting refused, so tracks skipped — streaming now resolves directly with no expiring token in the way, and offline downloads on Android are more reliable too.',
      },
      {
        type: 'new',
        text: 'No ads anywhere, ever — website, Android app and Kid mode alike. No ad cookies, no ad networks, nothing about your listening shared with anyone.',
      },
      {
        type: 'new',
        text: 'Every Indian festival now dresses up the whole app automatically — Sankranti, Holi, Eid, Onam, Ganesh Chaturthi, Dussehra, Diwali, Christmas, New Year and more. The theme arrives the day before and bows out the day after, on its own.',
      },
      {
        type: 'new',
        text: 'Moving to a new phone is part of sign-up now: “Move from old device” beams your taste, favourites and history across with one encrypted QR, before you play a single song.',
      },
      {
        type: 'new',
        text: 'Android: a quick-play home-screen widget — one tap starts your Aura Mix without opening the app first.',
      },
      {
        type: 'improved',
        text: 'Notifications got calmer and smarter: never between 11pm and 8am your local time, and never more than one a day — so a good song reaches you at a good moment, not at 3am.',
      },
      {
        type: 'improved',
        text: 'Home feels smoother — a single, snappier pull-to-refresh (no more double spinner), consistent page-entrance animations across Home, Discover, Charts and Library, and gentler artwork motion throughout.',
      },
    ],
  },
  '5.1.0': {
    title: 'Playback restored, ads gone for good',
    changes: [
      {
        type: 'fixed',
        text: 'Songs play again everywhere. The stream resolver was handing out signed CDN links that started answering "Access Denied", so every track skipped — streams now resolve directly on VinaX servers with no expiring token in the path.',
      },
      {
        type: 'new',
        text: 'No ads anywhere, ever. The last ad slots have been removed from the website — VinaX is now completely ad-free on web, Android, and Kid mode alike, with no ad cookies and no ad networks.',
      },
      {
        type: 'new',
        text: 'Moving to a new phone is now part of sign-up: the welcome screen offers "Move from old device" (encrypted QR handoff) alongside file import, so your taste, favorites and history come across before you play a single song.',
      },
      {
        type: 'improved',
        text: 'Pull-to-refresh on Home is smoother and single-spinnered, offline downloads on Android are more reliable, and the admin dashboard got a round of fixes across User Management, the world map, and double-click behavior.',
      },
    ],
  },
  '5.0.0': {
    title: 'Song delivery goes first-party',
    changes: [
      {
        type: 'new',
        text: 'VinaX now serves songs from its own first-party catalog API (sirimillavinay.online) as the primary source. Search, playback, and the daily song push no longer depend on community-run wrappers being up.',
      },
      {
        type: 'improved',
        text: 'The community wrappers (saavn.sumit.co, nepotuneapi) remain as automatic fallbacks only — if the first-party API is ever unreachable, songs keep flowing without you noticing.',
      },
      {
        type: 'fixed',
        text: 'Removed the dead saavn.dev endpoint (DNS no longer resolves) and the b4a.run mirror from every remaining call site, including the daily song-push cron and the Admin push composer. No more silent failures or wasted requests on endpoints that can never answer.',
      },
    ],
  },
  '3.9.2': {
    title: 'Living glass everywhere',
    changes: [
      {
        type: 'new',
        text: 'The Admin console picks up six new sections: Song Management, Playlist Management, Home Screen Management, Categories & Genres, Banner & Promotion, and App Configuration. Sidebar reorganised into six labeled groups with a live search filter across all sections. KPI cards get inline icons + trend chips; sparklines carry gradient underlays and hover tooltips.',
      },
      {
        type: 'improved',
        text: 'Light mode now feels alive. Every glass surface — cards, sidebar, navbar, mini-player, modals — carries a soft wash of the currently-playing artwork\'s color, matching what dark mode already does. When nothing is playing the tint falls back to a tasteful neutral. Contrast stays at WCAG AA everywhere.',
      },
      {
        type: 'improved',
        text: 'The welcome tour now uses real icons instead of emoji, names all seven VinaX AI engines (FLASH, 20B, SUPER, INSTANT, 120B, ULTRA, NANO 3), teaches the ⌘K / Ctrl+K command palette with an inline illustration, includes a Back button, and shows a step counter. Every claim in the tour is now true about the current product.',
      },
      {
        type: 'fixed',
        text: 'Release APK signing hardened. Previous state: `git tag v*` produced a debug-signed APK using a keystore committed publicly in the repo — anyone who cloned the repo could produce update-compatible builds and impersonate an OTA update. Now: release workflow requires ANDROID_KEYSTORE_BASE64 and produces a real signed release. Every third-party GitHub Action is pinned by SHA, cron workflows retry + open an issue on failure, CI Node version aligned to 22.',
      },
    ],
  },
  '3.9.0': {
    title: 'Home, refreshed',
    changes: [
      {
        type: 'new',
        text: 'Pull down on Home to refresh — every shelf re-fetches from source, gives you a fresh set of picks. Works on Android, iOS Safari, and any browser with touch input.',
      },
      {
        type: 'new',
        text: 'A lot more Home shelves. Most Listened, On Repeat, Repeat Rewind (older favourites you\'re playing again), Because You Listened To, Fresh Finds, Hidden Gems, Trending Near You, Trending Artists and Trending Albums. A rotating grid of six mood picks that changes daily. A small chip row of genre and language collections. A seasonal shelf that swaps itself in when it makes sense (Monsoon Melodies, Weekend Party, festival specials).',
      },
      {
        type: 'improved',
        text: 'The play button on every album/song card is smaller and less obtrusive on touch. Instead of a big accent-filled chip covering the artwork, you get a small frosted circle in the corner with a soft bottom scrim. On desktop, hovering the card grows the chip and fills it with the accent — the pattern Spotify and Apple Music use.',
      },
      {
        type: 'improved',
        text: 'The mini-player pulses briefly when the song changes, and shows a subtle shimmer over the artwork while buffering — so you always know the app hasn\'t frozen. The desktop player carries a very faint tint from the current artwork\'s living colour, so the chrome feels alive with the music.',
      },
      {
        type: 'improved',
        text: 'The bottom nav dock now has a springy bloom when you change tabs, and the VinaX AI tab breathes gently to remind you it\'s there. The desktop sidebar has hairline dividers between groups, sharper active-state accents, and a small footer strip with the release name and the "no account · private" promise.',
      },
      {
        type: 'improved',
        text: 'The design-system stylesheet went from 2,364 lines of five stacked design eras fighting each other to 1,438 lines of one single-source-of-truth "Living Glass" system. No user-visible change in most places — but every future theme tweak now touches one place instead of five, and load times shaved a fraction of a second.',
      },
      {
        type: 'fixed',
        text: 'The "What\'s New" sheet now actually fires after every real update. The previous check compared against a version number that hadn\'t been bumped in a dozen builds, so the sheet was never armed. It now watches the top changelog entry itself — new entry, new sheet, always.',
      },
      {
        type: 'fixed',
        text: 'A cluster of edge-case race conditions in the audio engine, Google Cast handoff, media-session actions and Listen Together sync — plus a full-repo security pass on the server side (rate limits, signed device IDs, admin-panel XSS hardening). Nothing visible on the surface; the app just fails less often at the seams.',
      },
      {
        type: 'new',
        text: 'Three new user guides under docs/user-guide/: replay-and-resume, import-export-your-data, keyboard-shortcuts.',
      },
    ],
  },
  '3.8.0': {
    title: 'A calmer, quieter VinaX',
    changes: [
      {
        type: 'improved',
        text: 'The whole app has been redesigned. Surfaces now sit on solid ink instead of frosted glass, edges are hairline sharp, colour is used only where it matters — the primary indigo accent leads, everything else gets out of the way. Same VinaX, just quieter and easier on the eyes.',
      },
      {
        type: 'improved',
        text: 'Typography is tighter, buttons read as buttons and cards read as cards. Every corner in the app now lands on one of three consistent radii, and shadows show up only where depth is doing real work — dropdowns, sheets, the floating player.',
      },
      {
        type: 'improved',
        text: 'Contrast improved across dark and light modes. Primary text now clears WCAG AAA on both canvases and the primary CTA passes AAA too.',
      },
      {
        type: 'fixed',
        text: 'A cluster of hardcoded purple and cyan hover glows left over from earlier redesigns is gone; the whole app now flows through one design-token layer, so future theme tweaks touch one place instead of ten.',
      },
      {
        type: 'fixed',
        text: 'The "What’s New" sheet now shows up correctly for every update. A legacy check quietly hid it for early adopters whose stored version marker was empty — every update since had been invisible to those listeners.',
      },
    ],
  },
  '3.7.0': {
    title: 'Engines, retuned',
    changes: [
      {
        type: 'improved',
        text: 'Every AI feature now runs on its best-fit engine. We re-checked the health and speed of each engine behind the scenes and matched every feature — everyday chat, quick answers, the AI DJ, your personalized Home, music search and voice — to the fastest, most reliable one for the job. One engine that had started stalling was retired, so replies, playlists and home shelves come back quicker and more dependably across the board.',
      },
      {
        type: 'improved',
        text: 'Everyday chat and the AI DJ feel snappier. The engines powering them were switched to faster, healthier ones, so answers begin sooner and the DJ builds your mix without the occasional long pause.',
      },
    ],
  },
  '3.6.0': {
    title: 'Fresh every time',
    changes: [
      {
        type: 'improved',
        text: 'Home, the AI DJ and your auto-play queue stay fresh. Open Home again, start a new mix, or let a song roll into the next — each one now deliberately mixes up the artists, eras and picks instead of serving the same shelves and the same next songs every time. Even the instant backup shelves rotate, so nothing feels on repeat.',
      },
      {
        type: 'fixed',
        text: 'Search now types exactly what you type. The box is fully yours while you type — your first few letters always land, and the text never jumps, snaps back or gets rewritten as results load. Results still update as you go; nothing is searched or opened until you press Enter or tap a result, just like you would expect.',
      },
      {
        type: 'improved',
        text: 'Your auto-play queue no longer loops the same handful of songs — recently played tracks are skipped so the music keeps moving forward.',
      },
    ],
  },
  '3.5.1': {
    title: 'A home that always loads',
    changes: [
      {
        type: 'fixed',
        text: 'Your personalized Home now builds reliably every time. The shelf builder was switched to a faster, healthier engine and given a smart backup: if it is ever busy or slow, VinaX instantly falls back to a fresh, on-language set of shelves — trending, new releases, classics and picks in your languages — so Home fills with music right away instead of coming up empty.',
      },
      {
        type: 'improved',
        text: 'Home opens noticeably quicker. Building your shelves used to occasionally stall for twenty seconds or more; now it finishes in a few, and it never leaves the page blank while it works.',
      },
    ],
  },
  '3.5.0': {
    title: 'Found everywhere',
    changes: [
      {
        type: 'new',
        text: 'Three new ways in — Top Songs, Trending and Most Searched. Quick, always-fresh pages for the biggest tracks right now, what’s climbing this week, and what everyone else is looking for, with easy jumps into every language.',
      },
      {
        type: 'improved',
        text: 'VinaX is much easier to find on the web. The site map that guides search engines now refreshes itself every half hour, so new songs, albums and pages get discovered fast — no waiting on a nightly rebuild.',
      },
      {
        type: 'fixed',
        text: 'Everyday chat and your personalized Home are snappy and dependable again. The engine behind them was swapped to a fast, healthy one after the previous pick went offline, so replies and home shelves come back quickly instead of stalling.',
      },
    ],
  },
  '3.4.1': {
    title: 'Voice, fixed',
    changes: [
      {
        type: 'fixed',
        text: 'Live voice chat replies almost instantly now. The engine behind spoken answers was moved to a much faster one, so the wait between you finishing a sentence and VinaX talking back drops from several seconds to about half a second — no more sitting in silence wondering if it heard you.',
      },
      {
        type: 'improved',
        text: 'If the fast voice engine is ever busy, VinaX slips through healthy backups — and, if it must, your own device’s voice — so a spoken reply always lands and voice chat never goes quiet on you.',
      },
    ],
  },
  '3.4.0': {
    title: 'A fresh welcome',
    changes: [
      {
        type: 'improved',
        text: 'A warmer first-run tour walks you through VinaX in a few quick, friendly slides — what it is, how to play, and everything VinaX AI can do, voice and all.',
      },
      {
        type: 'improved',
        text: 'The Help, About and Contact pages got a full refresh — clearer answers, current guides for voice, lyrics and shortcuts, and honest, up-to-date wording throughout.',
      },
    ],
  },
  '3.3.3': {
    title: 'Chat, back home',
    changes: [
      {
        type: 'fixed',
        text: 'Everyday chat is back on its own dedicated engine — a thoughtful one that reads your question, thinks it through, then answers cleanly. Replies are dependable and on-topic again instead of leaning on a stand-in.',
      },
      {
        type: 'improved',
        text: 'A quick backup now rides the same lane: if the main engine is ever still thinking when you need an answer, VinaX hands straight to a fast, healthy stand-in so your chat never stalls or comes back blank.',
      },
    ],
  },
  '3.3.2': {
    title: 'Chat, restored',
    changes: [
      {
        type: 'fixed',
        text: 'Everyday chat is quick and dependable again — the engine behind it was swapped to a faster, rock-solid one, so replies start almost instantly and no longer stall or come back blank.',
      },
      {
        type: 'improved',
        text: 'Smarter fallback under the hood: if the main chat engine ever has a wobble, VinaX now slips straight to a healthy backup so your conversation keeps flowing without a hiccup.',
      },
    ],
  },
  '3.3.1': {
    title: 'Never the same twice',
    changes: [
      {
        type: 'fixed',
        text: 'AI Playlist now explores fresh picks every time — ask for the same vibe twice and you’ll get a genuinely different mix, with new artists, eras and deep cuts instead of the same songs again.',
      },
      {
        type: 'improved',
        text: 'It also remembers what your recent playlists already used and deliberately steers away from repeats — unless you ask for a song by name, of course.',
      },
    ],
  },
  '3.3.0': {
    title: 'Voice everywhere, smarter every day',
    changes: [
      {
        type: 'new',
        text: 'Voice chat comes to the Android app — tap the waveform and talk to VinaX AI hands-free, with the same natural voice replying out loud. Voice typing and voice search now work in the app too.',
      },
      {
        type: 'improved',
        text: 'Recommendations learn from you again, day by day — what you played this week now shapes your chats, playlists and expert picks more than last month’s history.',
      },
      {
        type: 'improved',
        text: 'Sharper answers about anything recent: questions that mention this year automatically check the live web, and if a live search ever comes up empty, the AI says so plainly instead of guessing.',
      },
    ],
  },
  '3.2.0': {
    title: 'Production ready',
    changes: [
      {
        type: 'improved',
        text: 'Chat is faster than ever — the everyday engine got a serious upgrade under the hood, so replies now start in a blink instead of keeping you waiting.',
      },
      {
        type: 'fixed',
        text: 'The AI DJ never gets cut off mid-thought — on a slow day it now has the breathing room to finish building your whole queue before handing it over.',
      },
      {
        type: 'improved',
        text: 'A full production pass: every screen, every engine and every feature checked end to end — both themes, desktop and mobile.',
      },
    ],
  },
  '3.1.1': {
    title: 'Lyrics, in step',
    changes: [
      {
        type: 'fixed',
        text: 'Synced lyrics now track the song precisely everywhere — the player’s Lyrics tab, the immersive view, Karaoke, the sidebar strip and the lock screen all follow the same beat, and your saved sync nudge finally applies on every one of them.',
      },
      {
        type: 'improved',
        text: 'Lyrics read beautifully in every theme: the line being sung shines bright and clear, upcoming lines rest softly dimmed, and already-sung lines fade gently back — in dark and light alike.',
      },
    ],
  },
  '3.1.0': {
    title: 'A voice of her own',
    changes: [
      {
        type: 'new',
        text: 'Voice chat now speaks with a natural studio voice — warm, clear and human, arriving sentence by sentence the moment the reply starts.',
      },
      {
        type: 'improved',
        text: 'And it never goes quiet: if the studio voice can’t reach you for a moment, your device’s own voice picks up the very next sentence.',
      },
    ],
  },
  '3.0.4': {
    title: 'A brighter voice',
    changes: [
      {
        type: 'improved',
        text: 'Voice chat sounds warmer and more upbeat — a brighter, bubblier voice greets you the moment it starts talking.',
      },
    ],
  },
  '3.0.3': {
    title: 'Right on time',
    changes: [
      {
        type: 'improved',
        text: 'Every engine now knows today’s date and the time in India — ask “what day is it?”, “what released this week?” or “how far is the next festival?” and the answer starts from the real clock.',
      },
      {
        type: 'improved',
        text: 'Voice chat found a warmer voice — it now picks the nicest female voice your device offers, so replies sound friendlier the moment you say hello.',
      },
    ],
  },
  '3.0.2': {
    title: 'Seven voices',
    changes: [
      {
        type: 'new',
        text: 'All seven engines are now yours to pick in chat — VinaX NANO 3 joins the picker: light, quick, and it genuinely loves finding you songs.',
      },
      {
        type: 'improved',
        text: 'Every engine found its own voice: FLASH answers with precise structure, 20B keeps it warm and brief, SUPER shows how it got there, INSTANT gets straight to the fact, 120B goes big and creative, ULTRA covers every angle, and NANO 3 keeps it light.',
      },
    ],
  },
  '3.0.1': {
    title: 'Better teachers',
    changes: [
      {
        type: 'improved',
        text: 'Every engine went back to school — re-trained with deeper knowledge of the app, so ask anything from “how do I download songs?” to “is VinaX really free?” and you’ll get the right answer.',
      },
    ],
  },
  '3.0.0': {
    title: 'VinaX V1',
    changes: [
      {
        type: 'new',
        text: 'Meet the VinaX V1 engine family — seven fresh engines with simple names: VinaX FLASH for everyday chat, 20B for the fastest answers, SUPER for deep thinking, INSTANT for music knowledge, 120B at the DJ decks, ULTRA behind your home screen and live voice, and NANO 3 working the Search page.',
      },
      {
        type: 'improved',
        text: 'Faster answers everywhere — every engine was re-tuned for its job, so chat, the DJ, playlists, lyrics tools and your smart Home all respond quicker.',
      },
      {
        type: 'improved',
        text: 'A cleaner look: the engine chip on every reply slimmed down, and the version you see is now simply “VinaX V1” — no build-number noise.',
      },
    ],
  },
  '2.7.4': {
    title: 'Expert, focused',
    changes: [
      {
        type: 'improved',
        text: 'The Search page music expert got its quickest engine back — now taught to skip the mumbling and get straight to the songs, so every pick lands in about a second.',
      },
    ],
  },
  '2.7.3': {
    title: 'Scholar, supercharged',
    changes: [
      {
        type: 'improved',
        text: 'VinaX GURU — the music-knowledge engine — moved to a much faster home: artist facts, lyric meanings and translations now answer in a blink instead of a long think.',
      },
    ],
  },
  '2.7.2': {
    title: 'Sharper voices',
    changes: [
      {
        type: 'improved',
        text: 'Your main chat companion moved to a faster engine — replies start sooner and feel just as thoughtful.',
      },
      {
        type: 'improved',
        text: 'The Search page music expert also got a quicker engine, with a fresh backup on standby — song picks now land in a blink.',
      },
      {
        type: 'fixed',
        text: 'Retired two engines that were having a bad week upstream, so nothing waits on them before you get an answer.',
      },
    ],
  },
  '2.7.1': {
    title: 'Steady hands',
    changes: [
      {
        type: 'improved',
        text: 'Smarter engine failover: each AI feature now keeps its own trusted backup engine on standby, so a bad day upstream is covered in the same style — and the main engine takes back over the moment it recovers.',
      },
      {
        type: 'improved',
        text: 'Patience where it earns its keep: engines that think slowly but answer reliably now get the extra seconds they need instead of being cut off mid-thought.',
      },
      {
        type: 'improved',
        text: 'The owner console now shows engine health at a glance — a small dot on every engine goes green, amber or red after each check, with the time it was last checked.',
      },
    ],
  },
  '2.7.0': {
    title: 'Fresh engines',
    changes: [
      {
        type: 'improved',
        text: 'Every AI feature got a new engine tuned to its job — chat, quick answers, deep thinking, music knowledge, the DJ and the home screen each now run on the engine that suits them best.',
      },
      {
        type: 'new',
        text: 'Search gained a music expert: tap “Ask AI for songs” on the Search page, describe a mood, a memory or a half-remembered line, and get real, playable picks in your languages.',
      },
      {
        type: 'improved',
        text: 'The deep-thinking engine keeps its working notes to itself — you always get the polished answer, never the scratchpad.',
      },
      {
        type: 'improved',
        text: 'When an engine has a bad day, your chat now quietly hops across up to four healthy ones — you still get an answer, and the reply chip shows who stepped in.',
      },
    ],
  },
  '2.6.0': {
    title: 'Production ready',
    changes: [
      {
        type: 'improved',
        text: 'VinaX GURU and VinaX MAX now recover cleanly when their engine is slow: the reply comes from a healthy sibling within seconds instead of stalling for half a minute or crashing the chat.',
      },
      {
        type: 'improved',
        text: 'Every shared link, page title and search-engine card now uses the same address — one clean home for VinaX across the web, no duplicate corners.',
      },
      {
        type: 'improved',
        text: 'A full integrity pass touched security headers, admin gates, docs and the whole set of AI engines — and locked it all with new tests so it stays that way.',
      },
    ],
  },
  '2.5.2': {
    title: 'Voice, actually working',
    changes: [
      {
        type: 'fixed',
        text: 'Live voice chat now really replies. The engine that powers voice sometimes returned an empty answer — the server now retries a healthy sibling automatically, so the reply always arrives and is spoken aloud.',
      },
      {
        type: 'fixed',
        text: 'Speaking picks a real installed voice for your language now, instead of leaving it up to the browser’s default (which was silent on some devices).',
      },
      {
        type: 'improved',
        text: 'If the browser refuses to speak the reply at all — a rare but real fault — voice mode says so plainly and points you to text mode, instead of listening in silence.',
      },
    ],
  },
  '2.5.1': {
    title: 'Voice, instantly',
    changes: [
      {
        type: 'fixed',
        text: 'Live voice chat now opens the moment you tap — recognition starts inside the same click, the waveform rides your real microphone, and the mic prompt happens once (not in two rounds).',
      },
      {
        type: 'fixed',
        text: 'Mic dictation gets the same treatment: instant start, and if the browser’s speech service goes quiet for eight seconds it now says so on screen instead of listening forever in silence.',
      },
      {
        type: 'improved',
        text: 'On browsers without a working speech service the buttons speak plainly (“Voice input isn’t supported in this browser”) rather than pretending a fallback that never arrives.',
      },
    ],
  },
  '2.5.0': {
    title: 'Six voices, one stage',
    changes: [
      {
        type: 'new',
        text: 'All six engines are now yours to pick in VinaX AI: VinaX MMX, MSM, MAX, GURU — and two new seats, VinaX WIN (the big creative wildcard) and VinaX NOVA (the balanced all-rounder behind live voice).',
      },
      {
        type: 'new',
        text: 'Replies got the product treatment — tinted code blocks with copy and download, richer markdown everywhere, and a small chip on every answer naming the engine that actually wrote it.',
      },
      {
        type: 'fixed',
        text: 'Voice found its voice: live voice chat and mic dictation now detect a dead browser speech service and switch to on-device recognition (a one-time download), the waveform rides the real microphone, and mic problems say so on screen instead of listening forever in silence.',
      },
      {
        type: 'improved',
        text: 'The owner console’s light theme grew up — readable sidebar, clearly-enabled quick actions, slim rounded chart bars and tidy empty states.',
      },
      {
        type: 'improved',
        text: 'Docs got a spring clean: refreshed README, Help answers for the six engines and voice chat, an updated welcome tour, and a privacy note for on-device speech.',
      },
    ],
  },
  '2.4.0': {
    title: 'Power tools',
    changes: [
      {
        type: 'new',
        text: 'Right-click grew up — a proper VinaX menu on desktop: play, play next, queue, favorite and copy-link on any song; back, search, theme and refresh everywhere else. (Shift+right-click keeps the browser menu.)',
      },
      {
        type: 'new',
        text: 'Press Ctrl/⌘+K anywhere — a command palette that jumps to any page, fires player actions (shuffle, repeat, surprise me…), and finds + plays songs as you type.',
      },
      {
        type: 'new',
        text: 'VinaX AI gained Think and Research buttons — Think routes your question to the deepest engine and answers with a tidy reasoning summary; Research searches the live web and cross-checks multiple sources.',
      },
      {
        type: 'improved',
        text: 'The engines now wear their proper VinaX names everywhere: VinaX MMX, VinaX MSM, VinaX MAX and VinaX GURU in the picker — with VinaX WIN at the DJ decks and VinaX NOVA building your home screen.',
      },
      {
        type: 'improved',
        text: 'Light mode stopped squinting at you — a gently deeper canvas, clearer glass and softer highlights. Same readability, less glare.',
      },
      {
        type: 'fixed',
        text: 'Scrolling behaves everywhere: the owner console keeps its menu in place while each section scrolls on its own, timestamps read correctly again, and showy 3D card tilts were retired across the app.',
      },
    ],
  },
  '2.3.1': {
    title: 'Owner tools',
    changes: [
      {
        type: 'new',
        text: 'The owner console gained an AI Lab — a test bench for all six AI engines: chat with each one directly, watch replies stream in with live latency readouts, and health-check all six in one tap.',
      },
    ],
  },
  '2.3.0': {
    title: 'New brains',
    changes: [
      { type: 'new', text: 'Every AI feature — chat, AI DJ, playlists, your smart Home and voice chat — now answers from a fresh set of engines. Same friendly faces, sharper minds.' },
      { type: 'improved', text: 'The engine picker is a tidy four: Muse (recommended for music), Swift, Sage and Scholar. Two retired engines took a bow.' },
      { type: 'improved', text: 'If one engine has a bad day, another quietly covers its shift — answers keep coming.' },
    ],
  },
  '2.2.0': {
    title: 'Tougher under the hood',
    changes: [
      { type: 'fixed', text: 'When songs fail to load, the player now stops politely after a few tries instead of skipping forever — and a corrupted saved queue can no longer freeze the app.' },
      { type: 'improved', text: 'AI DJ, playlists and your smart Home answer faster on bad days, and bow out gracefully instead of hanging.' },
      { type: 'improved', text: 'Sturdier everywhere: safer saved data, a lighter AI chat page, and cleaner top-search chips.' },
    ],
  },
  '2.1.1': {
    title: 'Quality sweep',
    changes: [
      { type: 'fixed', text: 'The full-screen player now fills the whole window, closes with the Escape key, and its progress bar starts clean at zero.' },
      { type: 'improved', text: 'Search shows friendly letter placeholders for artists without photos, top searches skip junk fragments, and lyrics read clearly in light mode.' },
      { type: 'fixed', text: 'Cleaner links for sharing and discovery, hover-to-favorite on Discover, and matching focus outlines everywhere.' },
    ],
  },
  '2.1.0': {
    title: 'A cleaner, faster look',
    changes: [
      { type: 'new', text: 'The whole app went flat and artwork-first \u2014 no more boxes around every song. Covers lead, titles follow, and a quiet surface appears only when you hover.' },
      { type: 'improved', text: 'Light mode now works everywhere \u2014 including VinaX AI \u2014 and every page shares one heading style.' },
      { type: 'improved', text: 'The six AI engines got friendly names: Muse, Flash, Atlas, Swift, Sage and Scholar.' },
      { type: 'fixed', text: 'Theme picker showed \u201cSystem\u201d twice \u2014 the black theme now has its own name. Plus dozens of small copy and polish fixes.' },
    ],
  },
  '1.9.1': {
    title: 'White liquid',
    changes: [
      { type: 'improved', text: 'Light mode joined the liquid era \u2014 coral, powder-blue and lilac light now drifts across a clean white canvas and glows softly through every frosted card.' },
    ],
  },
  '1.9.0': {
    title: 'The voice returns',
    changes: [
      { type: 'new', text: 'Live voice chat is back in VinaX AI (browsers only) \u2014 powered by a new 550B-parameter engine. Tap the mic: it listens, thinks and talks back, with the waveform orb, tap-to-interrupt and live captions.' },
      { type: 'new', text: 'A sixth engine joins the picker \u2014 an experimental text-diffusion engine that drafts answers almost instantly.' },
      { type: 'improved', text: 'Image creation stays off for now \u2014 the new key turned out to be a text model, and we don\u2019t fake features.' },
    ],
  },
  '1.8.1': {
    title: 'Liquid glass',
    changes: [
      { type: 'new', text: 'The backdrop comes alive \u2014 coral, powder-blue and lilac light drifts behind everything, and every card became a true liquid-glass widget: frosted gradient, luminous edges, a slow cinematic zoom on the artwork.' },
      { type: 'improved', text: 'Shelf titles grew to editorial size with a friendly \u203a cue \u2014 the home page reads like a magazine now.' },
    ],
  },
  '1.8.0': {
    title: 'The details you feel',
    changes: [
      { type: 'improved', text: 'Shelves became gallery-grade \u2014 perfectly even card rows, a \u2665 on hover to favorite instantly, and no song can fill a shelf with its reissues anymore.' },
      { type: 'improved', text: 'Light mode gained real depth \u2014 soft cool outlines and shadows now define every card and panel instead of white melting into white.' },
    ],
  },
  '1.7.8': {
    title: 'Honest signals',
    changes: [
      { type: 'improved', text: 'Image creation now tells you clearly when the engine isn\u2019t enabled yet, instead of failing silently.' },
    ],
  },
  '1.7.7': {
    title: 'Alive and varied',
    changes: [
      { type: 'new', text: 'Create images in VinaX AI \u2014 tap the \ud83c\udfa8 palette, describe anything, and the picture appears right in the chat.' },
      { type: 'fixed', text: 'Dead \u201cvideo\u201d catalog entries no longer enter your queues, and the player stops gracefully instead of skip-looping when sources are down.' },
      { type: 'improved', text: 'Fresher every visit \u2014 home shelves rotate deeper into the catalog and the curator deliberately features different artists, films and eras day to day.' },
    ],
  },
  '1.7.6': {
    title: 'Room to breathe',
    changes: [
      { type: 'improved', text: 'Song and album cards grew up \u2014 bigger tiles, full two-line titles (no more cut-off names), and a shelf can never show a wall of identical covers again.' },
      { type: 'improved', text: 'The welcome tour, Terms, Privacy, Copyright and Contact pages were rewritten in plain honest language \u2014 what VinaX is, what stays on your device, and how takedowns reach every client in minutes.' },
    ],
  },
  '1.7.5': {
    title: 'Sharper ears, cleaner cards',
    changes: [
      { type: 'fixed', text: 'Movie dialogues, BGM cuts and jukebox strips no longer sneak into your mixes, home shelves or the AI queue \u2014 music surfaces now carry music only.' },
      { type: 'improved', text: 'Song cards got a clean new layout (title and artist neatly under the artwork), the home builder designs ~10 smarter shelves (artist deep-dives, era throwbacks, film soundtracks), and Tune This Queue gained More melody, More beats, Devotional and Heartbreak.' },
    ],
  },
  '1.7.4': {
    title: 'The manual, rewritten',
    changes: [
      { type: 'improved', text: 'Every tutorial rewritten for today\u2019s VinaX \u2014 18 straight answers in the FAQ, 8 step-by-step guides (AI DJ, chat mini-player, stats, moving devices), a full gesture & shortcut reference, and a truthful onboarding tour.' },
    ],
  },
  '1.7.3': {
    title: 'Quiet fixes',
    changes: [
      { type: 'fixed', text: 'Search no longer snaps your typing back to the previous query, and recent searches only remember what you actually searched \u2014 not every keystroke.' },
      { type: 'fixed', text: 'The notification bell now shows your latest announcements instantly, and the Queue, Charts and Your VinaX pages adapt properly to light mode.' },
    ],
  },
  '1.7.2': {
    title: 'Mission control',
    changes: [
      { type: 'new', text: 'The console levels up: a Content Control tab for takedowns (block/unblock any song, reaches every client in minutes), a new-listeners growth chart, activity-feed filters, one-click quick actions, and a \u2318K command palette that jumps anywhere.' },
    ],
  },
  '1.7.1': {
    title: 'On the record',
    changes: [
      { type: 'new', text: 'The console now keeps receipts \u2014 a sent log for every notification (with a Retract button for announcements) and a full admin audit trail: mode flips, sends, daily picks and deletions, all timestamped.' },
      { type: 'improved', text: 'The design system now guards itself \u2014 automated tests lock the brand colors, glass recipe, theme switching and text contrast into every release.' },
    ],
  },
  '1.7.0': {
    title: 'Faster under the hood',
    changes: [
      { type: 'improved', text: 'The build engine moved to the newest generation (5\u00d7 faster builds, zero known vulnerabilities anywhere in the stack). Nothing changes in your hands \u2014 everything changes in ours.' },
    ],
  },
  '1.6.1': {
    title: 'The canvas, completed',
    changes: [
      { type: 'new', text: 'A notification bell on Home \u2014 today\u2019s pick and recent release notes in one glass sheet. Onboarding opens with \u201cMusic tuned to you\u201d and closes with the promise: no account, no tracking, no ads.' },
      { type: 'improved', text: 'Listen Together shows a live pulse (\u201cLive session \u00b7 You\u2019re hosting\u201d, \u201cEnd for all\u201d), the 404 page got personality (\u201cThis track skipped itself\u201d), and the offline banner tells you exactly what still works.' },
    ],
  },
  '1.6.0': {
    title: 'Straight from the canvas',
    changes: [
      { type: 'new', text: 'Four screens rebuilt to the new design: Queue is now the AI DJ\u2019s home (tune chips, and every upcoming song explains WHY it\u2019s next), Your VinaX stats got the streak card, artist bars and language mix, Charts became a real discovery hub, and Karaoke gained on-screen controls with a Meaning button.' },
    ],
  },
  '1.5.1': {
    title: 'Cyan, everywhere',
    changes: [
      { type: 'improved', text: 'The new identity reached every last corner \u2014 a refreshed app icon, every deep gradient, and all the badges. One color story, no stragglers.' },
    ],
  },
  '1.5.0': {
    title: 'The cyan era',
    changes: [
      { type: 'new', text: 'VinaX wears a new identity \u2014 electric cyan flowing into ocean blue and soft violet, with brighter white-frost glass floating over the glow. Same app, new light.' },
      { type: 'new', text: 'Little equalizer bars now dance beside whatever\u2019s playing in the chat mini-player. The owner console wears the same colors.' },
    ],
  },
  '1.4.0': {
    title: 'A typeface of our own',
    changes: [
      { type: 'new', text: 'VinaX now speaks in Manrope \u2014 a warm, modern typeface served from our own servers (nothing loads from third parties). Buttons bloom softly when pressed, loading screens shimmer, and every control now has proper disabled, loading, success and error states.' },
      { type: 'improved', text: 'The design system is now written down \u2014 tokens, spacing, motion and accessibility rules \u2014 so every future screen stays consistent.' },
    ],
  },
  '1.3.3': {
    title: 'Glass, down to the details',
    changes: [
      { type: 'improved', text: 'Menus joined the glass \u2014 the sidebar\u2019s active page sits in a frosted pill, the mobile dock\u2019s tab pops with a spring, and the theme button\u2019s sun and moon now rotate past each other.' },
      { type: 'improved', text: 'A hundred small touches: home sections rise in one after another, search fields glow when focused, buttons lift and squash, sheets got deeper frost, slimmer scrollbars, and violet text selection \u2014 in both dark and light glass.' },
    ],
  },
  '1.3.2': {
    title: 'Through the glass',
    changes: [
      { type: 'new', text: 'A living glass redesign \u2014 four slow-drifting color blobs breathe behind everything (one tinted by whatever\u2019s playing), panels became deeper frosted glass with luminous edges, cards glow violet in the corner and lift when you hover.' },
      { type: 'improved', text: 'Light mode is now first-class glass \u2014 pastel blobs under white-frost panels \u2014 and switching themes cross-fades smoothly. VinaX AI shares the same living backdrop.' },
    ],
  },
  '1.3.1': {
    title: 'Bring your profile with you',
    changes: [
      { type: 'new', text: 'Already using VinaX on another device? The welcome screen can now import your exported profile (name, languages, favorites, history and taste) — export it from Settings → Your Data on the old device and import the file here.' },
    ],
  },
  '1.3.0': {
    title: 'New engine, same soul',
    changes: [
      { type: 'improved', text: 'VinaX now runs on React 19 \u2014 the newest core \u2014 with the whole quality gate green: faster internals, identical experience. Tooling moved to ESLint 10 alongside.' },
    ],
  },
  '1.2.2': {
    title: 'Tidy corners',
    changes: [
      { type: 'improved', text: 'The admin Activity Feed shows only real listener activity \u2014 system markers stay out of the way. Community top-searches never surface numbers, emails or links.' },
    ],
  },
  '1.2.1': {
    title: 'The big switch',
    changes: [
      { type: 'new', text: 'The console gets a Live / Maintenance switch \u2014 flip the whole site into a friendly \u201cbe right back\u201d screen (with your own message) and back, from the Technical tab. Takes effect within a minute, everywhere.' },
      { type: 'new', text: 'Every Monday the Overview greets you with a This-Week digest \u2014 listeners, new devices, plays, searches, errors, top song and top search.' },
    ],
  },
  '1.2.0': {
    title: 'Production ready',
    changes: [
      { type: 'improved', text: 'A full production audit passed end to end: security sweep (no exposed secrets, every admin endpoint authenticated, zero vulnerable dependencies), safer admin audit logging, and new release self-checks that keep the app, changelog and docs in lock-step.' },
    ],
  },
  '1.1.28': {
    title: 'Snappier, better tested',
    changes: [
      { type: 'improved', text: 'VinaX AI only auto-searches the web for genuinely current questions now, so everyday chats answer faster; the answer formatter also gained a test suite.' },
    ],
  },
  '1.1.27': {
    title: 'Kept promises',
    changes: [
      { type: 'improved', text: 'The daily song suggestion is now truly daily \u2014 one per evening at most, never every few hours. The app shows the same pick when it opens.' },
      { type: 'fixed', text: 'Push notifications now show the proper app icon on Android and Windows.' },
      { type: 'fixed', text: 'Help caught up with the app \u2014 the live mini-player in chat replaced voice chat everywhere in the docs.' },
    ],
  },
  '1.1.26': {
    title: 'Play it right in the chat',
    changes: [
      { type: 'new', text: 'Ask VinaX AI to play a song and the reply IS a player \u2014 artwork, play/pause and skip controls, a seekable progress bar, and the lyrics singing along line by line, live in the chat.' },
      { type: 'improved', text: 'Voice chat has been retired \u2014 the dictation mic in the message bar stays.' },
    ],
  },
  '1.1.25': {
    title: 'Steady voice, steady app',
    changes: [
      { type: 'fixed', text: 'The Android app no longer force-closes \u2014 its browser shell only pretends to support speech recognition, so voice chat now appears only in real browsers where it actually works. The fix reaches installed apps instantly.' },
      { type: 'fixed', text: 'Voice mode on Android phones \u2014 the level meter was holding the microphone and starving the recognizer. Listening is reliable now, and the wave bars dance with your speech activity.' },
    ],
  },
  '1.1.24': {
    title: 'Voice mode, production-grade',
    changes: [
      { type: 'new', text: 'Live sound waves \u2014 real microphone waveform bars dance while you talk, and pulse along while the assistant speaks.' },
      { type: 'fixed', text: 'Voice replies going silent \u2014 speech is now unlocked the moment you tap, stuck speech recovers itself, and one bad sentence can never freeze the conversation.' },
      { type: 'improved', text: 'Interrupting is airtight \u2014 a cancelled reply can\u2019t sneak back in, and the thinking state can never hang.' },
    ],
  },
  '1.1.23': {
    title: 'Voice chat goes live',
    changes: [
      { type: 'new', text: 'Voice chat in VinaX AI is now a real conversation \u2014 a full-screen orb that listens, thinks and speaks, starts talking while the reply is still being written, and reopens the mic by itself.' },
      { type: 'new', text: 'Tap the orb to interrupt mid-sentence, mute the mic anytime, and follow live captions of what you said and what it\u2019s saying.' },
      { type: 'improved', text: 'Speech no longer cuts off on long replies, and the listening loop recovers itself instead of silently dying.' },
    ],
  },
  '1.1.22': {
    title: 'Notifications that actually ask',
    changes: [
      { type: 'new', text: 'Home now asks once whether you want a ping when new music lands \u2014 one tap turns it on. Change your mind anytime in Settings \u2192 Notifications.' },
      { type: 'new', text: 'The Android app now asks for notification permission properly and shows announcements as real notifications when it opens \u2014 tap one to jump straight to the song.' },
      { type: 'improved', text: 'Notifications can now point at a specific song or album \u2014 picked with a built-in search instead of hand-typed links.' },
    ],
  },
  '1.1.21': {
    title: 'What everyone is searching',
    changes: [
      { type: 'new', text: 'The Search page now shows the community\u2019s top searches as tappable chips — one tap and you\u2019re listening to what everyone\u2019s finding.' },
    ],
  },
  '1.1.20': {
    title: 'Numbers with depth',
    changes: [
      { type: 'improved', text: 'Anonymous, opt-in usage signals grew smarter (searches, skips, completions, favorites) so recommendations and the catalog improve where it matters. Nothing identifies you — same privacy promise.' },
    ],
  },
  '1.1.19': {
    title: 'A proper manual',
    changes: [
      { type: 'new', text: 'Help grew into a real guide — step-by-step how-tos, a 16-question FAQ, a keyboard & gesture reference, and a plain-words copyright section. The admin console also dressed up in the app\u2019s look.' },
    ],
  },
  '1.1.18': {
    title: 'Knows your language, pops your lyrics',
    changes: [
      { type: 'new', text: 'VinaX now greets new listeners in their region\u2019s language automatically, and karaoke lines pop into view with a 3D flourish while cards lift in your song\u2019s colours.' },
    ],
  },
  '1.1.17': {
    title: 'Mission control, in 3D',
    changes: [
      { type: 'new', text: 'The admin dashboard gained a dozen tricks — a Live Rooms panel, an always-on pulse strip, sortable tables, one-click day reports, JSON export, fullscreen charts, error alerts, a light theme — all wrapped in tilting, rising 3D animations.' },
    ],
  },
  '1.1.16': {
    title: 'Engines in their right seats',
    changes: [
      { type: 'improved', text: 'The home screen and the music agent traded engines — each now runs where it performs best.' },
    ],
  },
  '1.1.15': {
    title: 'A mighty new music agent',
    changes: [
      { type: 'improved', text: 'The music agent moved to a large new engine with fresh credentials — chat, the assistant and AI playlists all ride on it.' },
    ],
  },
  '1.1.14': {
    title: 'The agent gets its engine',
    changes: [
      { type: 'improved', text: 'The music agent now runs on its intended engine with fresh credentials, with a big open-reasoning engine as the alternative — and if any engine naps, a strong default answers instantly instead.' },
    ],
  },
  '1.1.12': {
    title: 'Every engine answers',
    changes: [
      { type: 'improved', text: 'The music agent now runs on a big, fast engine that responds instantly, and every choice in the engine menu is verified working — no more silent stalls.' },
    ],
  },
  '1.1.11': {
    title: 'New engines, properly awake',
    changes: [
      { type: 'improved', text: 'Two chat engines were replaced with newer, faster ones that actually answer — the alternative engine and the music agent both upgraded.' },
    ],
  },
  '1.1.10': {
    title: 'Real web results',
    changes: [
      { type: 'improved', text: 'VinaX AI web search now pulls real ranked results from major search engines (page titles, snippets and source links) instead of only quick facts — so answers about current events, releases and prices are richer and better sourced. Still free, no API key.' },
    ],
  },
  '1.1.9': {
    title: 'Fresh engines under the hood',
    changes: [
      { type: 'improved', text: 'The alternative chat engine moved to a newer, faster model, and the music agent got fresh credentials — every engine verified working end to end.' },
    ],
  },
  '1.1.8': {
    title: 'No more hanging replies',
    changes: [
      { type: 'fixed', text: 'VinaX AI no longer gets stuck on the typing dots — web search and the model now time out quickly and fail over, so a slow source can never freeze the whole answer.' },
    ],
  },
  '1.1.7': {
    title: 'Sharper VinaX AI',
    changes: [
      { type: 'improved', text: 'VinaX AI now answers with cleaner structure — headings, comparison tables, numbered steps, tidy code blocks and clear citations — and automatically searches the web for time-sensitive questions (latest releases, prices, scores) so the facts are current.' },
    ],
  },
  '1.1.6': {
    title: 'Say play, and it plays',
    changes: [
      { type: 'new', text: 'Tell VinaX AI "play <any song>" — by voice or text — and it finds it and starts playing, with pause, resume, next and previous commands too. Preview any assistant voice with the new ▶ button before making it yours.' },
      { type: 'fixed', text: 'Two flaky engines no longer fail silently — if an engine is unavailable the chat answers via the strong default and notes which engine replied.' },
    ],
  },
  '1.1.5': {
    title: 'VinaX AI 2.0',
    changes: [
      { type: 'new', text: 'The chat grows up: search, rename, pin and date-grouped history; export any chat as text, Markdown or PDF; Regenerate and Continue buttons; double-tap your message to edit and resend; drag files straight into the chat.' },
      { type: 'new', text: 'Chat settings — default engine, text size, export or clear everything. All stored on your device only, as always.' },
    ],
  },
  '1.1.4': {
    title: 'Covers on first load',
    changes: [
      { type: 'fixed', text: 'Album art now shows on the very first visit and on mobile — the service worker no longer intercepts image requests (which was returning errors before covers were cached, so you had to refresh on desktop and never saw them on mobile).' },
    ],
  },
  '1.1.3': {
    title: 'A voice that stays with you',
    changes: [
      { type: 'improved', text: 'VinaX AI now speaks with a female voice and the voice picker lists female voices only.' },
      { type: 'fixed', text: 'Hands-free Voice chat keeps listening between turns instead of dropping out after a silent moment, and waits a beat after speaking so it does not hear itself.' },
    ],
  },
  '1.1.2': {
    title: 'Covers are back',
    changes: [
      { type: 'fixed', text: 'Album and song artwork shows again everywhere. A recent over-eager "degraded provider" filter was discarding valid covers and whole result pages — reverted to the trusted artwork logic.' },
    ],
  },
  '1.1.1': {
    title: 'A face for VinaX',
    changes: [
      { type: 'fixed', text: 'VinaX now ships real PNG app icons and a favicon — the logo shows in browser tabs, search results and when you install the app, instead of a blank globe.' },
    ],
  },
  '1.1.0': {
    title: 'VinaX 1.1',
    changes: [
      { type: 'new', text: 'VinaX AI — a full-screen AI assistant: Fast / Medium / Deep thinking, free keyless web search, photo & file understanding, voice input and hands-free voice chat, with rich answers (runnable code with copy + download, live HTML/SVG previews, Mermaid diagrams, LaTeX math, tables and CSV).' },
      { type: 'fixed', text: 'AI features now work inside the Android app — API calls stay same-origin instead of failing a cross-origin check.' },
      { type: 'improved', text: 'Album art recovers automatically when a catalog mirror returns degraded images, so covers stop falling back to the placeholder.' },
    ],
  },
  '16.96': {
    title: 'Back to the music',
    changes: [
      { type: 'fixed', text: 'After a phone call interrupts your song, VinaX now resumes by itself the moment you return — no hunting for the play button.' },
      { type: 'fixed', text: 'When a music source serves broken artwork, VinaX now switches sources automatically — real covers instead of placeholder waves, on Android too.' },
    ],
  },
  '16.95': {
    title: 'Covers that always show up',
    changes: [
      { type: 'fixed', text: 'Fixed the real cause of blank covers on a first visit: a flaky catalog source was sending empty artwork addresses. VinaX now rejects those and always shows real art or its own placeholder — never a blank box.' },
    ],
  },
  '16.94': {
    title: 'First impressions, fixed',
    changes: [
      { type: 'fixed', text: 'Artwork now appears on the very first visit — no refresh needed. Covers still stay available offline.' },
      { type: 'new', text: 'Pull down at the top of any page on your phone to refresh — a little spinner rides along.' },
    ],
  },
  '16.93': {
    title: 'A voice you choose',
    changes: [
      { type: 'new', text: 'VinaX AI\u2019s spoken replies now use the Ursa voice when your device has it — and a new voice picker next to Voice chat lets you choose any voice you prefer. Your pick is remembered.' },
    ],
  },
  '16.92': {
    title: 'The wrong note fixes itself',
    changes: [
      { type: 'fixed', text: 'If a page ever fails to load its code, VinaX now repairs and reloads by itself instead of showing an error screen that couldn\u2019t recover.' },
    ],
  },
  '16.91': {
    title: 'Self-healing, deeper',
    changes: [
      { type: 'fixed', text: 'Devices that cached a bad app file during last week\u2019s delivery incident now fix themselves automatically on the next visit — no cache clearing needed.' },
    ],
  },
  '16.90': {
    title: 'Lyrics in the corner of your eye',
    changes: [
      { type: 'new', text: 'The desktop Now Playing rail sings along — the current lyric line glows under the song title with the next line ghosted, right above the queue. Tap it for the full view.' },
    ],
  },
  '16.89': {
    title: 'Lyrics, right away',
    changes: [
      { type: 'fixed', text: 'Synced lyrics now appear the moment they\u2019re found — a slow catalog server can no longer hold them hostage for half a minute.' },
    ],
  },
  '16.88': {
    title: 'Liquid glass',
    changes: [
      { type: 'improved', text: 'Light mode is now real glass — transparent panes with a refractive edge that let the page glow through cards, the dock and the mini-player.' },
    ],
  },
  '16.87': {
    title: 'Production ready',
    changes: [
      { type: 'new', text: 'Your library now browses offline with artwork — covers are kept on-device (capped, oldest out first).' },
      { type: 'improved', text: 'The Movies page can sort Fresh or A\u2013Z by film name, and some internal spring cleaning made the app a little lighter.' },
    ],
  },
  '16.86': {
    title: 'Belt, braces, and a runbook',
    changes: [
      { type: 'fixed', text: 'Two safety nets that were silently switched off are now live: the boot self-repair (retries if an update loads mid-deploy) and link prefetching for instant page hops.' },
    ],
  },
  '16.85': {
    title: 'It tells you why',
    changes: [
      { type: 'new', text: 'The player now shows why the DJ chose the song you\u2019re hearing, and the Up Next badge is honest about its source — "AI DJ" when the AI curated it, "Instant picks" when it answered from your taste in a blink.' },
    ],
  },
  '16.84': {
    title: 'It hears, it glows',
    changes: [
      { type: 'new', text: 'Voice chat in VinaX AI now has a living orb — it breathes in your song\u2019s colours, ripples while it listens, spins while it thinks and pulses as it speaks.' },
      { type: 'improved', text: 'Long titles now pause to be read before gliding, with soft edges — and the Movies page finally says the film\u2019s name, not the album mouthful.' },
    ],
  },
  '16.83': {
    title: 'Engine room, certified',
    changes: [
      { type: 'improved', text: 'Lock-screen and headset ±10s seek buttons now work, the player chip names the actual movie (not the full album mouthful), and language hub pages scroll on forever.' },
    ],
  },
  '16.82': {
    title: 'Found in more searches',
    changes: [
      { type: 'improved', text: 'VinaX now publishes a live, self-updating site index — including a fresh film-soundtrack map across 12 languages — so searching a movie or song name finds VinaX pages faster.' },
    ],
  },
  '16.81': {
    title: 'Clean slate delivery',
    changes: [
      { type: 'fixed', text: 'Every app file now ships under fresh addresses, clearing out any stale copies delivery networks were still holding. The "wrong note" screen should be gone everywhere.' },
    ],
  },
  '16.80': {
    title: 'Stronger under the hood',
    changes: [
      { type: 'fixed', text: 'Fixed a rare condition where an app update could leave a page failing to load ("Something hit a wrong note") until caches cleared — it now recovers automatically.' },
    ],
  },
  '16.79': {
    title: 'Tune it again, differently',
    changes: [
      { type: 'fixed', text: '"Tune this queue" now deals fresh songs on every press — it remembers what it already offered and rotates through the pool instead of repeating the same picks.' },
    ],
  },
  '16.78': {
    title: 'Crisper chrome',
    changes: [
      { type: 'fixed', text: 'The home logo bar now stays pinned under a soft glass blur while you scroll, gradient buttons switched to clean white icons and text, and pill buttons no longer wrap onto two lines.' },
    ],
  },
  '16.77': {
    title: 'One assistant, one home',
    changes: [
      { type: 'improved', text: 'Settings is leaner — the assistant card moved out now that VinaX AI lives in the dock.' },
    ],
  },
  '16.76': {
    title: 'A whole new skin',
    changes: [
      { type: 'new', text: 'VinaX reborn: a deeper night canvas, bold editorial headlines, and living color — the app tints itself from the artwork of whatever you play. New floating dock with Home, Discover, Search, Library and VinaX AI, a haloed mini-player, and springy touches everywhere.' },
    ],
  },
  '16.75': {
    title: 'Fits your device, not just your window',
    changes: [
      { type: 'improved', text: 'VinaX now senses what it runs on — touch, mouse or TV — and adapts by capability: play buttons stay visible on any touch screen (tablets too), sliders get bigger touch targets, huge monitors get comfortably larger type, and TVs get big text with a bold focus ring.' },
    ],
  },
  '16.74': {
    title: 'A queue you build together',
    changes: [
      { type: 'new', text: 'Listen Together is now a real group session — everyone sees the live queue and everyone can add songs. Guest picks slide into the host\u2019s queue with "Added by" credit, and the session screen shows what\u2019s playing with artwork.' },
    ],
  },
  '16.73': {
    title: 'Together, actually together',
    changes: [
      { type: 'fixed', text: 'Listen Together now keeps everyone within about a second — sync no longer depends on device clocks, host seeks reach guests instantly, and joining starts playback reliably on phones.' },
      { type: 'fixed', text: 'Ending a session now ends it for everyone — guests are told instead of following a ghost room.' },
    ],
  },
  '16.72': {
    title: 'VinaX AI in your pocket',
    changes: [
      { type: 'new', text: 'VinaX AI now has its own tab in the bottom bar on phones and in the app — and the Search shortcut opens the full chat with web search, images and voice.' },
    ],
  },
  '16.71': {
    title: 'Never a frozen splash',
    changes: [
      { type: 'fixed', text: 'If an update rolls out while the app is loading, VinaX now retries and recovers by itself instead of sitting on the splash screen.' },
    ],
  },
  '16.70': {
    title: 'A tab that knows the topic',
    changes: [
      { type: 'improved', text: 'Open a VinaX AI chat and the browser tab takes its name. The welcome screen now deals four fresh starter ideas every visit — tuned to your pinned language.' },
    ],
  },
  '16.69': {
    title: 'VinaX AI, properly titled',
    changes: [
      { type: 'improved', text: 'The VinaX AI page now has its own browser-tab title and share preview — "VinaX AI — ask anything" instead of the generic site tagline.' },
    ],
  },
  '16.68': {
    title: 'Listen Together, now in your pocket',
    changes: [
      { type: 'new', text: 'Listen Together is now on mobile — open it from the player (the people icon) or the banner at the top of your Library. Invite links join the session automatically with one tap.' },
    ],
  },
  '16.67': {
    title: 'Every AI knows your taste',
    changes: [
      { type: 'improved', text: 'The chat assistant and AI Playlist now read the room like the DJ does — your languages, favourite artists, most-played songs and the time of day shape every recommendation, with the same no-repeat, mood-matching, era-blending rules everywhere.' },
    ],
  },
  '16.66': {
    title: 'Alive while it thinks',
    changes: [
      { type: 'improved', text: 'VinaX AI feels alive — a breathing avatar and typing caret while it answers, bouncing dots while it thinks, and messages that glide in. Answers render flawlessly from first token to last.' },
      { type: 'improved', text: 'Every AI feature moved onto the engine best suited to its job.' },
    ],
  },
  '16.65': {
    title: 'A proper engine menu',
    changes: [
      { type: 'improved', text: 'VinaX AI engines now live in a clean dropdown menu — pick by name, see what each is best at. Answers start cleanly and end tidily, too.' },
    ],
  },
  '16.64': {
    title: 'Pick your engine',
    changes: [
      { type: 'new', text: 'VinaX AI now lets you choose the engine per chat — five engines, from fastest to deepest — right above the composer.' },
      { type: 'improved', text: 'AI Monitoring now shows exactly which engine lane served every request, so routing is provable at a glance.' },
    ],
  },
  '16.63': {
    title: 'Lose yourself in the lyrics',
    changes: [
      { type: 'new', text: 'Tap the lyric line in the player and the whole screen becomes the song — big synced lyrics over the artwork, karaoke fill, and just the controls you need. Tap down to return.' },
    ],
  },
  '16.62': {
    title: 'Black is beautiful',
    changes: [
      { type: 'new', text: 'AMOLED theme — pure black for OLED screens, easy on the eyes and the battery. Settings → Theme.' },
      { type: 'improved', text: 'VinaX AI chats like a true general assistant now — it only talks about the app when you ask. The welcome tour was rewritten around everything new.' },
    ],
  },
  '16.61': {
    title: 'New brains at the decks',
    changes: [
      { type: 'improved', text: 'The AI DJ, playlists, home feed and VinaX AI each run on their own dedicated engine now — faster, and none of them can slow down another.' },
    ],
  },
  '16.60': {
    title: 'Four engines, one machine',
    changes: [
      { type: 'improved', text: 'Each AI now runs on its own dedicated key — VinaX AI, the DJ, the home builder and the tools can never starve each other, and all four back each other up automatically.' },
    ],
  },
  '16.59': {
    title: 'Answers that come alive',
    changes: [
      { type: 'new', text: 'VinaX AI now renders like the best assistants: copy-and-download code blocks, live HTML/SVG previews, Mermaid diagrams (flowcharts, timelines, mind maps), LaTeX math, tables, checklists and downloadable CSV — all detected automatically. Copy any reply with one tap.' },
    ],
  },
  '16.58': {
    title: 'Web search, no setup',
    changes: [
      { type: 'improved', text: 'VinaX AI web search is now free and keyless — it pulls live context from DuckDuckGo and Wikipedia, so the globe toggle just works with no API key to configure.' },
    ],
  },
  '16.57': {
    title: 'VinaX AI, full screen',
    changes: [
      { type: 'new', text: 'A dedicated VinaX AI page (open it from the sidebar) — a full-screen AI chat with Fast / Medium / Deep thinking, live web search, photo & file attachments, voice input and hands-free voice chat. Answers stream as they are written and chats stay on your device.' },
    ],
  },
  '16.56': {
    title: 'Assistant, full screen',
    changes: [
      { type: 'improved', text: 'The VinaX Assistant chat now opens full-screen — more room to read, a centered conversation and the composer pinned to the bottom.' },
    ],
  },
  '16.55': {
    title: 'A proper welcome',
    changes: [
      { type: 'improved', text: 'The first-launch tour now teaches everything — player gestures, karaoke lyrics, the AI DJ, chat assistant, downloads and privacy. Replay it any time from Help.' },
    ],
  },
  '16.54': {
    title: 'An assistant with range',
    changes: [
      { type: 'improved', text: 'The AI chat now answers anything — general questions, writing, translations — while staying the resident VinaX and music expert.' },
      { type: 'improved', text: 'Recommendations blend deliberately across new releases, trending hits and timeless classics, tuned to your history. Light mode surfaces gained crisper definition.' },
    ],
  },
  '16.53': {
    title: 'Stay on your speaker',
    changes: [
      { type: 'fixed', text: 'Switching output devices now sticks — the next song no longer jumps back to the default speaker, and Chrome permission hiccups are handled with a single retry.' },
    ],
  },
  '16.52': {
    title: 'Seven wishes',
    changes: [
      { type: 'fixed', text: 'Android downloads now stream straight to disk (big files no longer fail), and shared links always use sirimillavinay.online — never localhost.' },
      { type: 'new', text: 'Chat with AI from Search — find songs and talk music in a conversation. AI Playlist now thinks much deeper before answering.' },
      { type: 'improved', text: 'The song menu opens over a blurred, dimmed backdrop with a properly readable panel.' },
    ],
  },
  '16.51': {
    title: 'Never kept waiting',
    changes: [
      { type: 'fixed', text: 'The queue never waits on a slow AI — twelve seconds max, then instant local picks take this round while the DJ catches up next time.' },
      { type: 'improved', text: 'The full-screen player now opens straight to Lyrics when a song has them, and the browser bar finally matches light mode.' },
    ],
  },
  '16.50': {
    title: 'Faster DJ, fresher picks',
    changes: [
      { type: 'fixed', text: 'The AI DJ answers much faster (skips the warm-up round when your catalog pool is rich) and repeats are now blocked outright — not just discouraged.' },
      { type: 'fixed', text: 'Karaoke fill now paces itself to the singing, not the silence between lines.' },
      { type: 'new', text: 'Jump back in — a compact grid of your recent listens at the top of Home, and the player backdrop now glows with the album\'s own color.' },
    ],
  },
  '16.49': {
    title: 'Sing along, literally',
    changes: [
      { type: 'new', text: 'Karaoke and synced lyrics now fill the current line with color as the song moves through it — bold, smooth, and everywhere lyrics live: Karaoke, the Lyrics page and the player panel.' },
    ],
  },
  '16.48': {
    title: 'Ten small perfections',
    changes: [
      { type: 'improved', text: 'Player header no longer collides with the right panel on wide screens; the Up Next tab shows its count; the lyric strip steps aside when the Lyrics panel is open.' },
      { type: 'improved', text: 'Toasts and sheets joined the glass system (with a proper drag handle), the active nav tab glows in the accent, and even text selection wears the brand.' },
    ],
  },
  '16.47': {
    title: 'The full-screen stage, act two',
    changes: [
      { type: 'new', text: 'Lyrics now live beside the player on big screens — switch between Up Next and Lyrics right in the full-screen view.' },
      { type: 'new', text: 'Playing a film song? The movie name is now a chip under the title — one tap opens the full soundtrack.' },
      { type: 'improved', text: 'Titles only scroll when they actually overflow (no more doubled text), and the player action row got clean, premium pills.' },
    ],
  },
  '16.46': {
    title: 'Routing around the pothole',
    changes: [
      { type: 'fixed', text: 'One of the AI engines went down upstream — its jobs moved to healthy ones automatically, so nothing waits on a dead endpoint.' },
    ],
  },
  '16.45': {
    title: 'Seen and polished',
    changes: [
      { type: 'fixed', text: 'Home greeted you twice on desktop; the mini-player and AI DJ badge were hard to read in light mode; the empty queue now says what the DJ is doing.' },
    ],
  },
  '16.44': {
    title: 'Back at full power',
    changes: [
      { type: 'fixed', text: 'Fresh AI keys and a rebuilt analytics database — the DJ, playlists, home feed, assistant and admin dashboards are back in business.' },
    ],
  },
  '16.43': {
    title: 'A sharper brain for the feed',
    changes: [
      { type: 'improved', text: 'The home feed and song-push got a major reasoning upgrade, and the AI fallback chain was refreshed for reliability.' },
    ],
  },
  '16.42': {
    title: 'X-ray vision',
    changes: [
      { type: 'new', text: 'Admin Technical Monitoring opens with a live System Health check — every AI key is pinged and the database write freshness shown, so outages display their exact cause.' },
    ],
  },
  '16.41': {
    title: 'One button language',
    changes: [
      { type: 'improved', text: 'Every call-to-action across the app now speaks one premium language — accent pills that glow on hover, press with real depth, and focus visibly, in both themes.' },
    ],
  },
  '16.40': {
    title: 'AI reliability',
    changes: [
      { type: 'fixed', text: 'Reduced how many AI requests each feature makes so the AI DJ, playlists and home stay within the model rate limits and keep working.' },
    ],
  },
  '16.39': {
    title: 'AI that refuses to die',
    changes: [
      { type: 'fixed', text: 'If one AI key runs out of quota, every AI feature now fails over to the backup key automatically — the DJ, playlists, home feed and assistant keep working.' },
    ],
  },
  '16.38': {
    title: 'Mission control',
    changes: [
      { type: 'new', text: 'Admin Technical Monitoring grows up — real-world speed scores (Web Vitals p75 with good/poor split) and a "lyrics not found" leaderboard, powered by the new in-app reporting.' },
      { type: 'improved', text: 'AI Monitoring now tracks the in-app Assistant alongside the DJ, playlists and home feed.' },
    ],
  },
  '16.37': {
    title: 'Ask the app itself',
    changes: [
      { type: 'new', text: 'Meet VinaX Assistant — chat about features, gestures and privacy right from Settings. Answered by AI, nothing you type is stored.' },
      { type: 'fixed', text: 'Light mode gets its glass back — properly frosted, translucent surfaces instead of flat white.' },
    ],
  },
  '16.36': {
    title: 'Lyrics found, search obeys',
    changes: [
      { type: 'fixed', text: 'Lyrics find their way home more often — smarter matching by song length, and film songs now check the catalog copy first.' },
      { type: 'fixed', text: 'Scrolling past search suggestions no longer hijacks what you typed, and fast typing is never overwritten mid-search.' },
      { type: 'new', text: 'Ask AI for songs — right from Search: describe a mood, an era or a memory and get a playlist.' },
      { type: 'improved', text: 'The app now reports its own crashes and unhandled errors (and lyric misses) to Technical Monitoring — anonymously, consent-gated.' },
    ],
  },
  '16.35': {
    title: 'Glass, for real',
    changes: [
      { type: 'new', text: 'The whole app moves to Glass 2.0 — deep charcoal, true frosted surfaces, floating sidebar, dock-style player and a pill nav, with one calm cyan accent.' },
      { type: 'improved', text: 'Quieter backdrop, an imperceptible film grain, larger radii and slower, more deliberate motion — luxury is restraint.' },
    ],
  },
  '16.34': {
    title: 'The wide-screen stage',
    changes: [
      { type: 'new', text: 'On big screens a Now Playing rail sits beside your browsing — artwork, queue and one tap to the full player, like the premium desktop apps.' },
      { type: 'improved', text: 'Card titles now sit on the artwork itself, and Home greets you by name with quick search on desktop.' },
    ],
  },
  '16.33': {
    title: 'Flick to flow',
    changes: [
      { type: 'new', text: 'Flick the artwork up for the next song, down for the previous — the player now flows like a feed.' },
      { type: 'improved', text: 'The AI DJ thinks like a career musician now: tempo neighborhoods, emotional key, singer rotation and a deliberate energy arc — with segue-note reasons.' },
      { type: 'fixed', text: 'The play button loading spinner was nearly invisible in light mode.' },
    ],
  },
  '16.32': {
    title: 'Privacy, front and center',
    changes: [
      { type: 'new', text: 'Settings now opens with what makes VinaX different — Private by design: no login, your taste stays on your device, export or erase it any time.' },
      { type: 'improved', text: 'Empty screens now point you somewhere useful, and TV focus gets a gentle lift as you move around.' },
    ],
  },
  '16.31': {
    title: 'Measured in the wild',
    changes: [
      { type: 'new', text: 'VinaX now measures its real-world speed — the three industry Core Web Vitals — from consenting listeners, visible in Admin → Technical Monitoring.' },
      { type: 'improved', text: 'The Trending shelf on Home now opens the hub page for your language.' },
      { type: 'fixed', text: 'Unknown links now tell search engines not to index the 404 page.' },
    ],
  },
  '16.30': {
    title: 'Trails and guardrails',
    changes: [
      { type: 'new', text: 'Every song, album and artist page now shows search engines its full trail — Home › Telugu Songs › album › song.' },
      { type: 'improved', text: 'Every release is now guarded by the full test suite and a JavaScript size budget in CI, keeping VinaX fast on budget phones.' },
      { type: 'fixed', text: 'The AI-crawler guide (llms.txt) pointed at old www addresses and was missing the new language hubs.' },
    ],
  },
  '16.29': {
    title: 'Lighter, faster',
    changes: [
      { type: 'improved', text: 'Artwork now downloads at the right size for its spot on your screen — faster pages and kinder to your data plan, especially on budget phones.' },
      { type: 'improved', text: 'Likely next pages are quietly prefetched, so moving around VinaX feels instant.' },
    ],
  },
  '16.28': {
    title: 'Language hubs',
    changes: [
      { type: 'new', text: 'Every major language now has its own home — Telugu Songs, Hindi Songs, Tamil Songs and nine more — with trending hits and fresh releases, updated daily.' },
      { type: 'improved', text: 'Hubs cross-link languages, moods, movies and charts, and every song page points back to them — a proper map for you and for search engines.' },
    ],
  },
  '16.27': {
    title: 'Found by search, part 2',
    changes: [
      { type: 'improved', text: 'Artist links shared anywhere now unfurl with art and info, and artist pages render real content for search engines at the edge.' },
      { type: 'improved', text: 'Songs, albums, artists and playlists all agree on one clean link form — and tell search engines exactly how they connect to each other.' },
      { type: 'new', text: 'Charts, Moods, Movies, Languages and About carry structured data, and all schema output is now covered by automated tests.' },
    ],
  },
  '16.26': {
    title: 'Links that speak',
    changes: [
      { type: 'new', text: 'Song, album, artist and playlist links now carry readable names in the URL — friendlier to share, and search engines finally understand them.' },
      { type: 'improved', text: 'Old links keep working and quietly upgrade to the new form when opened.' },
      { type: 'improved', text: 'Every song, album and artist page now describes itself to search engines with rich structured data — groundwork for rich results.' },
    ],
  },
  '16.25': {
    title: 'The Aura mark',
    changes: [
      { type: 'improved', text: 'The VinaX logo now wears Aura — an electric-lime V with an aurora violet-to-cyan soundwave, on the app icon, boot screen, placeholders and avatars.' },
      { type: 'fixed', text: 'Install splash screen now matches the midnight theme instead of flashing gray.' },
    ],
  },
  '16.24': {
    title: 'Search that meets you halfway',
    changes: [
      { type: 'new', text: 'Open Search and the good stuff is already there — mood chips (Romance, Party, Chill…) and a Trending Now list in your languages, before you type a letter.' },
      { type: 'improved', text: 'The search field now glows softly with the Aura accent while you type.' },
    ],
  },
  '16.23': {
    title: 'Now Playing, Aura edition',
    changes: [
      { type: 'improved', text: 'Now Playing glows with your music — a living aura halo, tinted by the album art, breathes behind the artwork while a song plays.' },
      { type: 'improved', text: 'The live lyric line now glows softly, and Up Next shows an AI DJ badge when the queue is being steered for you.' },
      { type: 'new', text: 'On desktop, Now Playing becomes a two-column stage — artwork and controls on the left, queue tuning and Up Next on the right.' },
    ],
  },
  '16.22': {
    title: 'Your Aura Mix',
    changes: [
      { type: 'new', text: 'Home now opens with an Aura Mix hero — one tap and the AI DJ builds a fresh mix from your taste, mood and languages.' },
    ],
  },
  '16.21': {
    title: 'VinaX Aura',
    changes: [
      { type: 'new', text: 'A fresh look: a deep-midnight theme with an electric-lime accent and a subtle aurora glow across the app.' },
    ],
  },
  '16.20': {
    title: 'Cleaner Now Playing',
    changes: [
      { type: 'improved', text: 'The lyric strip on Now Playing now opens the full lyrics page in one tap, and the long inline lyrics panel was removed for a cleaner screen.' },
    ],
  },
  '16.19': {
    title: 'Mood-aware queue',
    changes: [
      { type: 'improved', text: 'The auto-queue now keeps the mood flowing — romantic, energetic, chill, melancholy or devotional — so the vibe stays consistent as it builds.' },
    ],
  },
  '16.18': {
    title: 'What the song means',
    changes: [
      { type: 'new', text: 'Tap ✨ Meaning on the lyrics page for a short AI explanation of what a song is about, its mood and themes.' },
    ],
  },
  '16.17': {
    title: 'Offline awareness',
    changes: [
      { type: 'new', text: 'A subtle banner now lets you know when you go offline, with a quick link to your downloads.' },
    ],
  },
  '16.16': {
    title: 'Tidier home',
    changes: [
      { type: 'improved', text: 'The home screen no longer repeats the same song across different shelves — each pick shows once, in the most relevant shelf.' },
    ],
  },
  '16.15': {
    title: 'Tune this queue',
    changes: [
      { type: 'new', text: 'From Now Playing you can reshape the queue on the fly — more energetic, chill, romantic, classics, new, same/different language, or surprise me — and see why each upcoming song was picked.' },
    ],
  },
  '16.14': {
    title: 'Queue never runs dry',
    changes: [
      { type: 'fixed', text: 'The Up Next queue now always fills with fresh on-language picks, even for brand-new songs the catalog has no related tracks for.' },
    ],
  },
  '16.13': {
    title: 'AI queue + endless home',
    changes: [
      { type: 'improved', text: 'Playing any song now builds a fresh AI queue instead of following a fixed list, the home feed scrolls endlessly with new picks, refreshes for a new home each visit, and never repeats songs.' },
    ],
  },
  '16.12': {
    title: 'Three-model AI engine',
    changes: [
      { type: 'improved', text: 'AI DJ, playlists and home now combine three AI models — two gather a wide pool of ideas and a stronger one curates the best, more personal picks by language, mood and vibe.' },
    ],
  },
  '16.11': {
    title: 'AI DJ grounded in real songs',
    changes: [
      { type: 'fixed', text: 'The AI DJ now builds the queue from real catalog tracks it can actually play, so Up Next fills reliably — especially for regional music.' },
    ],
  },
  '16.10': {
    title: 'AI DJ reliability',
    changes: [
      { type: 'fixed', text: 'The AI DJ now sticks to real, well-known songs so the Up Next queue reliably fills instead of coming up empty.' },
    ],
  },
  '16.9': {
    title: 'Smarter AI DJ',
    changes: [
      { type: 'improved', text: 'The AI DJ now uses a two-stage engine — a fast model gathers a wide pool of candidates and a deeper model curates a smoothly flowing, varied queue that blends new and classic and avoids repeating artists.' },
    ],
  },
  '16.8': {
    title: 'Cleaner app',
    changes: [
      { type: 'improved', text: 'Removed the in-app announcements banner for a tidier experience.' },
    ],
  },
  '16.7': {
    title: 'DJ & broadcast fixes',
    changes: [
      { type: 'fixed', text: 'The AI DJ now reaches its engine reliably on the app and thinks harder about language, mood and a blend of new and classic picks.' },
      { type: 'fixed', text: 'Admin: composing a broadcast no longer gets wiped by the live auto-refresh, and sending a push now reports how many devices received it.' },
    ],
  },
  '16.6': {
    title: 'Faster, steadier AI',
    changes: [
      { type: 'improved', text: 'AI DJ, playlists, lyrics and home now use guided JSON and tighter limits — fewer empty results and quicker replies.' },
    ],
  },
  '16.5': {
    title: 'Language & AI tuning',
    changes: [
      { type: 'fixed', text: 'Your selected languages now properly fill Home, and muted languages are hidden across Home and Search.' },
      { type: 'improved', text: 'The AI DJ runs on the previous engine again, and all AI features fail over faster so you wait less.' },
    ],
  },
  '16.4': {
    title: 'Smoother lyrics',
    changes: [
      { type: 'fixed', text: 'Fixed a rare case where lyrics could keep retrying in the background; lyrics lookups are now cached and rate-limited.' },
    ],
  },
  '16.3': {
    title: 'Push notifications',
    changes: [
      { type: 'new', text: 'Turn on notifications in Settings to get a fresh song pick and announcements delivered to your device.' },
    ],
  },
  '16.2': {
    title: 'Logo on startup',
    changes: [
      { type: 'improved', text: 'The launch screen now shows the official VinaX logo.' },
    ],
  },
  '16.1': {
    title: 'TV remote navigation',
    changes: [
      { type: 'new', text: 'On smart TVs and set-top boxes, you can now navigate the whole app with your remote\u2019s arrow keys, with clear focus highlights.' },
    ],
  },
  '16.0': {
    title: 'A whole new look',
    changes: [
      { type: 'new', text: 'A fresh flat dark theme with a vivid green accent and black navigation. Light mode refreshed to match. Big, clear focus highlights for TV remotes and keyboards.' },
    ],
  },
  '15.4': {
    title: 'Polished link previews',
    changes: [
      { type: 'new', text: 'Shared links now show a branded preview image on social apps and chats.' },
    ],
  },
  '15.3': {
    title: 'Extra polish',
    changes: [
      { type: 'improved', text: 'Inputs respond to hover and interactive cards now have a subtle press, for a more refined, professional feel.' },
    ],
  },
  '15.2': {
    title: 'Bolder, more tactile buttons',
    changes: [
      { type: 'improved', text: 'Buttons across the app now feel stronger and more premium — subtle elevation, a glow on the main actions, hover lift and a satisfying press.' },
    ],
  },
  '15.1': {
    title: 'Casting + sync fixes',
    changes: [
      { type: 'fixed', text: 'Casting now sends the correct audio format, so more songs play on cast devices.' },
      { type: 'fixed', text: 'In Listen Together, guests stay locked to the host instead of drifting onto their own recommendations.' },
    ],
  },
  '15.0': {
    title: 'Better offline playback',
    changes: [
      { type: 'improved', text: 'Playing a download now queues all your downloads in order, so offline listening keeps going without a connection.' },
      { type: 'fixed', text: 'Downloaded songs are saved in their original audio format for more reliable offline playback.' },
    ],
  },
  '14.9': {
    title: 'Listen Together fixes',
    changes: [
      { type: 'fixed', text: 'The listener count is now accurate and leaving a session works reliably (a stable device identity is used per device).' },
    ],
  },
  '14.8': {
    title: 'Endless shuffle',
    changes: [
      { type: 'fixed', text: 'With shuffle on, the player now brings in fresh recommendations instead of looping the same songs once it has played through the queue.' },
    ],
  },
  '14.7': {
    title: 'Polish & accessibility',
    changes: [
      { type: 'improved', text: 'Friendlier in-app message for invalid imports, calmer animations when Reduce Motion is on, and tidier diagnostics.' },
    ],
  },
  '14.6': {
    title: 'No repeats + playlists play in full',
    changes: [
      { type: 'fixed', text: 'The same song no longer appears twice in Up Next.' },
      { type: 'fixed', text: 'Playing a playlist or album now plays the whole list, with the AI DJ taking over only after the last track.' },
    ],
  },
  '14.5': {
    title: 'Rich song pages & sharing',
    changes: [
      { type: 'new', text: 'Songs, artists and albums now have clean shareable links with proper titles, cover-art previews and details — better for sharing and search.' },
      { type: 'new', text: 'Added a Copyright / DMCA page.' },
    ],
  },
  '14.4': {
    title: 'Popular songs on Home',
    changes: [
      { type: 'new', text: 'Added a “Popular” shelf on Home — the most-played songs in your languages, refreshed every time you open Home.' },
    ],
  },
  '14.3': {
    title: 'Queue stays in your language',
    changes: [
      { type: 'fixed', text: 'The Up Next queue now stays strictly in the playing song\u2019s language (or your single pinned language) \u2014 no more stray songs in other languages.' },
    ],
  },
  '14.2': {
    title: 'Lyrics follow the song',
    changes: [
      { type: 'fixed', text: 'The lyrics page now switches to the next song automatically when the track changes (instead of staying on the finished song).' },
    ],
  },
  '14.1': {
    title: 'Fresh home + steadier AI',
    changes: [
      { type: 'improved', text: 'Your Home rebuilds each time you open the Home tab.' },
      { type: 'fixed', text: 'AI DJ, playlists, lyrics and recommendations now reliably produce results (with an automatic fallback) and better match language, mood and vibe.' },
    ],
  },
  '14.0': {
    title: 'AI tuning',
    changes: [
      { type: 'improved', text: 'Re-tuned which AI model powers each part of the app for better recommendations, DJ, playlists, lyrics and home.' },
    ],
  },
  '13.8': {
    title: 'Report broken tracks',
    changes: [
      { type: 'new', text: 'A song’s ⋯ menu now has “Report broken track” so you can flag songs that won’t play or are mislabelled.' },
    ],
  },
  '13.7': {
    title: 'Steadier playback',
    changes: [
      { type: 'improved', text: 'On slow or dropped connections the player now moves on instead of hanging, and tells you when the browser blocks autoplay.' },
    ],
  },
  '13.6': {
    title: 'Accessibility polish',
    changes: [
      { type: 'improved', text: 'Screen readers now announce the current song and play state as it changes.' },
    ],
  },
  '13.5': {
    title: 'Rich previews for albums & artists',
    changes: [
      { type: 'improved', text: 'Album, artist, playlist and song links now show real titles, cover art and details in search results and shared link previews.' },
    ],
  },
  '13.4': {
    title: 'Discoverability & trust',
    changes: [
      { type: 'new', text: 'Added Privacy, Terms and Contact pages.' },
      { type: 'improved', text: 'Search engines now see real page content and titles, with cleaner indexing rules.' },
      { type: 'improved', text: 'Added a keyboard skip-to-content link for accessibility.' },
    ],
  },
  '13.3': {
    title: 'Fresher auto-queue',
    changes: [
      { type: 'fixed', text: 'The auto-queue no longer repeats the same songs — it remembers what it recently suggested and keeps the lineup varied each time.' },
    ],
  },
  '13.2': {
    title: 'Polished settings',
    changes: [
      { type: 'improved', text: 'Redesigned the Settings page with clean grouped sections, section icons, and a tidier layout.' },
    ],
  },
  '13.1': {
    title: 'Tidier settings',
    changes: [
      { type: 'improved', text: 'Removed the accent colour picker — the app now uses its single signature look.' },
    ],
  },
  '13.0': {
    title: 'Refined new design',
    changes: [
      { type: 'new', text: 'A cleaner, more refined look — a vivid red accent, frosted translucent navigation and player, white text on buttons, and a crisp light & dark mode. Every feature is right where you left it.' },
    ],
  },
  '12.0': {
    title: 'A brand-new look',
    changes: [
      { type: 'new', text: 'A completely refreshed design — a warm gold accent on a deep slate canvas, with softly elevated cards and a subtle ambient glow. Light mode refreshed to match. Every feature is right where you left it.' },
    ],
  },
  '11.2': {
    title: 'Drive Mode & Karaoke fixed',
    changes: [
      { type: 'fixed', text: 'Drive Mode and Karaoke now open as true full-screen views instead of being squeezed into the page, so controls and lyrics show correctly.' },
    ],
  },
  '11.1': {
    title: 'Readable text in every mode',
    changes: [
      { type: 'fixed', text: 'Button labels and player controls now keep proper contrast when switching between light and dark modes and accent themes.' },
    ],
  },
  '11.0': {
    title: 'Consistent theme + automatic updates',
    changes: [
      { type: 'improved', text: 'The accent now stays a consistent green everywhere (artwork-based tinting is off by default — re-enable it under Settings → Dynamic theme).' },
      { type: 'new', text: 'Updates now arrive automatically — no reinstalling to get new features.' },
      { type: 'improved', text: 'Settings now only show options relevant to your platform.' },
    ],
  },
  '10.3': {
    title: 'Cleaner search',
    changes: [
      { type: 'fixed', text: 'The search box now shows a clean neutral focus border instead of a coloured glow, and the suggestions list sits on a clearer floating panel.' },
    ],
  },
  '10.2': {
    title: 'Flat backdrop & full-bleed header',
    changes: [
      { type: 'improved', text: 'A calmer flat background and a full-width colour wash behind the home greeting that fades into the page.' },
    ],
  },
  '10.1': {
    title: 'Cleaner navigation & buttons',
    changes: [
      { type: 'improved', text: 'Flatter full-width bottom navigation, and round green play buttons with a crisp black icon.' },
    ],
  },
  '10.0': {
    title: 'A whole new look',
    changes: [
      { type: 'new', text: 'A clean, flat dark theme with a fresh green accent — solid surfaces, crisp type, no frosted glass. Light mode refreshed to match.' },
    ],
  },
  '9.7': {
    title: 'Streak records on your Stats',
    changes: [
      { type: 'improved', text: 'Your listening streak now keeps a personal best, and both current and longest streak show on your Stats page.' },
    ],
  },
  '9.6': {
    title: 'Music Quiz — Guess the Song',
    changes: [
      { type: 'new', text: 'A new game: a song plays and you guess its title from four options. Build a streak; picks come from your recent plays and the charts. Find it in Explore.' },
    ],
  },
  '9.5': {
    title: 'Refined tokens & desktop app CTA',
    changes: [
      { type: 'improved', text: 'Adopted the full design-token scale (radii, shadows, transitions) for a more consistent, premium feel across every surface.' },
      { type: 'new', text: 'Desktop visitors now see a "Get the app" card on Home with a glowing button.' },
    ],
  },
  '9.4': {
    title: 'Animated splash & onboarding',
    changes: [
      { type: 'new', text: 'A music-wave animation now plays on the launch splash, and the welcome screen got a premium gradient title and glowing button.' },
    ],
  },
  '9.3': {
    title: 'Vibrant equalizer',
    changes: [
      { type: 'improved', text: 'The now-playing equalizer bars now pulse in a vibrant gradient — a livelier signal of what is playing.' },
    ],
  },
  '9.2': {
    title: 'Immersive player',
    changes: [
      { type: 'new', text: 'The full-screen player now glows with a soft, blurred version of the album art behind it — a richer, more immersive now-playing experience.' },
    ],
  },
  '9.1': {
    title: 'Glowing controls',
    changes: [
      { type: 'new', text: 'A floating glass bottom bar with a glowing gradient highlight, premium gradient play buttons, and a satisfying heart-pop when you like a song.' },
    ],
  },
  '9.0': {
    title: 'Premium redesign',
    changes: [
      { type: 'new', text: 'A bolder premium look: a deep navy canvas with vibrant red, orange, purple and blue gradient glows behind the frosted glass, and stronger glowing buttons.' },
    ],
  },
  '8.3': {
    title: 'Premium light glass',
    changes: [
      { type: 'improved', text: 'Light mode now has a soft, premium frosted-glass look — warm and cool tones glow through airy translucent panels.' },
    ],
  },
  '8.2': {
    title: 'Strict language Home',
    changes: [
      { type: 'fixed', text: 'Home no longer shows sections in languages you have not selected — every section now strictly matches your chosen languages.' },
    ],
  },
  '8.1': {
    title: 'Liquid Glass in Light mode',
    changes: [
      { type: 'improved', text: 'Light mode now has a true Liquid Glass feel — a soft colourful backdrop glows through more transparent frosted surfaces.' },
    ],
  },
  '8.0': {
    title: 'Liquid Glass redesign',
    changes: [
      { type: 'new', text: 'A brand-new Apple-style Liquid Glass look — frosted translucent panels, a vibrant gradient glowing through, softer shadows and rounder corners, across light and dark.' },
    ],
  },
  '7.1': {
    title: 'Language-locked everywhere',
    changes: [
      { type: 'fixed', text: 'Trending, New Releases, Daily Mix, AI Home and the auto-queue now strictly stay in your selected language(s) — other-language songs are filtered out across the app.' },
    ],
  },
  '7.0': {
    title: 'On-language queues',
    changes: [
      { type: 'fixed', text: 'The auto-queue now stays in the language of the song you are playing (or your selected language) — no more random other-language tracks slipping in.' },
    ],
  },
  '6.9': {
    title: 'Crisper & more polished',
    changes: [
      { type: 'fixed', text: 'Sharper, high-resolution artwork on cards (no more blur).' },
      { type: 'improved', text: 'Smoother, more premium card animations — artwork gently zooms and lifts on hover, with tactile press feedback in both light and dark themes.' },
    ],
  },
  '6.8': {
    title: 'Leaner & cleaner',
    changes: [
      { type: 'improved', text: 'Lighter pages — casting now loads only when you use it, smaller artwork on lists, and fewer background connections. Faster and tidier.' },
    ],
  },
  '6.7': {
    title: 'Sharper personalization',
    changes: [
      { type: 'improved', text: 'Recommendations and your AI Home now anchor on the specific songs you play most and steer clear of artists you keep skipping — noticeably more "you".' },
    ],
  },
  '6.6': {
    title: 'Instant first paint',
    changes: [
      { type: 'improved', text: 'A branded splash now appears instantly on launch while the app loads — faster perceived load, especially on slower mobile connections.' },
    ],
  },
  '6.5': {
    title: 'Snappier loading',
    changes: [
      { type: 'improved', text: 'Faster first load on mobile and a steadier layout while content fills in — lighter visual effects and reserved space for each section.' },
    ],
  },
  '6.4': {
    title: 'Faster & cleaner',
    changes: [
      { type: 'improved', text: 'Performance and security tuning: the app loads faster (especially on mobile), with stronger security headers and richer metadata.' },
    ],
  },
  '6.3': {
    title: 'Fresh Home every visit',
    changes: [
      { type: 'improved', text: 'Your AI-personalized Home now refreshes each time you open or reload the app (and as the day, your taste or languages change) — new sections every visit.' },
    ],
  },
  '6.2': {
    title: 'Faster AI',
    changes: [
      { type: 'fixed', text: 'The AI engine now responds much faster and reliably returns results instead of occasionally coming back empty.' },
    ],
  },
  '6.1': {
    title: 'Fresher & language-aware',
    changes: [
      { type: 'fixed', text: 'Recommendations now dig deeper for genuinely different songs instead of repeating the same hits, and your Preferred Languages now update Home, Trending, New Releases and the weekly mix everywhere.' },
    ],
  },
  '6.0': {
    title: 'Dual AI engines',
    changes: [
      { type: 'improved', text: 'The app now uses the best-suited AI engine for each feature — sharper recommendations and a smarter, more personal Home.' },
    ],
  },
  '5.9': {
    title: 'AI-personalized Home',
    changes: [
      { type: 'new', text: 'Your Home is now arranged by AI — personalized sections with their own titles (by your artists, languages, moods and the time of day) that change through the day.' },
    ],
  },
  '5.8': {
    title: 'New Releases & Trending',
    changes: [
      { type: 'new', text: 'Home now has “Trending Now” and “New Releases” rows in your languages, so the latest and hottest songs are always one tap away.' },
    ],
  },
  '5.7': {
    title: 'Multi-language',
    changes: [
      { type: 'new', text: 'Choose your app language — English, తెలుగు, हिन्दी or தமிழ் — in Settings. Navigation and key screens now follow your choice.' },
    ],
  },
  '5.6': {
    title: 'Connect to a device',
    changes: [
      { type: 'new', text: 'New “Connect to a device” option in the full-screen player — send audio to another speaker/output or cast to a TV.' },
    ],
  },
  '5.5': {
    title: 'For You This Week',
    changes: [
      { type: 'new', text: 'A personalized weekly mix built from your taste — find it on Home or in the sidebar. It refreshes automatically every Monday.' },
    ],
  },
  '5.4': {
    title: 'Reliability',
    changes: [
      { type: 'improved', text: 'Behind-the-scenes monitoring so AI features stay fast and reliable.' },
    ],
  },
  '5.3': {
    title: 'Cleaner, refined design',
    changes: [
      { type: 'new', text: 'A calmer, more refined look — softer background, cleaner cards, simpler navigation and more breathing room throughout.' },
    ],
  },
  '5.2': {
    title: 'Fresher recommendations',
    changes: [
      { type: 'improved', text: 'Home shelves and the auto-queue now rotate and refresh each session instead of repeating the same songs — more variety across languages, moods and vibes.' },
    ],
  },
  '5.1': {
    title: 'Polish',
    changes: [
      { type: 'improved', text: 'Tidied up wording across the app.' },
    ],
  },
  '5.0': {
    title: 'Smarter AI engine',
    changes: [
      { type: 'improved', text: 'AI now runs on a more powerful engine — the website uses a larger model and the app a faster one, for snappier results.' },
    ],
  },
  '4.9': {
    title: 'New AI engine',
    changes: [
      { type: 'improved', text: 'The AI DJ, AI Playlist and lyric romanize/translate now run on a new, more powerful and multilingual AI engine.' },
    ],
  },
  '4.8': {
    title: 'Sidebar fix',
    changes: [
      { type: 'fixed', text: 'The lower sidebar items (Settings, etc.) are no longer hidden behind the now-playing bar while a song is playing.' },
    ],
  },
  '4.7': {
    title: 'Premium look',
    changes: [
      { type: 'new', text: 'A vibrant new look: a slow-drifting aurora gradient glows behind the app, and navigation is now bigger and more immersive with glowing gradient highlights.' },
    ],
  },
  '4.6': {
    title: 'No more repeats',
    changes: [
      { type: 'fixed', text: 'The auto-queue no longer loops the same songs — it now skips anything you played in the last ~60 tracks and pulls from a wider pool, so the flow stays fresh.' },
    ],
  },
  '4.5': {
    title: 'Smoother playback',
    changes: [
      { type: 'fixed', text: 'Fixed songs glitching or restarting shortly after they began — removed an over-eager mid-song quality switch. Playback is stable again, still at the best available bitrate.' },
    ],
  },
  '4.4': {
    title: 'Live quality indicator',
    changes: [
      { type: 'new', text: 'The Now Playing screen now shows the exact streaming bitrate (e.g. "HD · 320 kbps") so you can see the real audio quality at a glance' },
    ],
  },
  '4.3': {
    title: 'Audio clarity',
    changes: [
      { type: 'fixed', text: 'More aggressively upgrades every track to its full 320 kbps stream, and forces a fresh app shell so the high-quality fix reaches all devices. Clearer sound on headphones and Bluetooth.' },
    ],
  },
  '4.2': {
    title: 'Smarter, explainable DJ',
    changes: [
      { type: 'improved', text: 'The AI DJ now follows a fuller recommendation rulebook (vibe, mood, energy, taste, skip-avoidance, scoring) and tells you why each upcoming song was picked — see the reason under tracks in your Queue' },
    ],
  },
  '4.1': {
    title: 'Higher audio quality',
    changes: [
      { type: 'fixed', text: 'Fixed a bug that could stream low-bitrate audio even on "High" — the player now always picks the highest available bitrate and upgrades to full quality on the fly. Much better on headphones and Bluetooth.' },
    ],
  },
  '4.0': {
    title: 'AI Playlist',
    changes: [
      { type: 'new', text: 'Describe a vibe in plain words — "rainy-day Telugu melodies" — and the new AI Playlist screen builds a playlist you can play and save instantly' },
    ],
  },
  '3.9': {
    title: 'Sharper AI DJ',
    changes: [
      { type: 'improved', text: 'The AI DJ now reads more of your taste (songs you finish, your top artists and languages, time of day), filters out muted languages, and re-ranks its picks against your on-device taste model so the auto-queue flows better' },
    ],
  },
  '3.8': {
    title: 'Smarter recommendations',
    changes: [
      { type: 'improved', text: 'Deeper on-device taste model: learns what you play at different times of day, leans away from what you skip, and the auto-queue now spreads out artists so it flows better' },
    ],
  },
  '3.7': {
    title: 'Fine-tune lyric sync',
    changes: [
      { type: 'new', text: 'Lyrics out of time? Nudge the sync (−/+) on the lyrics page — the per-song adjustment saves and applies in the player and karaoke too' },
    ],
  },
  '3.6': {
    title: 'Adjustable lyrics size',
    changes: [
      { type: 'new', text: 'Choose your lyrics text size (Small → Huge) in Settings — it now sticks across the player, karaoke, and lyrics page' },
    ],
  },
  '3.5': {
    title: 'Download whole playlists',
    changes: [
      { type: 'new', text: 'New “Download” button on playlists and Favorites saves the entire list for offline playback in one tap (Android) — with live progress' },
    ],
  },
  '3.4': {
    title: 'Reduce motion',
    changes: [
      { type: 'improved', text: 'New “Reduce motion” option in Settings minimises animations and transitions — gentler on motion sensitivity and older devices' },
    ],
  },
  '3.3': {
    title: 'Share what you play',
    changes: [
      { type: 'new', text: 'Share a beautiful “now playing” card (cover art + song) from any song’s ⋯ menu → Share as image' },
    ],
  },
  '3.2': {
    title: 'Crossfade length',
    changes: [
      { type: 'improved', text: 'Choose how long crossfade lasts (3, 5, 8 or 12 seconds) in Settings' },
    ],
  },
  '3.1': {
    title: 'Liquid Glass everywhere',
    changes: [
      { type: 'improved', text: 'Brought the Liquid Glass treatment to dark mode too — softer specular edges and a gentle sheen across cards, the player and sheets' },
    ],
  },
  '3.0': {
    title: 'Karaoke mode',
    changes: [
      { type: 'new', text: 'New immersive full-screen Karaoke view — big synced lyrics over the artwork, tap a line to jump. Open it from the lyrics screen while a song plays' },
    ],
  },
  '2.9': {
    title: 'Wake-up alarm',
    changes: [
      { type: 'new', text: 'Set a wake-up alarm in Settings — VinaX starts your music at the time you choose (shuffle favorites or resume)' },
    ],
  },
  '2.8': {
    title: 'Lyrics, your way',
    changes: [
      { type: 'new', text: 'On the lyrics screen, switch between Original, Romanized (English letters), and English translation — synced highlighting still follows along' },
    ],
  },
  '2.7': {
    title: 'Your playlists',
    changes: [
      { type: 'new', text: 'Build your own playlists — open one to play, shuffle, rename, reorder, and remove songs; create a new playlist straight from a song’s ⋯ menu' },
    ],
  },
  '2.6': {
    title: 'Liquid Glass light mode',
    changes: [
      { type: 'improved', text: 'Reimagined the light theme as Apple-style “Liquid Glass” — airy translucent surfaces, bright specular edges, and soft floating depth' },
    ],
  },
  '2.5': {
    title: 'A fresh new look',
    changes: [
      { type: 'improved', text: 'Refreshed the whole app — a deeper obsidian theme, crisper frosted-glass surfaces, richer depth, and two new accent themes (Gold, Azure)' },
    ],
  },
  '2.4': {
    title: 'Listen Together',
    changes: [
      { type: 'new', text: 'Start a Listen Together session and share the code — friends hear the same music in sync as you play' },
    ],
  },
  '2.3': {
    title: 'Offline downloads',
    changes: [
      { type: 'new', text: 'Download songs for offline listening (Android) — open a song’s ⋯ menu and tap Download, then find them under Downloads' },
    ],
  },
  '2.2': {
    title: 'News & announcements',
    changes: [
      { type: 'new', text: 'Important updates from the VinaX team now appear as a dismissible banner in the app' },
    ],
  },
  '2.1': {
    title: 'Shareable lyric cards',
    changes: [
      { type: 'new', text: 'On the lyrics screen, tap “Share lyrics”, pick your favourite lines, and share a beautiful card' },
    ],
  },
  '2.0': {
    title: 'Your VinaX',
    changes: [
      { type: 'new', text: 'New “Your VinaX” screen — your minutes, top songs, artists and languages, with a card you can share' },
    ],
  },
  '1.9': {
    title: 'Under-the-hood improvements',
    changes: [
      { type: 'improved', text: 'Reliability and behind-the-scenes improvements' },
    ],
  },
  '1.8': {
    title: 'Better lyrics & polish',
    changes: [
      { type: 'improved', text: 'Lyrics now match many more songs — including Telugu and film tracks with “(From …)” titles' },
      { type: 'improved', text: 'Smoother first-run setup, including the notification permission for lock-screen lyrics' },
    ],
  },
  '1.7': {
    title: 'Help & feedback',
    changes: [
      { type: 'new', text: 'New Help & Feedback screen (in Settings) with FAQs, tips, a replayable tour, and a way to report bugs or share ideas' },
    ],
  },
  '1.6': {
    title: 'Faster & smoother',
    changes: [
      { type: 'improved', text: 'Quicker startup and a snappier first interaction — non-essential work now loads in the background' },
    ],
  },
  '1.5': {
    title: 'Lyrics everywhere',
    changes: [
      { type: 'improved', text: 'Lock-screen lyrics now work on the web player too, and Settings makes it easy to enable notifications if they are off' },
    ],
  },
  '1.4': {
    title: 'Recommendations in your language',
    changes: [
      { type: 'improved', text: 'The auto DJ now keeps recommendations in the language of the song you are playing — Telugu stays Telugu, Hindi stays Hindi, and so on' },
    ],
  },
  '1.3': {
    title: 'Smoother player',
    changes: [
      { type: 'improved', text: 'The full-screen player now slides up smoothly and you can swipe it down to dismiss — just like your favorite music apps' },
    ],
  },
  '1.2': {
    title: 'Lock screen lyrics',
    changes: [
      { type: 'new', text: 'Synced lyrics now follow along on your lock screen and notification as a song plays — turn it off anytime in Settings' },
    ],
  },
  '1.1': {
    title: 'VinaX 1.1',
    changes: [
      { type: 'improved', text: 'In-app updates now work reliably — you’re prompted as soon as a new version is available, and it installs in one tap' },
    ],
  },
  // Historical entries from the old standalone Android app's numbering — the
  // web app's own line reached 3.3.0 (Voice everywhere) in 2026, so these
  // legacy keys carry an -android suffix to avoid colliding (same treatment
  // as 3.2.0-android below).
  '3.4.0-android': {
    title: 'Reliability & quality',
    changes: [
      { type: 'improved', text: 'Behind-the-scenes reliability improvements and faster fixes when something goes wrong' },
      { type: 'improved', text: 'Content-quality controls keep flagged tracks out of your results' },
    ],
  },
  '3.3.0-android': {
    title: 'A more personal VinaX',
    changes: [
      { type: 'new', text: 'VinaX now asks your name on first open to personalize your experience' },
      { type: 'new', text: 'Optional, anonymous usage insights help us improve VinaX — you can decline during setup' },
    ],
  },
  '3.2.6': {
    title: 'Smarter auto DJ',
    changes: [
      { type: 'improved', text: 'Upgraded the automatic DJ engine for smarter, smoother queues' },
    ],
  },
  '3.2.5': {
    title: 'Reliable update prompt',
    changes: [
      { type: 'fixed', text: 'The Android update prompt now reliably appears when a new version is out, and re-checks each time you reopen the app' },
    ],
  },
  '3.2.4': {
    title: 'Background playback controls fixed',
    changes: [
      { type: 'fixed', text: 'Play/Pause from the notification now works while the app is in the background — no need to reopen the app to resume' },
    ],
  },
  '3.2.3': {
    title: 'Smarter search suggestions',
    changes: [
      { type: 'improved', text: 'Search now suggests song-name completions you can tap to search (e.g. type \'rara\' \u2192 \'Ra Ra Rakkamma\'), instead of jumping straight to a song' },
    ],
  },
  '3.2.2': {
    title: 'Search, Movies & SEO',
    changes: [
      { type: 'fixed', text: 'Search suggestions now sit on a solid panel instead of bleeding into the page' },
      { type: 'new', text: 'Movies: a search box and endless scrolling to load more' },
      { type: 'improved', text: 'Per-song page titles, descriptions and share previews; refreshed sitemap for search engines' },
    ],
  },
  '3.2.1': {
    title: 'Explore tab & full-screen player',
    changes: [
      { type: 'new', text: 'New Explore tab in the mobile nav — reach Discover, Charts, Movies, Moods, Languages and Regions in one tap' },
      { type: 'improved', text: 'Swipe up on the mini-player to go full screen; swipe down on the full player to close it' },
    ],
  },
  // Suffixed like the '3.0.x-android' blocks below: the modern line reached
  // 3.2.0 (Production ready), so this historical key must not collide with it.
  '3.2.0-android': {
    title: 'Search suggestions, Movies & a collapsible sidebar',
    changes: [
      { type: 'new', text: 'Live search suggestions appear as you type' },
      { type: 'new', text: 'New Movies section — browse film soundtracks by language; album results in search are filterable by language too' },
      { type: 'new', text: 'The desktop sidebar collapses to icons-only and back — your choice is remembered' },
    ],
  },
  '3.1.5': {
    title: 'Polish & privacy',
    changes: [
      { type: 'improved', text: 'Richer frosted-glass look across the app, especially in light mode' },
      { type: 'improved', text: 'Cleaner, more private wording throughout' },
    ],
  },
  '3.1.4': {
    title: 'AI builds every queue',
    changes: [
      { type: 'new', text: 'Play any song, album, or playlist anywhere and the AI DJ now builds the whole queue from it (local fallback if AI is offline)' },
    ],
  },
  '3.1.3': {
    title: 'QA stability pass',
    changes: [
      { type: 'fixed', text: 'Removing the song that is currently playing now switches audio to the correct track instead of desyncing' },
      { type: 'fixed', text: 'The "Up next" card no longer shows the current song; queue auto-extend no longer double-fetches' },
      { type: 'fixed', text: 'Added the Rose accent to Settings and tidied dynamic-theme colour handling' },
    ],
  },
  '3.1.2': {
    title: 'Up Next preview',
    changes: [
      { type: 'new', text: 'A floating "Up next" card slides in during the last 30 seconds of a song so you can see (and tap to jump to) what plays next' },
    ],
  },
  // Suffixed like the '3.0.x-android' block below: the modern line reached
  // 3.1.1, so the historical keys must not collide with it.
  '3.1.1-android': {
    title: 'AI DJ — now actually playing',
    changes: [
      { type: 'fixed', text: 'AI DJ now builds your Up Next automatically as you listen (and works in the Android app, not just the web)' },
    ],
  },
  '3.1.0-android': {
    title: 'AI DJ',
    changes: [
      { type: 'new', text: 'A built-in AI DJ automatically builds your queue and next song from your taste — kicks in when available, and quietly falls back to local picks otherwise' },
    ],
  },
  // Historical Android-era releases — keyed '3.0.x' in the old numbering
  // scheme; suffixed so they can't collide with the modern 3.0.x line.
  '3.0.4-android': {
    title: 'Update Conflict Fixed (for real)',
    changes: [
      { type: 'fixed', text: 'Every build is now signed with one key via build.gradle, so updates install over the top — no more "package conflicts" error' },
    ],
  },
  '3.0.3-android': {
    title: 'Update Installs Fixed',
    changes: [
      { type: 'fixed', text: 'App updates now install over the top — every build is signed with one stable key (fixes "package conflicts with an existing package")' },
    ],
  },
  '3.0.2-android': {
    title: 'Playback Notification Fix',
    changes: [
      { type: 'fixed', text: 'Android playback notification & lockscreen controls now work (native media plugin registered)' },
      { type: 'fixed', text: 'Bluetooth/headset buttons control playback through the media session' },
    ],
  },
  '3.0.1-android': {
    title: 'Reliability & Updates Fix',
    changes: [
      { type: 'fixed', text: 'In-app update check now correctly detects new builds' },
      { type: 'fixed', text: 'App updates verify a real SHA-256 hash before installing' },
      { type: 'fixed', text: 'Android update install permission now declared in the manifest' },
      { type: 'improved', text: 'Web app is now installable and works offline (app shell)' },
      { type: 'improved', text: 'Hardened Cast startup against a load-order race' },
    ],
  },
  // Historical Android-era release — keyed '3.0.0' in the old numbering
  // scheme; suffixed so it can't collide with the modern 3.0.0 (VinaX V1).
  '3.0.0-android': {
    title: 'The Glass UI Update',
    changes: [
      { type: 'new', text: 'Stunning new Glassmorphism UI with a modern aesthetic' },
      { type: 'improved', text: 'In-app updater now fetches directly and securely from GitHub Releases' },
      { type: 'improved', text: 'Stabilized continuous integration (CI) and build workflows' },
      { type: 'fixed', text: 'Resolved issues with app updates and missing URLs' }
    ],
  },
  '2.0.0': {
    title: 'The Big Upgrade',
    changes: [
      { type: 'new', text: 'Auto-release builds — APK now published to GitHub Releases automatically' },
      { type: 'new', text: "Enhanced What's New experience with categorized updates" },
      { type: 'new', text: 'SHA-256 integrity verification for app updates' },
      { type: 'new', text: 'Profile import validation with size limits' },
      { type: 'improved', text: 'Blazing fast favorites — O(1) lookup replaces linear scan' },
      { type: 'improved', text: 'Smarter cache management — LRU eviction prevents memory leaks' },
      { type: 'improved', text: 'Smoother playback — fixed localStorage thrashing during playback' },
      { type: 'improved', text: 'Better keyboard accessibility — Escape to close menus, focus traps' },
      { type: 'improved', text: 'Screen reader support — proper ARIA labels on navigation' },
      { type: 'fixed', text: 'Sleep timer no longer fires after clearing queue' },
      { type: 'fixed', text: 'Back button no longer exits the app unexpectedly' },
      { type: 'fixed', text: 'Radio mode now shows a toast when similar tracks fail to load' },
      { type: 'fixed', text: 'Audio preload element properly cleaned up to free resources' },
      { type: 'fixed', text: 'Media session listeners no longer accumulate on re-init' },
      { type: 'fixed', text: 'Profile save race condition resolved — no more lost listening data' },
    ],
  },
};

/** Legacy plain-string changelog for older versions. */
export const CHANGELOG: Record<string, string[]> = {
  '1.16.6': [
    '🖼 Share-as-image is back',
  ],
  '1.16.5': [
    '🧹 Removed the Share-as-image feature',
  ],
  '1.16.3': [
    '🖼 Share-as-image fixed for good — falls back gracefully and always produces a card',
    '🌐 10 more languages: Odia, Assamese, Rajasthani, Konkani, Maithili, Nepali, Sanskrit, Tulu, Dogri, Kashmiri',
  ],
  '1.16.2': [
    '🖼 Share-as-image now embeds real album art (via a CORS-safe image proxy)',
  ],
  '1.16.1': [
    '🖼 Fixed "Share as image" — now works reliably on web and Android',
    '🔍 Search box and tabs stay pinned while results scroll',
    '🎙 Voice search shows a clear listening animation',
  ],
  '1.16.0': [
    '✨ New Aurora look — living ambient background + 4 new accent themes (Sunset, Aurora, Mono…)',
    '🚗 Drive Mode — huge, simple controls for the road',
    '⏯ Resume playback — long tracks pick up where you left off',
    '🔥 Listening streaks, 📊 on-screen visualizer, double-tap artwork to favorite',
    '🪶 Density & haptics controls, Recently Added shelf, refined glass surfaces',
  ],
  '1.15.0': [
    '💾 Save albums & playlists and follow artists — all in your Library',
    '🙈 "Not interested" on any song to tune your recommendations',
    '📚 New "Saved & Following" shelf in Library',
  ],
  '1.14.0': [
    '🎚 Crossfade — songs blend smoothly into each other (toggle in Settings)',
    '😴 Sleep timer now fades out gently instead of cutting off',
    '🖼 Share any song as a beautiful image card',
    '📅 VinaX Daily — a fresh personalized mix every morning, on Home',
  ],
  '1.12.0': [
    '🔔 Rebuilt the playback notification from scratch — VinaX\'s own native media service',
    '🎛 Lockscreen + Bluetooth/headset controls, Play/Pause/Prev/Next/Stop',
    '📱 Works across Android 8, 12, and 13+',
  ],
  '1.11.0': [
    '🔔 Playback notification fix for Xiaomi/HyperOS devices (main-thread media updates)',
    '🎨 New look: deep violet-black surfaces with a hot crimson accent, lyric-forward player',
    '🌐 Language selection in Settings rebuilt — all languages, clean layout',
    '🛟 The app now tells you on-screen if the notification bridge misbehaves',
  ],
  '1.10.2': [
    '🔔 Rebuilt the Android build pipeline for reliable playback notifications',
    '🧪 Deeper notification diagnostics in Settings',
  ],
  '1.10.1': [
    '🔔 Notification now always shows song title, artist, and artwork',
    '🛠 Hardened the native media layer against artwork download failures',
  ],
  '1.10.0': [
    '🏠 Home feed now scrolls forever — endless picks across your languages',
    '🔔 Playback notification reliability pass for Android',
    '🌗 Light theme fully reworked — clean, readable, instant switching',
    '🧭 Smoother scrolling and pages always open at the top',
    '🎓 New user tour + this What\'s New screen',
  ],
};

/** Newest shipped version with structured notes — drives the What's New sheet. */
import { LATEST_VERSION } from './version';

export { LATEST_VERSION };

/** Strip build metadata so "3.0.1+99" or "v3.0.1-build99" both match "3.0.1". */
function baseVersion(v: string): string {
  return v.replace(/^v/, '').split(/[+-]/)[0];
}

/** The FIRST key in CHANGELOG_V2 — objects preserve insertion order, so this
 *  is always the newest entry. Deriving the "latest" from the changelog
 *  itself means whoever adds a new entry above the previous top automatically
 *  gets What's New to fire, without needing to remember to bump
 *  version.ts too. (Historical bug: LATEST_VERSION was left at 3.8.0 across a
 *  dozen builds → no listener saw a What's New for any of them.) */
function latestVersionKey(): string {
  const keys = Object.keys(CHANGELOG_V2);
  return keys[0] ?? LATEST_VERSION;
}

export function notesFor(version: string): string[] | VersionInfo {
  const base = baseVersion(version);
  if (base in CHANGELOG_V2) return CHANGELOG_V2[base];
  if (base in CHANGELOG) return CHANGELOG[base];
  // Unknown or newer build number: show the latest real notes, never a stub.
  return CHANGELOG_V2[latestVersionKey()];
}

/** Notes for the newest shipped version (what the What's New sheet renders). */
export function latestNotes(): VersionInfo {
  return CHANGELOG_V2[latestVersionKey()];
}

/** Stable fingerprint of the latest release — the What's New sheet compares
 *  the stored value against this, so ANY substantive change to the top entry
 *  (new title, new change lines) triggers the sheet on next launch. Robust
 *  against LATEST_VERSION never being bumped. */
export function latestNotesFingerprint(): string {
  const key = latestVersionKey();
  const info = CHANGELOG_V2[key];
  if (!info) return key;
  const head = (info.title ?? '') + '|' + info.changes.slice(0, 3).map((c) => c.type + ':' + c.text.slice(0, 80)).join('\n');
  // Lightweight FNV-1a 32-bit — deterministic across builds, tiny.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < head.length; i += 1) {
    h ^= head.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${key}#${h.toString(16).padStart(8, '0')}`;
}
