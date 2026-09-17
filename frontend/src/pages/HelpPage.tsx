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
 * v5.20.0 — Help & Feedback, rebuilt around what the app can do today
 * (guides, FAQ and shortcuts rewritten for 7.1):
 * live tutorials that run inside the real app, searchable guides and FAQ,
 * the latest update card, shortcuts, legal, and the feedback form with
 * optional diagnostics. Every claim here must be true today.
 */

interface Guide { group: string; title: string; steps: string[] }

const GUIDES: Guide[] = [
  { group: 'Getting around', title: 'Five destinations and the top bar', steps: ['Home, Discover, Search, Library and VinaX AI are the five destinations: a dock at the bottom on phones, a sidebar on wider screens.', 'The top bar names the page you are on and holds its actions, plus the link to Settings. It has no search box: Search is its own destination.', 'Press ⌘/Ctrl+K on a keyboard for the command palette: pages, player actions and songs in one place.'] },
  { group: 'Getting around', title: 'Discover and its shortcuts', steps: ['Discover opens with a shortcut grid: Charts, Languages, Moods, Regions, Movies, Videos, Made For You, Your Week, AI Playlist and Ads.', 'Below it, pick a language and a mood to change the shelves: trending, mood picks, playlists, new releases and film soundtracks.', 'Library has its own grid: Favorites, Listen Later, Downloads, History, Your VinaX and Taste Profile.'] },
  { group: 'Listening', title: 'Tap a song: the DJ builds the next five', steps: ['Tap any song, in a shelf, an album or a playlist. It starts alone and the DJ builds what follows from it.', 'A continuation is the next five songs, always in the language of the song you tapped. It opens with familiar songs and introduces newer artists gradually.', 'Settings → Recommendations → “DJ builds every queue” turns this off, so playback follows the list you tapped instead.'] },
  { group: 'Listening', title: 'Pin a mood and Tune this queue', steps: ['Tune this queue is on the Queue page and under More options in the full-screen player: More energetic, More chill, Same language, Surprise me and others.', 'Pin a mood is in the full-screen player’s Up Next tab: Romantic, Energetic, Chill, Melancholy or Devotional. A pin holds for 45 minutes; tap it again to unpin.', 'Both rebuild Up Next at once with songs fetched for that choice. Songs that already played, the current song and songs you queued by hand stay where they are.'] },
  { group: 'Listening', title: 'Your queue: hand-queued songs go first', steps: ['Play next and Add to queue are in every song menu (right-click or long-press). On touch screens, swiping a song row right also adds it to the queue.', 'Songs you queue by hand play before anything the DJ added, and a rebuild never removes them.', 'On the Queue page, drag to reorder, remove songs, sort what is coming up, or save the queue as a playlist. Build a queue plans a longer session.'] },
  { group: 'Listening', title: 'The full-screen player', steps: ['Flick the artwork up for the next song, down for the previous one. Double-tap the edges to seek, the centre to like.', 'More options holds playback speed, the sleep timer (15, 30 or 60 minutes, end of song, or after 3, 5 or 10 songs), A-B repeat, bookmarks and “Share this moment”.', 'Ambient mode: leave the player alone for 45 seconds and it settles into artwork and a clock; tap to bring the controls back.'] },
  { group: 'Listening', title: 'Sleep, alarm and Drive mode', steps: ['The sleep timer fades the last 30 seconds out before it stops.', 'Settings → Wake-up alarm starts music at a time you set, with a gentle fade-in.', 'Drive mode (from the full-screen player) gives big targets and fewer distractions.'] },
  { group: 'Listening', title: 'Sound: equaliser, balance, mono', steps: ['Settings → Sound → turn on Sound effects.', 'Pick a preset or move the five bands; set left/right balance; switch on Mono for one-ear listening or Loudness normalisation for even volume.', 'If a source cannot be processed the status line says “Not available for this source” and playback continues untouched.'] },
  { group: 'Recommendations', title: 'Familiar, Balanced or Discover', steps: ['Settings → Recommendations → Discovery. Familiar brings back favourites and songs you finished; new artists are rare.', 'Balanced is mostly your taste with about one new artist in every four or five songs. Discover ranks never-played artists higher.', 'In every mode a queue stays in the language of its song and opens with a familiar hand-off.'] },
  { group: 'Recommendations', title: 'Home and “Trending for you”', steps: ['Play my mix starts a mix built from your pinned languages and your listening on this device.', '“Trending for you” is the current trending pool put in the order your taste suggests; with AI-designed shelves on, VinaX AI orders it.', 'Home shows a song once: a song already in an earlier shelf is left out of later ones. Home Studio reorders or hides shelves.'] },
  { group: 'Finding music', title: 'Search', steps: ['Results appear as you type; Enter opens the full results with All, Songs, Albums, Artists and Playlists tabs.', 'Sort songs by relevance, popularity, newest, length or A to Z, then Play all or Queue all.', 'A search with no songs offers “Did you mean …?”. Recent searches can be pinned (hover or long-press).'] },
  { group: 'Finding music', title: 'Find a song by its lyrics', steps: ['Type a line you remember into Search. With five words or more VinaX offers Search by lyrics.', 'Matches show the lyric snippet; when the lyrics service has no hit, VinaX falls back to titles.', 'Tap a match to play it.'] },
  { group: 'Your music', title: 'Listen Later and playlists', steps: ['Choose Listen later in any song menu, or swipe a song row left on a touch screen.', 'Playlists: pin, tag and filter by tag, sort, shuffle-play and remove duplicates.', 'Deleted a playlist by mistake? Library → Recently deleted keeps it for seven days.'] },
  { group: 'Your music', title: 'Import a playlist from text', steps: ['Library → Import from text.', 'Paste one song per line as “Title — Artist” (a bare title works too).', 'Review the matches, then save the playlist.'] },
  { group: 'Your music', title: 'Back up, restore and Undo', steps: ['Settings → Your Data → Export a backup downloads one file with your settings, library, history, taste profile and more. Downloaded audio is never included.', 'Backup Center → Choose a backup file shows what the file holds next to what is on this device. Choose Merge or Replace, untick categories you do not want, then restore.', 'Changed your mind? Open Backup Center again in the same tab and use “Undo that restore”. The undo copy lasts until you close the tab.'] },
  { group: 'Your music', title: 'History and stats', steps: ['History: search it, filter by date, remove an entry, clear the last hour or today.', 'Your VinaX: your listening report, a 12-week listening calendar and a daily goal ring.', 'Any song menu → “Your history with this song” shows plays, completions and first/last time.'] },
  { group: 'VinaX AI', title: 'Chat, and make it play', steps: ['Open VinaX AI from the dock or sidebar. Ask anything. The + button uploads files or a folder and switches on Web search, Think, Research or image creation.', 'Any “Title — Artist” line in a reply becomes a playable card, with Play all and Save as playlist.', '“play <song>”, “queue <song>”, “pause”, “next” and “previous” work as messages.'] },
  { group: 'VinaX AI', title: 'The model menu and Agent mode', steps: ['The model button in the composer opens one menu with a search field over every model VinaX can reach: recently used first, then recommended, then each catalogue.', 'Auto picks an engine for each question. Chat settings → General sets the default model.', 'Agent mode uses an agent-capable model that can search the web and run code by itself. The button is greyed out when no agent model is available; while it is on, the model menu lists agent models only.'] },
  { group: 'VinaX AI', title: 'Slash commands and chat settings', steps: ['Type / to open the menu: /playlist <vibe>, /now, /lyrics, /mood <mood>, /summary, /think, /web, /prompts, /export, /clear. Tab completes.', 'Chat settings has five tabs: General (text size, default model, Send with Enter, Start in Agent mode), Replies (language, style, About you), Voice, Data (export, import or clear chats) and Shortcuts.', 'Your messages and a short taste summary go to the AI service to answer. Your library stays on this device.'] },
  { group: 'Look and feel', title: 'Themes, accents and festivals', steps: ['Settings → Theme: Dark, Black, Light, System or Auto (day/night). Pick an accent, or Custom accent for any colour.', 'On festival days the app takes on a festive look and returns to normal after. Settings → Festival themes switches it off.', 'Type in the Settings search box to find any setting by name.'] },
  { group: 'Together and devices', title: 'Listen Together', steps: ['Library → Listen Together → Start session, then share the room code or invite link.', 'Guests hear what you play and can request songs; you stay in control of the queue.', '“End for all” closes the room for everyone.'] },
  { group: 'Together and devices', title: 'Move to a new device', steps: ['Old device: Settings → Your Data → Move to a new device shows a one-time QR and a 10-character code.', 'New device: on the welcome screen tap “Move from old device” and scan or type the code — or tap “Import a file” to restore a backup file.', 'The handoff is parked for 10 minutes and works once.'] },
  { group: 'Together and devices', title: 'Android app', steps: ['The Android app adds background playback with a media notification, offline downloads and in-app updates.', 'Downloads: open a song’s menu → Download. Library → Downloaded only filters to what plays offline.', 'Settings → Notifications turns push notifications on or off.'] },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: 'Is VinaX free?', a: 'Yes. There are no subscriptions, no premium tiers and no login. Sponsored placements appear only on the Ads page, never in the player.' },
  { q: 'Do I need an account?', a: 'No. You choose a display name and a username; there is no password or login. Your taste profile, favourites, playlists, history, stats and downloads live on this device.' },
  { q: 'What data leaves my device?', a: 'Searches and song requests go to the catalogue so music can play. VinaX AI and the AI DJ receive your message or a short taste summary to answer. Your username is confirmed with the service. Anonymous usage statistics with a city-level location are sent only if you opt in — on the welcome screen, or later in Settings → Region & Privacy.' },
  { q: 'How do the recommendations work without an account?', a: 'The taste profile is computed on this device from the languages you pinned and the songs you finish, like and skip. Taste Profile shows what it learned and lets you adjust it; “Not interested”, “Show fewer like…” and “Never play…” in a song menu steer it, each with Undo.' },
  { q: 'Why are there only five songs in Up Next?', a: 'The DJ builds the next five at a time and adds more as you listen, so it can follow what you skip and finish in this sitting.' },
  { q: 'Why did Up Next stay in one language?', a: 'A continuation always stays in the language of the song that started it, in every discovery mode. Tune this queue → Switch language changes it on purpose.' },
  { q: 'I pinned a mood. What changed?', a: 'Up Next was rebuilt at once with songs fetched for that mood, in the queue’s language. Songs you queued by hand kept their place. The pin holds for 45 minutes or until you unpin it.' },
  { q: 'Do songs I queue myself get replaced?', a: 'No. Songs added with Play next or Add to queue play before the DJ’s picks and survive every rebuild.' },
  { q: 'What do Familiar, Balanced and Discover change?', a: 'How many never-played artists reach your queue and how they rank. Familiar keeps them rare, Balanced adds about one in every four or five songs, Discover fills close to half of a queue with them after a familiar opening.' },
  { q: 'Why did the app change its colours and look?', a: 'A festival. VinaX marks festivals and special days with their own colours, glow and greeting, then returns to your normal look. Settings → Festival themes turns it off.' },
  { q: 'What is VinaX AI?', a: 'A chat assistant with a searchable menu of models, an Agent mode, optional web search, Think and Research, slash commands, voice chat, and songs you can play straight from a reply.' },
  { q: 'What do Think, Research and Agent mode do?', a: 'Think sends the message to a slower, more careful engine. Research searches the web and cross-checks more than one source. Agent mode lets an agent-capable model search the web and run code by itself.' },
  { q: 'How do I control songs from the chat?', a: '“play <song>”, “queue <song>”, “pause”, “next” and “previous” work as messages, or use /now, /mood and /playlist.' },
  { q: 'What is the Ctrl+K command palette?', a: 'Press Ctrl/⌘+K anywhere: jump to any page, fire player actions, or type a song name to find and play it. Inside VinaX AI the same keys start a new chat.' },
  { q: 'What does the Queue page do?', a: 'View, reorder, sort or remove upcoming songs, tune the queue, build a longer queue, and save the queue as a playlist.' },
  { q: 'Where are notifications?', a: 'The bell in Home’s top bar opens the notification centre: song picks, announcements and recent release notes.' },
  { q: 'How do I download songs for offline?', a: 'In the Android app, open a song’s menu and choose Download. Downloads play with no network.' },
  { q: 'A song won’t play — why?', a: 'Music streams from public catalogue sources that can be briefly unavailable. VinaX tries the next source automatically; try again in a moment or pick another version. Report broken track in the song menu tells the team.' },
  { q: 'Where are lyrics from, and what is “Meaning”?', a: 'Lyrics come from a public lyrics library, synced line by line when timing is available. If a line lands early or late, nudge the offset in the lyrics view. Meaning, romanise and translate use VinaX AI.' },
  { q: 'What is the equaliser doing to my audio?', a: 'It processes the stream on your device with a five-band filter, balance, optional mono downmix and loudness normalisation. If a source cannot be processed, the effects step aside and the song plays as normal.' },
  { q: 'Can I search a setting instead of scrolling?', a: 'Yes — the search box at the top of Settings filters every setting by name and description.' },
  { q: 'How do I move VinaX to a new device?', a: 'Settings → Your Data → Move to a new device hands everything over with a one-time QR or code; or export a backup file and import it on the new device.' },
  { q: 'Can I undo a restore?', a: 'Yes, in the same tab. Backup Center keeps the previous data until you close the tab and shows “Undo that restore”.' },
  { q: 'How do I export or erase everything?', a: 'Settings → Your Data. Export a backup downloads one file; the clear rows erase history, favourites, the queue, cached data or the personalization profile, and Reset app state erases everything on this device.' },
];

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['N / P', 'Next / previous song'],
  ['← / →', 'Seek 10 seconds back / forward'],
  ['↑ / ↓', 'Volume up / down'],
  ['M', 'Mute / unmute'],
  ['S', 'Shuffle on / off'],
  ['R', 'Cycle repeat'],
  ['F', 'Like the current song'],
  ['?', 'Show the shortcut list'],
  ['⌘/Ctrl + K', 'Command palette · new chat (in VinaX AI)'],
  ['⌘/Ctrl + B', 'Show or hide the chat list (in VinaX AI)'],
  ['/', 'Slash commands (in the VinaX AI composer)'],
  ['Right-click / long-press', 'Song menu anywhere'],
  ['Esc', 'Stop AI generation · close overlays · leave a tutorial'],
  ['Flick artwork ↑ / ↓', 'Next / previous song'],
  ['Double-tap artwork edge / centre', 'Seek / like'],
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
          placeholder="Search help… (queue, mood, backup, lyrics, equaliser)"
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
            data never leaves your device except anonymous usage statistics, which are off unless you opt in (Settings → Region &amp; Privacy).
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
