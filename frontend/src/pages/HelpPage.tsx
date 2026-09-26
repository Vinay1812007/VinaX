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
import { IconButton } from '@/components/IconButton';
import { ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

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
  { group: 'Recommendations', title: 'Home and “Popular picks for you”', steps: ['The play button on the Aura Mix card starts a mix built from your pinned languages and your listening on this device.', '“Popular picks for you” is what is popular in the catalogue, put in the order your taste suggests; with AI-designed shelves on, VinaX AI orders it. Public charts, with their source and update time, are on the Charts page.', 'Home shows a song once: a song already in an earlier shelf is left out of later ones. Home Studio reorders or hides shelves.'] },
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
  { q: 'How do the recommendations work without an account?', a: 'The taste profile is computed on this device from the languages you pinned and the songs you finish, like and skip. Taste Profile shows what it learned and lets you adjust it; “More like this”, “Less like this…” (for 7, 14 or 30 days) and “Never play…” in a song menu steer it, each with Undo. Settings → Recommendations lists every artist you are hearing less of, with the date they come back.' },
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
    <div className="vx-sec">
      <PageHeader title="Help & feedback" />

      <div className="vx-search-field">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help"
          aria-label="Search help"
          className="vx-field"
        />
        {query && (
          <IconButton label="Clear search" size="sm" onClick={() => setQuery('')}>
            <XIcon className="w-4 h-4" />
          </IconButton>
        )}
      </div>
      {nothing && <p className="vx-sec-lede mt-0">Nothing matches “{q}”. Try another word, or ask the team below.</p>}

      {!q && (
        <section className="vx-sec-block" aria-labelledby="vx-help-tutorials">
          <div className="vx-sec-title-row">
            <h2 id="vx-help-tutorials" className="vx-sec-title">Live tutorials</h2>
            <span className="vx-sec-meta tabular-nums">{done.length} of {TUTORIALS.length} done</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {TUTORIALS.map((t) => (
              <button
                key={t.id}
                onClick={() => startTutorial(t.id)}
                className="vx-help-tile text-left"
              >
                <span className="vx-row-lead" aria-hidden>{t.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="vx-row-label truncate flex-1">{t.title}</span>
                    {done.includes(t.id) && <span className="text-[12px] font-semibold text-ink-400">Done</span>}
                  </span>
                  <span className="vx-row-hint">{t.blurb}</span>
                  <span className="mt-2 block text-[12px] font-medium text-ink-400">
                    {t.minutes} min{t.playsMusic ? ' · plays music' : ''} · {t.steps.length} steps
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="vx-sec-actions mt-4">
            <button onClick={openTour} className="vx-pill-btn">Replay the welcome tour</button>
            <Link to="/settings" className="vx-pill-btn">Open Settings</Link>
          </div>
        </section>
      )}

      {!q && latest && (
        <section className="vx-sec-block" aria-labelledby="vx-help-new">
          <div className="vx-sec-title-row">
            <h2 id="vx-help-new" className="vx-sec-title">What’s new in {DISPLAY_VERSION}</h2>
            {latest.title && <span className="vx-sec-meta truncate">{latest.title}</span>}
          </div>
          <ul className="vx-group">
            {latest.changes.slice(0, 4).map((c) => (
              <li key={c.text} className="vx-row text-[14px] text-ink-200 leading-relaxed" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
                <span className={cn('mt-[9px] w-1.5 h-1.5 rounded-full shrink-0', c.type === 'new' ? 'bg-ember-500' : 'bg-ink-400')} aria-hidden />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {guides.length > 0 && (
        <section className="vx-sec-block" aria-labelledby="vx-help-guides">
          <h2 id="vx-help-guides" className="vx-sec-title">How to use VinaX</h2>
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group}>
                <p className="vx-sec-caption">{group}</p>
                <div className="vx-group">
                  {guides.filter((g) => g.group === group).map((g) => (
                    <details key={g.title} open={!!q}>
                      <summary className="vx-row">
                        <span className="vx-row-main vx-row-label">{g.title}</span>
                        <ChevronDownIcon className="vx-row-toggle" />
                      </summary>
                      <div className="vx-disclose-body">
                        <ol>
                          {g.steps.map((st) => <li key={st}>{st}</li>)}
                        </ol>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {faq.length > 0 && (
        <section className="vx-sec-block" aria-labelledby="vx-help-faq">
          <h2 id="vx-help-faq" className="vx-sec-title">Questions</h2>
          <div className="vx-group">
            {faq.map((f) => (
              <details key={f.q} open={!!q}>
                <summary className="vx-row">
                  <span className="vx-row-main vx-row-label">{f.q}</span>
                  <ChevronDownIcon className="vx-row-toggle" />
                </summary>
                <p className="vx-disclose-body">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {shortcuts.length > 0 && (
        <section className="vx-sec-block" aria-labelledby="vx-help-keys">
          <h2 id="vx-help-keys" className="vx-sec-title">Keyboard and gestures</h2>
          <div className="vx-group">
            {shortcuts.map(([k, v]) => (
              <div key={k} className="vx-row">
                <span className="vx-row-main text-[14px] text-ink-200">{v}</span>
                <kbd className="shrink-0 rounded-md bg-ink-100/[0.08] px-2 py-1 font-sans text-[12px] font-semibold text-ink-100 text-right">{k}</kbd>
              </div>
            ))}
          </div>
        </section>
      )}

      {!q && (
        <section className="vx-sec-block" aria-labelledby="vx-help-legal">
          <h2 id="vx-help-legal" className="vx-sec-title">Copyright and legal</h2>
          <p className="vx-sec-lede">
            VinaX hosts no media files and sells nothing. Songs, recordings, artwork and lyrics belong to their artists,
            labels and rights holders, who can request removal at any time.
          </p>
          <nav aria-label="Legal" className="vx-group">
            <Link to="/terms" className="vx-row is-link"><span className="vx-row-main vx-row-label">Terms of use</span><ChevronRightIcon className="vx-row-chev" /></Link>
            <Link to="/privacy" className="vx-row is-link"><span className="vx-row-main vx-row-label">Privacy</span><ChevronRightIcon className="vx-row-chev" /></Link>
            <Link to="/dmca" className="vx-row is-link"><span className="vx-row-main vx-row-label">Copyright and takedowns</span><ChevronRightIcon className="vx-row-chev" /></Link>
            <Link to="/contact" className="vx-row is-link"><span className="vx-row-main vx-row-label">Contact</span><ChevronRightIcon className="vx-row-chev" /></Link>
            <a href="https://status.sirimillavinay.online" target="_blank" rel="noreferrer" className="vx-row is-link">
              <span className="vx-row-main vx-row-label">Service status</span>
              <ChevronRightIcon className="vx-row-chev" />
            </a>
          </nav>
        </section>
      )}

      <section className="vx-sec-block" aria-labelledby="vx-help-feedback">
        <h2 id="vx-help-feedback" className="vx-sec-title">Report a bug or share an idea</h2>
        <p className="vx-sec-lede">Goes straight to the VinaX team, with a city-level location to help reproduce issues.</p>
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
          aria-label="Your message"
          className="vx-field"
        />
        <label className="mt-3 flex items-center gap-2.5 min-h-[44px] text-[14px] text-ink-300">
          <input type="checkbox" checked={diagnostics} onChange={(e) => setDiagnostics(e.target.checked)} className="w-4 h-4 accent-[rgb(var(--ember-500))]" />
          Include app version, platform, screen size, language and theme
        </label>
        <button onClick={() => void submit()} disabled={sending} className="mt-2 px-6 py-3 rounded-full btn-primary">
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </section>
    </div>
  );
}
