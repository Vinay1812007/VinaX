import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { Chip } from '@/components/Chip';
import { toast } from '@/store/toastStore';
import { sendFeedback } from '@/services/feedback';
import { useUiStore } from '@/store/uiStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { useClientConfig } from '@/features/home/useAppConfig';
import { TUTORIALS } from '@/features/tutorials/tutorials';
import { CHANGELOG_V2 } from '@/constants/changelog';
import { DISPLAY_VERSION, LATEST_VERSION } from '@/constants/version';
import { isNativePlatform } from '@/services/native';
import { cn } from '@/utils/cn';

/**
 * v5.20.0 — Help & Feedback, rebuilt around what the app can do today:
 * live tutorials that run inside the real app, searchable guides and FAQ,
 * the latest update card, shortcuts, legal, and the feedback form with
 * optional diagnostics. Every claim here must be true today.
 */

interface Guide { group: string; title: string; steps: string[] }

const GUIDES: Guide[] = [
  { group: 'Listening', title: 'Play your first song', steps: ['Open Search and type anything — a song, artist, film or mood; results appear as you type.', 'Tap a result to play it. The AI DJ builds a queue of matching songs behind it.', 'Tap the mini-player to open the full-screen player with synced lyrics.'] },
  { group: 'Listening', title: 'The full-screen player', steps: ['Flick the artwork up for the next song, down for the previous one. Double-tap the edges to seek ±10 s, the centre to like.', 'More options holds the sleep timer (minutes, end of song, or after 3/5/10 songs), A-B repeat, bookmarks, playback speed and “Share this moment”.', 'Ambient mode: leave the player alone for 45 seconds and it settles into artwork and a clock; tap to bring the controls back.'] },
  { group: 'Listening', title: 'Sleep, alarm and Drive mode', steps: ['Sleep timer fades the last 30 seconds out and stops on the minute.', 'Settings → Wake-up alarm plays your favourites, resumes, or plays a playlist you choose, with a gentle 30-second fade-in.', 'Drive mode (from the player) gives big targets and fewer distractions.'] },
  { group: 'Listening', title: 'Sound: equaliser, balance, mono', steps: ['Settings → Sound → turn on Sound effects.', 'Pick a preset or move the five bands; set left/right balance; switch on Mono for one-ear listening or Loudness normalisation for even volume.', 'If a source cannot be processed the status line says “Not available for this source” and playback continues untouched.'] },
  { group: 'Finding music', title: 'Search like a pro', steps: ['Results appear as you type; Enter opens the full results with Songs, Albums, Artists and Playlists tabs.', 'Sort songs by relevance, popularity, newest, length or A→Z; filter within long lists; Play all or Queue all.', 'Typos are caught with “Did you mean …?”, and recent searches can be pinned (hover or long-press).'] },
  { group: 'Finding music', title: 'Find a song by its lyrics', steps: ['Paste a line you remember into Search. Five words or more and VinaX offers Search by lyrics.', 'Matches show the lyric snippet; when the lyrics service has no hit, VinaX falls back to titles (many songs are named after their first line).', 'Tap a match to play it.'] },
  { group: 'Finding music', title: 'Explore, charts and hubs', steps: ['Explore: decade radio, pick a year, a language × mood grid and Surprise album.', 'Charts: Top 50 global, Top 50 for your country and Viral 50.', 'Every language has its own hub, and 72 language-mood pages (Telugu romantic, Hindi party …).'] },
  { group: 'Your music', title: 'Listen Later and playlists', steps: ['Choose Listen later in any song menu, or swipe a song row left. Swipe right adds it to the queue.', 'Playlists: pin, tag and filter by tag, add an emoji and description, sort, shuffle-play, remove duplicates, copy or share as text.', 'Deleted a playlist by mistake? Library → Recently deleted keeps it for seven days.'] },
  { group: 'Your music', title: 'Import a playlist from text', steps: ['Library → Import from text.', 'Paste one song per line as “Title — Artist” (a bare title works too).', 'VinaX finds each song and saves the playlist; Save & play starts it immediately.'] },
  { group: 'Your music', title: 'History and stats', steps: ['History: search it, filter by day, remove any entry, clear the last hour or today.', 'Your VinaX: a weekly report versus last week, a 12-week listening calendar with streaks, and a daily goal ring.', 'Any song menu → “Your history with this song” shows plays, completions and first/last time.'] },
  { group: 'VinaX AI', title: 'Chat, and make it play', steps: ['Open VinaX AI from the menu. Ask anything; attach photos or files; switch on the globe for live web answers with sources.', 'Any “Title — Artist” line in a reply becomes a playable card, with Play all, Queue all and Save as playlist.', 'Type “play <song>”, “next” or “pause” as a message for instant control with a live mini-player in the chat.'] },
  { group: 'VinaX AI', title: 'Slash commands and preferences', steps: ['Type / to open the menu: /playlist <vibe>, /now, /lyrics, /mood <mood>, /summary, /think, /web, /prompts, /export, /clear.', 'Reply in Telugu, Hindi, Tamil, Tenglish, Hinglish and more; choose a style — Brief, Detailed, Simple, Steps or Table.', '“Now playing on” lets the assistant see the song you are listening to. Paste a VinaX song link and it reads that song too.'] },
  { group: 'VinaX AI', title: 'Working with replies', steps: ['Follow-up chips suggest the next question after every substantial reply.', 'Shorten, Expand or Simplify an answer; Listen reads it aloud; Pin keeps it at the top; Branch continues from that point in a new chat.', 'Saved prompts (welcome screen or /prompts) keep your own library on this device.'] },
  { group: 'Look and feel', title: 'Themes, accents and festivals', steps: ['Settings → Theme: Dark, Black (AMOLED), Light, System or Auto (day/night). Ten accents, or Custom accent for any colour.', 'On 43 festivals the whole app takes on its own look — colours, glow, a greeting and a living backdrop — and returns to normal after. Settings → Festival themes switches it off.', 'Display size, High contrast, Reduce motion, Data saver and a Startup page are all in Settings; type in the Settings search box to find any of them.'] },
  { group: 'Together and devices', title: 'Listen Together', steps: ['Library → Listen Together → Start session, then share the room code or invite link.', 'Everyone hears the same second; guests request songs into your queue with credit; you stay the DJ.', '“End for all” closes the room for everyone.'] },
  { group: 'Together and devices', title: 'Move to a new device', steps: ['Old device: Settings → Your Data → Move to a new device (a one-time QR, or a 10-character code).', 'New device: on the welcome screen tap “Import your profile”, or Settings → Your Data → Import.', 'Favourites, playlists, history, stats and settings all come across; nothing is stored on a server.'] },
  { group: 'Together and devices', title: 'Android app', steps: ['Settings → Get the App. Background playback, the media notification, offline downloads and in-app updates.', 'Downloads: open a song’s menu → Download. Library → Downloaded only filters to what plays offline.', 'Push notifications bring one AI-chosen song a day at most, and owner announcements.'] },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Is VinaX really free? What’s the catch?', a: 'Free, forever, for everything — no subscriptions, no premium tiers, no login. Sponsored placements appear only on the Ads page, never in the player, and never in Kid mode.' },
  { q: 'Do I need an account?', a: 'Never. Your name is only used to greet you. Your taste profile, favourites, playlists, history, stats and downloads live on this device alone.' },
  { q: 'What data leaves my device?', a: 'Only anonymous, opt-in usage statistics (like “a song was played in this city”), which you can switch off in Settings. IP addresses are never stored; device ids are signed and peppered. VinaX AI receives the message thread and a short on-device taste snapshot to answer, and stores nothing but per-call success and latency.' },
  { q: 'How do the recommendations work without an account?', a: 'The taste profile is computed here: languages you pinned, songs you finish, like and skip, the hour and the day. Taste Profile shows what it learned and lets you fine-tune it; “Show fewer like…” and “Never play…” in any song menu steer it, and every one of those has Undo.' },
  { q: 'Why did the app change its colours and look?', a: 'A festival. VinaX celebrates 43 Indian festivals and special days — Sankranti, Holi, Ugadi, Eid, Onam, Ganesh Chaturthi, Bathukamma, Dussehra, Diwali, Christmas, New Year and more — each with its own colours, glow, greeting and living backdrop. It returns to your normal look the morning after. Settings → Festival themes turns it off.' },
  { q: 'What is VinaX AI?', a: 'A full assistant with 22 engines (or Auto), live web search with sources, Think and Research modes, code that runs, charts, diagrams, maths, voice chat, slash commands, and music you can play straight from the reply.' },
  { q: 'How do I control songs from the chat?', a: '“play <song>”, “queue <song>”, “pause”, “next” and “previous” work as messages, or use /now, /mood and /playlist. A play request answers with a live mini-player: controls, seek bar and the lyric being sung.' },
  { q: 'What do Think and Research do?', a: 'Think asks the engine to reason more carefully before it answers. Research checks the live web, cross-checks sources and cites them. When a search comes up empty, VinaX says so instead of guessing.' },
  { q: 'What is the Ctrl+K command palette?', a: 'Press Ctrl/⌘+K anywhere: jump to any page, fire player actions, or type a song name to find and play it.' },
  { q: 'What does the Queue page do?', a: 'The AI DJ’s home. The queue builds itself around what is playing, every upcoming song shows why it was picked, and the tune chips retune what comes next. Save the queue as a playlist any time.' },
  { q: 'What is the 🔔 bell on Home?', a: 'Your notification centre: the daily song pick, announcements and recent release notes.' },
  { q: 'How do I download songs for offline?', a: 'In the Android app, open a song’s menu and choose Download. Library, favourites and history browse offline with artwork; downloads play with no network.' },
  { q: 'Why did my music pause during a phone call?', a: 'Android pauses all audio for calls. VinaX resumes the moment the call ends.' },
  { q: 'A song won’t play — why?', a: 'Music streams from public catalogue sources that can be briefly unavailable. VinaX tries the next source automatically; try again in a moment or pick another version. Report broken track in the song menu tells the team.' },
  { q: 'Where are lyrics from, and what is “Meaning”?', a: 'Lyrics come from a public lyrics library, synced line by line. If a line lands early or late, nudge the offset in the lyrics view. Meaning, romanise and translate use VinaX AI.' },
  { q: 'What is the equaliser doing to my audio?', a: 'It processes the stream on your device with a five-band filter, balance, optional mono downmix and a gentle compressor for even loudness. Nothing is sent anywhere. If a source cannot be processed, the effects step aside and the song plays as normal.' },
  { q: 'Can I search a setting instead of scrolling?', a: 'Yes — the search box at the top of Settings filters every setting by name and description and highlights the match.' },
  { q: 'How do I move VinaX to a new device?', a: 'Settings → Your Data → Move to a new device beams everything with a one-time QR or code; or export a file and import it on the new device.' },
  { q: 'How do I export or erase everything?', a: 'Settings → Your Data. Export downloads one file with everything; the clear buttons erase history, favourites, queue, cached data or the whole profile, with a deletion receipt.' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['N / P', 'Next / previous song'],
  ['← / →', 'Seek 10 seconds'],
  ['F', 'Like the current song'],
  ['⌘/Ctrl + K', 'Command palette · new chat (in VinaX AI)'],
  ['/', 'Slash commands (in the VinaX AI composer)'],
  ['Right-click / long-press', 'Song menu anywhere'],
  ['Esc', 'Stop AI generation · close overlays · leave a tutorial'],
  ['Flick artwork ↑ / ↓', 'Next / previous song'],
  ['Double-tap artwork edge / centre', 'Seek ±10 s / like'],
  ['Swipe a song row → / ←', 'Add to queue / Listen Later'],
];

function match(q: string, ...texts: string[]): boolean {
  if (!q) return true;
  const hay = texts.join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export default function HelpPage() {
  const clientCfg = useClientConfig();
  usePageTitle('Help & Feedback');
  const openTour = useUiStore((s) => s.openTour);
  const startTutorial = useTutorialStore((s) => s.start);
  const done = useTutorialStore((s) => s.done);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'bug' | 'idea' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState(true);
  const [sending, setSending] = useState(false);
  const q = query.trim();

  const guides = useMemo(() => GUIDES.filter((g) => match(q, g.group, g.title, ...g.steps)), [q]);
  const faq = useMemo(() => [...(clientCfg?.faq ?? []), ...FAQ].filter((f) => match(q, f.q, f.a)), [q, clientCfg]);
  const shortcuts = useMemo(() => SHORTCUTS.filter(([k, v]) => match(q, k, v)), [q]);
  const groups = useMemo(() => Array.from(new Set(guides.map((g) => g.group))), [guides]);
  const latest = CHANGELOG_V2[LATEST_VERSION];
  const nothing = q && !guides.length && !faq.length && !shortcuts.length;

  const submit = async () => {
    const text = message.trim();
    if (!text) {
      toast('Please write a message first');
      return;
    }
    setSending(true);
    const diag = diagnostics
      ? ` [${DISPLAY_VERSION} · ${isNativePlatform() ? 'app' : 'web'} · ${window.innerWidth}×${window.innerHeight} · ${navigator.language} · ${document.documentElement.classList.contains('light') ? 'light' : 'dark'}${document.documentElement.className.match(/fest-[a-z]+/)?.[0] ? ' · ' + document.documentElement.className.match(/fest-[a-z]+/)?.[0] : ''}]`
      : '';
    const ok = await sendFeedback(type, text + diag);
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
      <PageHeader title="Help & Feedback" subtitle="Live tutorials, guides, answers — and a direct line to the team." />

      <div className="relative mb-5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help… (lyrics, sleep timer, festival, equaliser)"
          aria-label="Search help"
          className="w-full glass-input pl-4 pr-10 py-2.5 rounded-full text-sm outline-none focus:ring-1 focus:ring-ink-100/40"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-100 text-sm font-bold">×</button>
        )}
      </div>
      {nothing && <p className="mb-5 text-sm text-ink-400">Nothing matches “{q}”. Try another word, or ask below and the team will answer.</p>}

      {!q && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <div className="flex items-end justify-between gap-3 mb-1">
            <h2 className="text-base font-bold">Live tutorials</h2>
            <span className="text-[11px] text-ink-400">{done.length}/{TUTORIALS.length} done</span>
          </div>
          <p className="text-xs text-ink-400 mb-3">Guided walkthroughs inside the real app. The first one starts a song so you can hear every control.</p>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {TUTORIALS.map((t) => (
              <button
                key={t.id}
                onClick={() => startTutorial(t.id)}
                className={cn('text-left rounded-2xl border border-glass bg-[var(--tile)] p-3.5 hover:border-glass-strong transition-colors', done.includes(t.id) && 'opacity-80')}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl" aria-hidden>{t.emoji}</span>
                  <p className="font-bold text-sm flex-1 min-w-0 truncate">{t.title}</p>
                  {done.includes(t.id) && <span className="text-[10px] font-bold text-ember-400">DONE</span>}
                </div>
                <p className="mt-1 text-xs text-ink-300 leading-relaxed">{t.blurb}</p>
                <p className="mt-2 text-[11px] font-semibold text-ink-400">{t.minutes} min{t.playsMusic ? ' · plays music' : ''} · {t.steps.length} steps</p>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={openTour} className="btn-secondary px-4 py-2 text-xs font-bold">Replay the welcome tour</button>
            <Link to="/settings" className="btn-secondary px-4 py-2 text-xs font-bold">Open Settings</Link>
          </div>
        </section>
      )}

      {!q && latest && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-base font-bold">What’s new in {DISPLAY_VERSION}</h2>
            {latest.title && <span className="text-[11px] text-ink-400 truncate">{latest.title}</span>}
          </div>
          <ul className="space-y-1.5">
            {latest.changes.slice(0, 4).map((c) => (
              <li key={c.text} className="text-sm text-ink-200 leading-relaxed flex gap-2">
                <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', c.type === 'new' ? 'bg-ember-400' : c.type === 'fixed' ? 'bg-tide-400' : 'bg-ink-400')} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {guides.length > 0 && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <h2 className="text-base font-bold mb-3">How to use VinaX</h2>
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-1.5">{group}</p>
                <div className="divide-y divide-ink-800">
                  {guides.filter((g) => g.group === group).map((g) => (
                    <details key={g.title} className="py-2 group" open={!!q}>
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold py-1">
                        {g.title}
                        <span className="text-ink-500 group-open:rotate-180 transition-transform">⌄</span>
                      </summary>
                      <ol className="mt-1 mb-1 space-y-1.5 pl-5 list-decimal text-sm text-ink-300 leading-relaxed">
                        {g.steps.map((s) => <li key={s}>{s}</li>)}
                      </ol>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {faq.length > 0 && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <h2 className="text-base font-bold mb-3">FAQ</h2>
          <div className="divide-y divide-ink-800">
            {faq.map((f) => (
              <details key={f.q} className="py-2 group" open={!!q}>
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-semibold py-1">
                  {f.q}
                  <span className="text-ink-500 group-open:rotate-180 transition-transform">⌄</span>
                </summary>
                <p className="text-sm text-ink-300 leading-relaxed pb-2 pt-1">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {shortcuts.length > 0 && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <h2 className="text-base font-bold mb-3">Keyboard & gesture reference</h2>
          <div className="space-y-1.5">
            {shortcuts.map(([k, v]) => (
              <p key={k} className="text-sm text-ink-200">
                <span className="inline-block min-w-44 font-mono text-xs bg-ink-800/70 rounded-md px-2 py-1 mr-2">{k}</span>
                {v}
              </p>
            ))}
          </div>
        </section>
      )}

      {!q && (
        <section className="glass-panel rounded-2xl p-5 mb-5">
          <h2 className="text-base font-bold mb-2">Copyright & legal</h2>
          <p className="text-sm text-ink-200 leading-relaxed mb-2">
            VinaX is a free player. Music, artwork and lyrics stream from third-party public catalogues — VinaX hosts no
            media files and sells nothing. All songs, recordings, artwork and lyrics remain the property of their
            respective artists, labels and rights holders.
          </p>
          <p className="text-sm text-ink-200 leading-relaxed mb-3">
            Rights holders can request removal of any content at any time — see the DMCA / takedown page. Your personal
            data never leaves your device except anonymous, opt-in usage statistics.
          </p>
          <p className="text-sm">
            <Link to="/terms" className="text-ember-400 hover:underline">Terms of Use</Link> ·{' '}
            <Link to="/privacy" className="text-ember-400 hover:underline">Privacy</Link> ·{' '}
            <Link to="/dmca" className="text-ember-400 hover:underline">DMCA & takedowns</Link> ·{' '}
            <Link to="/contact" className="text-ember-400 hover:underline">Contact</Link> ·{' '}
            <a href="https://status.sirimillavinay.online" target="_blank" rel="noreferrer" className="text-ember-400 hover:underline">Status</a>
          </p>
        </section>
      )}

      <section className="glass-panel rounded-2xl p-5">
        <h2 className="text-base font-bold mb-1">Report a bug or share an idea</h2>
        <p className="text-xs text-ink-400 mb-3">Goes straight to the VinaX team. A coarse location (city level) is included to help reproduce issues; nothing personal.</p>
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
          placeholder={type === 'bug' ? 'What happened, what you expected, and the song or page if it matters…' : 'Tell us what you’d love to see…'}
          rows={4}
          maxLength={2000}
          className="glass-input w-full px-4 py-3 rounded-xl text-sm resize-none"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-300">
          <input type="checkbox" checked={diagnostics} onChange={(e) => setDiagnostics(e.target.checked)} className="accent-[rgb(var(--ember-500))]" />
          Include app version, platform, screen size, language and theme
        </label>
        <button onClick={() => void submit()} disabled={sending} className="mt-3 px-5 py-2.5 rounded-full btn-primary">
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </section>
    </div>
  );
}
