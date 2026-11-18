import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { Chip } from '@/components/Chip';
import { toast } from '@/store/toastStore';
import { sendFeedback } from '@/services/feedback';
import { isReadOnly, READ_ONLY_MESSAGE } from '@/services/siteMode';
import { useUiStore } from '@/store/uiStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { useClientConfig } from '@/features/home/useAppConfig';
import { TUTORIALS } from '@/features/tutorials/tutorials';
import { CHANGELOG_V2 } from '@/constants/changelog';
import { DISPLAY_VERSION, LATEST_VERSION } from '@/constants/version';
import { isNativePlatform } from '@/services/native';
import { cn } from '@/utils/cn';
import { IconButton } from '@/components/IconButton';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from '@/components/Icons';
import { FAQ, GUIDES, SHORTCUTS } from '@/features/help/helpContent';
import { helpUi, localFaq, localGuide, localShortcut, localTour, useHelpTranslation } from '@/features/help/helpI18n';
import type { HelpUiKey } from '@/i18n/help/types';
import '@/styles/pages/secondary.css';

/**
 * v5.20.0 — Help & Feedback, rebuilt around what the app can do today
 * (guides, FAQ and shortcuts rewritten for 7.1):
 * live tutorials that run inside the real app, searchable guides and FAQ,
 * the latest update card, shortcuts, legal, and the feedback form with
 * optional diagnostics. Every claim here must be true today.
 *
 * 9.0 — sections are SectionHeader titles over hairline lists; the tutorial
 * tiles stay cards because each one starts something.
 *
 * In Telugu, Hindi or Tamil the page, guides, questions, shortcuts and tour
 * tiles come from that language's lazy Help file (features/help/helpI18n);
 * search matches the translated and the English words.
 */

