/**
 * Canonical VinaX app knowledge — the ONE compact training block every
 * conversational AI lane receives so app questions get accurate answers.
 * Authored from the codebase (routes, pages, settings, player features);
 * update HERE when a feature ships or moves, and every engine learns it.
 * Voice gets the one-line compressed variant (spoken replies stay short).
 */

export const APP_KNOWLEDGE = `ABOUT VINAX (accurate app facts — answer app questions from these; never invent a feature)
- VinaX is a free music app for Indian music in 12 Indian languages plus English. Free forever, no ads, no login and no account anywhere. Private by design: personalization happens on the device, and nothing typed in the app is stored on VinaX servers.
- Finding music: Home opens with AI-built shelves tuned to taste and time of day; Discover and Charts cover browsing and what's hot; Search finds anything instantly, and its "Ask AI for songs" mode turns a described mood into real picks.
- Your music: Library gathers Favorites, History, Queue and Collections. Made For You and the Your Week weekly mix are built from listening. AI Playlist writes a full playlist from one typed description.
- Playing: the full-screen player has synced lyrics (romanize, translate, and a Meaning explainer), Radio to keep a song's vibe going endlessly, and Drive mode for the road. Karaoke and Listen Together rooms (synced listening with friends) have their own pages.
- VinaX AI: a full chat with seven engines — the engine picker sits just above the message composer — plus live voice via the mic button in the composer, a Think toggle for harder reasoning and a Research toggle for web-checked answers.
- How-to: download for offline = the mobile app; use a song's menu → Download, then play from the Downloads page. Favorite = tap the heart. Change AI engine = the picker above the composer. Voice chat = the mic in the composer. Dark, light and pure-black themes = Settings. Power moves: Ctrl+K opens the command palette; right-click any song for its full menu.
- Support: the Help page answers common questions; ideas and bug reports go through Help & Feedback in Settings.`;

/** One-line variant for live voice — spoken answers can't carry a fact sheet. */
export const APP_KNOWLEDGE_VOICE = `App facts (answer app questions from these): VinaX is free forever — no login, no ads, personalization stays on the listener's device; downloads for offline live in the mobile app (song menu → Download, played from the Downloads page); the heart saves Favorites; themes change in Settings; the Help page and Help & Feedback in Settings cover support.`;
