import { useState } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { Chip } from '@/components/Chip';
import { toast } from '@/store/toastStore';
import { sendFeedback } from '@/services/feedback';
import { useUiStore } from '@/store/uiStore';

const TIPS: string[] = [
  'Tap any song or its artwork to play. Tap the mini-player to open the full screen.',
  'Swipe the mini-player up to expand, or left/right to skip tracks.',
  'In the full player, drag down to dismiss it.',
  'Heart songs to shape your recommendations — VinaX learns only on your device.',
  'Open a song’s menu and Start Radio to auto-build a station around it.',
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Is VinaX really free? What’s the catch?', a: 'Free, forever, for everything — no subscriptions, no premium tiers, no ads, no login. There is no catch: it’s a passion project. The admin console literally has a card that reads “₹0 · Revenue — free forever”.' },
  { q: 'Do I need an account?', a: 'Never. Your name is only used to greet you, and your taste profile, favorites, history and downloads live on this device alone. Nothing you play is tied to an identity anywhere.' },
  { q: 'What data leaves my device?', a: 'Only anonymous, opt-in usage statistics (like “a song was played in your city”) that help improve VinaX — and you can switch that off. IP addresses are never stored. Everything personal stays local, with one-tap export and erase in Settings → Your Data.' },
  { q: 'How do the recommendations work without an account?', a: 'The taste profile is computed on this device: languages you pinned, songs you finish, favorite and skip. AI features receive only a short, capped, anonymous summary of that — never your history.' },
  { q: 'What is VinaX AI?', a: 'A full chat assistant: pick from seven engines, search the live web, attach images or files, dictate with the mic or talk hands-free in voice mode. Ask for music — “play <song>” — and the reply is a live mini-player right in the chat, with lyrics singing along.' },
  { q: 'What are the seven engines?', a: 'VinaX FLASH is the everyday default; VinaX 20B answers fastest; VinaX SUPER thinks deepest; VinaX INSTANT knows music and answers in a blink; VinaX 120B is the big creative engine that also runs the AI DJ; VinaX ULTRA is the most powerful all-rounder and powers live voice; VinaX NANO 3 is light and quick and loves finding songs — it also works behind the Search page. Every reply shows a small chip naming the engine that actually answered.' },
  { q: 'How does voice chat work?', a: 'Tap the waveform icon in the chat composer — it works in the browser and in the Android app. Allow the microphone, then just talk: VinaX listens, thinks and speaks back in a natural studio voice; tap the orb to interrupt. On first use some browsers download a small on-device speech pack, after which what you say is recognised on your device.' },
  { q: 'What do Think and Research do?', a: 'Think tells the engine to reason more carefully before it answers — best for tricky questions. Research lets it check the live web and cite what it finds — best for anything recent. Turn either on from the chat composer; when a live search comes up empty, VinaX says so plainly instead of guessing.' },
  { q: 'How do I control songs from the chat?', a: '“play <song>”, “pause”, “next” and “previous” all work as messages. A play request answers with artwork, play/pause and skip controls, a seek bar and the current lyric line — the card always mirrors the real player.' },
  { q: 'What does the Queue page do?', a: 'It’s the AI DJ’s home. The queue builds itself around what’s playing, every upcoming song shows WHY it was picked, and the tune chips — ✦ Surprise me, More chill, More energetic, Romantic — retune it instantly.' },
  { q: 'What is the Ctrl+K command palette?', a: 'Press Ctrl/⌘+K anywhere to open the command palette — jump to any page, fire player actions like play, pause and skip, or type a song name to find and play it instantly. Right-click any song for the same quick actions (play next, queue, favorite, copy link). In VinaX AI, Ctrl/⌘+K starts a fresh chat.' },
  { q: 'What do “AI DJ” and “Instant picks” mean under songs?', a: 'AI DJ means the AI curated those picks. Instant picks means the on-device engine answered while the AI was busy — honesty over pretending. Both follow your languages and mood.' },
  { q: 'What is the 🔔 bell on Home?', a: 'Your notification center: the daily song pick, owner announcements and recent release notes. Tapping a notification jumps straight to the song or page.' },
  { q: 'What is the daily pick?', a: 'If you turn notifications on, VinaX suggests at most ONE song a day — chosen by the AI, delivered as a push on the web and shown in the app when it opens. Off by default, off anytime.' },
  { q: 'What is “Your VinaX”?', a: 'Your on-device listening stats: plays, hours, favorites, artists, a 🔥 day-streak, top artists and your language mix — computed here, never uploaded, with a Share button if you want to show off.' },
  { q: 'How does Listen Together work?', a: 'Start a session, share the room code or invite link. Everyone hears the same second (~1s sync), sees the live queue, and can add songs with credit. The host keeps play/pause/skip; “End for all” closes it for everyone.' },
  { q: 'How do I download songs for offline?', a: 'In the Android app, open a song’s menu and choose Download. Your library, favorites and history also browse offline with artwork; downloads play from the Downloads screen.' },
  { q: 'Why did my music pause during a phone call?', a: 'Android pauses all audio for calls. VinaX resumes by itself the moment the call ends — no need to reopen the app.' },
  { q: 'A song won’t play — why?', a: 'Music streams from community catalog sources that can be briefly unavailable. Try again in a moment or pick another version — the player also skips ahead automatically when a source fails.' },
  { q: 'Where are synced lyrics from, and what is “Meaning”?', a: 'Lyrics come from a public lyrics library, synced line-by-line with karaoke color-fill that follows your theme. If a line lands early or late, open the lyric offset and nudge the timing until it sits perfectly. Meaning gives you a one-line AI explanation; many songs also offer romanized and translated views.' },
  { q: 'Can I change the look of the app?', a: 'Yes — Settings has dark, light and black (AMOLED) themes, and whichever you choose, the whole app gently tints itself to the artwork of the song playing. Lyrics pick up matching colors too.' },
  { q: 'How do I move VinaX to a new device?', a: 'Old device: Settings → Your Data → Export. New device: on the welcome screen tap “Import your profile” (or Settings → Your Data → Import). Favorites, history, taste and settings arrive intact.' },
  { q: 'How do I export or erase everything?', a: 'Settings → Your Data. Export downloads one file with everything; the clear buttons erase history, favorites, queue, cached data or the whole profile. Since nothing is on our servers, erasing locally erases it everywhere.' },
];