function match(q: string, ...texts: string[]): boolean {
  if (!q) return true;
  const hay = texts.join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const LEGAL: Array<{ to: string; label: HelpUiKey }> = [
  { to: '/terms', label: 'Terms of use' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/dmca', label: 'Copyright and takedowns' },
  { to: '/contact', label: 'Contact' },
];

export default function HelpPage() {
  const clientCfg = useClientConfig();
  usePageTitle('Help & Feedback');
  const openTour = useUiStore((s) => s.openTour);
  const navigate = useNavigate();
  const startTour = useTutorialStore((s) => s.start);
  const tr = useHelpTranslation();
  const t = helpUi(tr);
  // A tour that needs something first (a live room) says so instead of pointing at nothing.
  const startTutorial = (id: string) => {
    const tour = TUTORIALS.find((x) => x.id === id);
    const why = tour && localTour(tour, tr, tour.needs?.()).needs;
    if (why) toast(why, { action: { label: t('Open Listen Together'), onClick: () => navigate('/together') } });
    else startTour(id);
  };
  const done = useTutorialStore((s) => s.done);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'bug' | 'idea' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState(true);
  const [sending, setSending] = useState(false);
  const q = query.trim();

  // Search finds a guide by its translated words and by its English ones.
  const guides = useMemo(
    () => GUIDES.map((en) => ({ en, g: localGuide(en, tr) }))
      .filter(({ en, g }) => match(q, g.group, g.title, ...g.steps, ...(g === en ? [] : [en.group, en.title, ...en.steps])))
      .map(({ g }) => g),
    [q, tr],
  );
  // The owner's questions first, grouped by their category (App Settings → Help Center), then the built-in ones.
  const faq = useMemo(() => {
    const own = clientCfg?.faq ?? [];
    const cats: string[] = [];
    for (const f of own) if (!cats.includes(f.category ?? '')) cats.push(f.category ?? '');
    const grouped = cats.flatMap((c) => own.filter((f) => (f.category ?? '') === c));
    const all: Array<{ q: string; a: string; category?: string; en?: string }> = [
      ...grouped,
      ...FAQ.map((en) => {
        const f = localFaq(en, tr);
        return { q: f.q, a: f.a, en: f === en ? undefined : `${en.q} ${en.a}` };
      }),
    ];
    return all.filter((f) => match(q, f.q, f.a, f.category ?? '', f.en ?? ''));
  }, [q, clientCfg, tr]);
  const shortcuts = useMemo(
    () => SHORTCUTS.map(([k, v]) => [k, localShortcut(v, tr), v] as const).filter(([k, v, en]) => match(q, k, v, en)),
    [q, tr],
  );
  const groups = useMemo(() => Array.from(new Set(guides.map((g) => g.group))), [guides]);
  const latest = CHANGELOG_V2[LATEST_VERSION];
  const nothing = q && !guides.length && !faq.length && !shortcuts.length;

  const submit = async () => {
    const text = message.trim();
    if (!text) {
      toast(t('Please write a message first'));
      return;
    }
    setSending(true);
    const diag = diagnostics
      ? ` [${DISPLAY_VERSION} · ${isNativePlatform() ? 'app' : 'web'} · ${window.innerWidth}×${window.innerHeight} · ${navigator.language} · ${document.documentElement.classList.contains('light') ? 'light' : 'dark'}]`
      : '';
    const ok = await sendFeedback(type, text + diag);
    setSending(false);
    if (ok) {
      setMessage('');
      toast(t('Thanks. Your feedback was sent.'));
    } else {
      toast(isReadOnly() ? READ_ONLY_MESSAGE : t('Could not send — check your connection and try again.'));
    }
  };

  return (
    <div className="vx-sec">
      <PageHeader title={t('Help & feedback')} subtitle={t('Guides for every feature, answers, and a line to the VinaX team.')} />

      <div className="vx-search-field">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('Search help')}
          aria-label={t('Search help')}
          type="search"
          enterKeyHint="search"
          className="vx-sec-field"
        />
        {query && (
          <IconButton label={t('Clear search')} size="sm" onClick={() => setQuery('')}>
            <XIcon className="w-4 h-4" />
          </IconButton>
        )}
      </div>
      {nothing && (
        <p role="status" className="vx-sec-lede !mt-0">
          {t('Nothing matches “{q}”. Try another word, or ask the team below.', { q })}
        </p>
      )}

      {!q && (
        <section className="vx-sec-block" aria-label={t('Live tutorials')}>
          <SectionHeader
            title={t('Live tutorials')}
            explanation={t('Each one runs inside the real app and points at the real buttons. Press Esc to leave one.')}
            action={<span className="vx-sec-meta">{t('{done} of {total} done', { done: done.length, total: TUTORIALS.length })}</span>}
          />
          <div className="grid sm:grid-cols-2 gap-3">
            {TUTORIALS.map((tour) => {
              const words = localTour(tour, tr);
              return (
                <button key={tour.id} type="button" onClick={() => startTutorial(tour.id)} className="vx-help-tile">
                  <span className="vx-row-lead" aria-hidden>{tour.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className="vx-row-label flex-1">{words.title}</span>
                      {done.includes(tour.id) && (
                        <span className="vx-done">
                          <CheckIcon className="w-3.5 h-3.5" />
                          {t('Done')}
                        </span>
                      )}
                    </span>
                    <span className="vx-row-hint">{words.blurb}</span>
                    <span className="mt-2 block text-[12.5px] font-semibold text-ink-400 tabular-nums">
                      {t('{n} min', { n: tour.minutes })}{tour.playsMusic ? ` · ${t('plays music')}` : ''} · {t('{n} steps', { n: tour.steps.length })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="vx-sec-actions mt-5">
            <button type="button" onClick={openTour} className="vx-sec-pill">{t('Replay the welcome tour')}</button>
            <Link to="/settings" className="vx-sec-pill">{t('Open Settings')}</Link>
          </div>
        </section>
      )}

      {!q && latest && (
        <section className="vx-sec-block" aria-label={t('What’s new in {version}', { version: DISPLAY_VERSION })}>
          <SectionHeader title={t('What’s new in {version}', { version: DISPLAY_VERSION })} explanation={latest.title || undefined} />
          <ul className="vx-group">
            {latest.changes.slice(0, 4).map((c) => (
              <li key={c.text} className="vx-row !items-start !py-3.5 text-[14.5px] text-ink-200 leading-relaxed">
                <span className={cn('vx-new-dot', c.type === 'new' && 'is-new')} aria-hidden />
                <span className="max-w-[68ch]">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {guides.length > 0 && (
        <section className="vx-sec-block" aria-label={t('How to use VinaX')}>
          <SectionHeader title={t('How to use VinaX')} explanation={q ? undefined : t('Short, step-by-step guides. Open one to read it.')} />
          <div className="grid gap-8">
            {groups.map((group) => (
              <div key={group}>
                <h3 className="vx-sec-sub">{group}</h3>
                <div className="vx-group">
                  {guides.filter((g) => g.group === group).map((g) => (
                    <details key={g.id} open={!!q}>
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
        <section className="vx-sec-block" aria-label={t('Questions')}>
          <SectionHeader title={t('Questions')} />
          <div className="vx-group">
            {faq.map((f) => (
              <details key={f.q} open={!!q}>
                <summary className="vx-row">
                  <span className="vx-row-main">
                    {f.category ? <span className="vx-row-hint block">{f.category}</span> : null}
                    <span className="vx-row-label">{f.q}</span>
                  </span>
                  <ChevronDownIcon className="vx-row-toggle" />
                </summary>
                <p className="vx-disclose-body">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {shortcuts.length > 0 && (
        <section className="vx-sec-block" aria-label={t('Keyboard and gestures')}>
          <SectionHeader title={t('Keyboard and gestures')} />
          <div className="vx-group">
            {shortcuts.map(([k, v]) => (
              <div key={k} className="vx-row !min-h-[52px]">
                <span className="vx-row-main text-[14.5px] text-ink-200">{v}</span>
                <kbd className="vx-kbd">{k}</kbd>
              </div>
            ))}
          </div>
        </section>
      )}

      {!q && (
        <section className="vx-sec-block" aria-label={t('Copyright and legal')}>
          <SectionHeader
            title={t('Copyright and legal')}
            explanation={t('VinaX hosts no media files and sells nothing. Songs, recordings, artwork and lyrics belong to their artists, labels and rights holders, who can request removal at any time.')}
          />
          <nav aria-label={t('Legal')} className="vx-group">
            {LEGAL.map((l) => (
              <Link key={l.to} to={l.to} className="vx-row is-link">
                <span className="vx-row-main vx-row-label">{t(l.label)}</span>
                <ChevronRightIcon className="vx-row-chev" />
              </Link>
            ))}
            <a href="https://status.vinaxmusic.online" target="_blank" rel="noreferrer" className="vx-row is-link">
              <span className="vx-row-main">
                <span className="vx-row-label">{t('Service status')}</span>
                <span className="vx-row-hint">{t('Opens in a new tab')}</span>
              </span>
              <ChevronRightIcon className="vx-row-chev" />
            </a>
          </nav>
        </section>
      )}

      <section className="vx-sec-block" aria-labelledby="vx-help-feedback">
        <h2 id="vx-help-feedback" className="vx-sec-title">{t('Report a bug or share an idea')}</h2>
        <p className="vx-sec-lede !mt-0">{t('Goes straight to the VinaX team, with a city-level location to help reproduce issues.')}</p>
        <div className="vx-panel">
          <div className="flex gap-2 mb-4" role="group" aria-label={t('What kind of message')}>
            {(['bug', 'idea', 'other'] as const).map((k) => (
              <Chip key={k} active={type === k} onClick={() => setType(k)}>
                {t(k === 'bug' ? 'Bug' : k === 'idea' ? 'Idea' : 'Other')}
              </Chip>
            ))}
          </div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t(type === 'bug' ? 'What happened, what you expected, and the song or page if it matters…' : 'Tell us what you’d love to see…')}
            rows={4}
            maxLength={2000}
            aria-label={t('Your message')}
            className="vx-sec-field"
          />
          <label className="vx-check mt-3">
            <input type="checkbox" checked={diagnostics} onChange={(e) => setDiagnostics(e.target.checked)} />
            {t('Include app version, platform, screen size, language and theme')}
          </label>
          <button type="button" onClick={() => void submit()} disabled={sending} className="mt-3 px-6 rounded-full btn-primary">
            {t(sending ? 'Sending…' : 'Send feedback')}
          </button>
        </div>
      </section>
    </div>
  );
}
