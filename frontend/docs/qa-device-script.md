# VinaX — Real-Device QA Script (v1.2.1)

Run each flow on: **① Android app (newest APK)** · **② Android Chrome (sirimillavinay.online)** · **③ iPhone Safari** · **④ TV browser**. Mark ✅/❌ and note *exactly what you saw* for any ❌ — screen, step, message.

## A. First-run & boot (fresh install / incognito)
1. Open the app/site fresh → onboarding appears → **name is required** (try skipping) → language pre-picked from your region.
2. Home paints with artwork on the **first** visit (no grey squares).
3. Kill and reopen 3× — no freeze at the splash, no crash. **(① especially — this was the force-close bug.)**

## B. Push notifications (② ③ desktop; ① shows announcements on open)
1. Home shows the 🔔 "Get a ping when new music lands" card → **Turn on** → browser permission dialog appears → accept.
2. Admin → Notifications: subscriber count went up by 1.
3. Send yourself a test targeting **A song** via the picker → notification lands within seconds → **tap it** → the exact song page opens.
4. ①: send from admin, then open the app → the announcement appears as a notification; tapping routes to the song.

## C. VinaX AI + chat mini-player (all devices)
1. Ask anything → streamed reply, no "Something hit a wrong note".
2. Type **play <any song>** → reply is the **live mini-player card**: artwork, play/pause works, skip works, **seek bar drags**, lyrics line advances in sync.
3. "pause" / "next" / "previous" as chat messages control playback.
4. ②③: the mic button in the message bar dictates text. ①: **no voice buttons anywhere** (correct — WebView).
5. All five engines answer (switch engine in the pill and send one line each).

## D. Player & lyrics
1. Play a Telugu song → synced lyrics appear; flick artwork up/down changes songs; double-tap edges seeks ±10s.
2. ①②: take a phone call mid-song → after hanging up, music **resumes by itself**.
3. Lock screen: artwork + controls + ±10s seek; lock-screen lyrics if enabled.

## E. Listen Together (two devices)
1. Start a session on ①, join via link on ② → both hear the **same second** (count "1-2-3" out loud and compare).
2. Guest adds a song → it appears in both queues with "Added by".
3. Host pause/skip reflects on the guest within ~1s. End session → ends for both.
4. Admin → Live Rooms shows the room live; **End** kills it for both devices.

## F. Maintenance switch (new — test LAST)
1. Admin → Technical → Site mode → type a message → **Enter maintenance**.
2. Within ~1 min: site + app show the "We'll be right back" screen with your message. Admin console still works.
3. **● Go live** → within ~1 min everything returns without a manual refresh.

## G. Search & discovery
1. Search with a typo ("arjith") → still finds Arijit results.
2. "Top searches" chips appear under the empty search bar; tapping one searches it.
3. TV ④: D-pad reaches every control on Home → Search → player.

**When done:** send me the ❌ list (device + step + what you saw). I fix, we re-run only the failed rows.
