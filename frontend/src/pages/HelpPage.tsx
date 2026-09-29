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
import { FAQ, GUIDES, SHORTCUTS } from '@/features/help/helpContent';
import '@/styles/pages/secondary.css';

/**
 * v5.20.0 — Help & Feedback, rebuilt around what the app can do today
 * (guides, FAQ and shortcuts rewritten for 7.1):
 * live tutorials that run inside the real app, searchable guides and FAQ,
 * the latest update card, shortcuts, legal, and the feedback form with
 * optional diagnostics. Every claim here must be true today.
 */

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