const GUIDES: Array<{ title: string; steps: string[] }> = [
  {
    title: 'Play your first song',
    steps: [
      'Open Search and type anything — a song, artist, movie or mood. Typos are fine.',
      'Tap a result to play it. The AI DJ quietly builds a queue of matching songs behind it.',
      'Tap the mini-player bar to open the full-screen player with synced lyrics.',
    ],
  },
  {
    title: 'Master the player gestures',
    steps: [
      'Flick the artwork up for the next song, down for the previous one.',
      'Double-tap the left or right edge of the artwork to jump ±10 seconds.',
      'Double-tap the centre to favorite. Tap a lyric line to jump the song there.',
    ],
  },
  {
    title: 'Chat with VinaX AI — and make it play',
    steps: [
      'Open VinaX AI from the menu (sparkle icon). Pick an engine, or keep the recommended one.',
      'Ask anything — turn on the 🌐 toggle for live web answers, or attach an image or file.',
      'Type “play <song name>” and the reply becomes a mini-player: controls, seek bar and live lyrics, right in the chat.',
    ],
  },
  {
    title: 'Let the AI DJ drive',
    steps: [
      'Open Queue while something plays — every upcoming song shows why it was picked.',
      'Tap More chill, More energetic or Romantic to retune what comes next — different picks on every press.',
      'Can’t decide? ✦ Surprise me. Remove any song with the ×; the DJ refills around it.',
    ],
  },
  {
    title: 'Listen together with friends',
    steps: [
      'Library → Listen Together → Start session, then share the room code or invite link.',
      'Friends join in one tap and hear the same second you do (~1s sync).',
      'Anyone can add songs (with “Added by” credit); you keep the controls. “End for all” closes the room.',
    ],
  },
  {
    title: 'Tune what VinaX learns',
    steps: [
      'Pin your languages on the Languages page — every shelf and mix follows them.',
      'Favorite what you love and skip what you don’t; the on-device taste profile learns silently.',
      'Check Taste Profile to see what it learned, and Settings → Recommendations to set how bold it should be.',
    ],
  },
  {
    title: 'Read your listening story',
    steps: [
      'Open Your VinaX to see plays, hours, top artists, your language mix and your 🔥 streak.',
      'Keep the streak alive by playing at least one song a day — your best streak is remembered.',
      'Tap Share to post your stats; only what you see leaves the device, and only when you tap.',
    ],
  },
  {
    title: 'Install VinaX everywhere',
    steps: [
      'Android: Settings → Get the App — background play, downloads and in-app updates.',
      'Desktop or mobile web: use the browser’s Install / Add to Home Screen for the app-like version.',
      'TV: open the site in the TV browser — the D-pad drives everything, ten feet away.',
    ],
  },
];


const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['→ / ←', 'Next / previous song'],
  ['⌘/Ctrl + K', 'Command palette · new chat (in VinaX AI)'],
  ['Right-click', 'VinaX menu — song actions anywhere'],
  ['Esc', 'Stop AI generation · close overlays'],
  ['Double-tap your message', 'Edit & resend (VinaX AI)'],
  ['Flick artwork ↑ / ↓', 'Next / previous song'],
  ['Double-tap artwork edge', 'Seek ±10 seconds'],
  ['Double-tap artwork centre', 'Favorite'],
];


export default function HelpPage() {
  usePageTitle('Help & Feedback');
  const openTour = useUiStore((s) => s.openTour);
  const [type, setType] = useState<'bug' | 'idea' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const text = message.trim();
    if (!text) {
      toast('Please write a message first');
      return;
    }
    setSending(true);
    const ok = await sendFeedback(type, text);
    setSending(false);
    if (ok) {
      setMessage('');
      toast('Thanks! Your feedback was sent.');
    } else {
      toast('Could not send — check your connection and try again.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-10">
      <PageHeader title="Help & Feedback" />

      <section className="glass-panel rounded-2xl p-5 mb-5">
        <h2 className="text-base font-bold mb-3">Quick tips</h2>
        <ul className="space-y-2 text-sm text-ink-200">
          {TIPS.map((t) => (
            <li key={t} className="flex gap-2.5">
              <span className="text-ember-500 mt-0.5">•</span>
              {t}
            </li>
          ))}
        </ul>
        <button
          onClick={openTour}
          className="mt-4 px-4 py-2 rounded-full btn-secondary text-sm"
        >
          Replay welcome tour
        </button>
      </section>

      <section className="glass-panel rounded-2xl p-5 mb-5">
        <h2 className="text-base font-bold mb-3">FAQ</h2>
        <div className="divide-y divide-ink-800">
          {FAQ.map((f) => (
            <details key={f.q} className="py-2 group">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold py-1">
                {f.q}
                <span className="text-ink-500 group-open:rotate-180 transition-transform">⌄</span>
              </summary>
              <p className="text-sm text-ink-300 leading-relaxed pb-2 pt-1">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-5 mb-5">
        <h2 className="text-base font-bold mb-3">How to use VinaX</h2>
        <div className="space-y-4">
          {GUIDES.map((g) => (
            <div key={g.title}>
              <h3 className="text-sm font-bold text-ember-300 mb-1.5">{g.title}</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-ink-200">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-5 mb-5">
        <h2 className="text-base font-bold mb-3">Keyboard & gesture reference</h2>
        <div className="space-y-1.5">
          {SHORTCUTS.map(([k, v]) => (
            <p key={k} className="text-sm text-ink-200">
              <span className="inline-block min-w-40 font-mono text-xs bg-ink-800/70 rounded-md px-2 py-1 mr-2">{k}</span>
              {v}
            </p>
          ))}
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-5 mb-5">
        <h2 className="text-base font-bold mb-2">Copyright & legal</h2>
        <p className="text-sm text-ink-200 leading-relaxed mb-2">
          VinaX is a free player. Music, artwork and lyrics stream from third-party public catalogues — VinaX hosts no
          media files and sells nothing. All songs, recordings, artwork and lyrics remain the property of their
          respective artists, labels and rights holders, who deserve every credit.
        </p>
        <p className="text-sm text-ink-200 leading-relaxed mb-3">
          Rights holders can request removal of any content at any time — see the DMCA / takedown page. Your personal
          data never leaves your device except anonymous, opt-in usage statistics.
        </p>
        <p className="text-sm">
          <a href="/terms" className="text-ember-400 hover:underline">Terms of Use</a> ·{' '}
          <a href="/privacy" className="text-ember-400 hover:underline">Privacy</a> ·{' '}
          <a href="/dmca" className="text-ember-400 hover:underline">DMCA & takedowns</a> ·{' '}
          <a href="/contact" className="text-ember-400 hover:underline">Contact</a>
        </p>
      </section>

      <section className="glass-panel rounded-2xl p-5">
        <h2 className="text-base font-bold mb-1">Report a bug or share an idea</h2>
        <p className="text-xs text-ink-400 mb-3">
          Goes straight to the VinaX team. Your app version and a coarse location are included to help us reproduce issues.
        </p>
        <div className="flex gap-2 mb-3">
          {(['bug', 'idea', 'other'] as const).map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {t === 'bug' ? 'Bug' : t === 'idea' ? 'Idea' : 'Other'}
            </Chip>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Tell us what happened, or what you’d love to see…"
          rows={4}
          maxLength={2000}
          className="glass-input w-full px-4 py-3 rounded-xl text-sm resize-none"
        />
        <button
          onClick={() => void submit()}
          disabled={sending}
          className="mt-3 px-5 py-2.5 rounded-full btn-primary"
        >
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </section>
    </div>
  );
}
