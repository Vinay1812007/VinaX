import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { DOC_SECTIONS, docGroups, type DocBlock, type DocSection } from '@/features/cli/docsContent';

/**
 * Public VinaX CLI documentation — /VinaXAI/cli/docs.
 *
 * A standalone route with its own layout: a sticky contents rail on desktop,
 * a collapsible sheet on mobile, and one long semantic document in the middle.
 * It is lazily loaded and imports nothing from the player shell, so it costs
 * the app's first load nothing.
 *
 * The engine list is fetched live rather than written down. A number in a
 * documentation page is a number that goes stale, and an engine menu that
 * disagrees with the CLI is worse than no engine menu at all.
 */

interface LiveEngine {
  id: string;
  label: string;
  hint: string;
  acceptsModel: boolean;
  available: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    };
    // Older browsers and insecure origins have no clipboard API; fall back to
    // a selection copy rather than leaving the button doing nothing at all.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => undefined);
      return;
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch {
      /* nothing more to try */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className="absolute top-2 right-2 px-2 py-1 rounded-md text-[11px] font-semibold bg-ink-800 text-ink-200 hover:bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className="text-[15px] leading-relaxed text-ink-200 mb-4">{block.text}</p>;

    case 'list':
      return (
        <ul className="mb-4 space-y-1.5">
          {(block.items ?? []).map((item) => (
            <li key={item} className="text-[15px] leading-relaxed text-ink-200 pl-5 relative">
              <span aria-hidden className="absolute left-0 top-[0.6em] w-1.5 h-1.5 rounded-full bg-ember-400" />
              {item}
            </li>
          ))}
        </ul>
      );

    case 'code':
      return (
        <div className="relative mb-5 group">
          <pre className="overflow-x-auto rounded-card border border-glass bg-ink-900 p-4 pr-16 text-[13px] leading-relaxed">
            <code className="font-mono text-ink-100 whitespace-pre">{block.text}</code>
          </pre>
          <CopyButton text={block.text ?? ''} />
        </div>
      );

    case 'note':
      return (
        <aside className="mb-5 rounded-card border border-glass bg-ink-900/60 p-4">
          <p className="text-[14px] leading-relaxed text-ink-200">
            <strong className="text-ember-400 font-extrabold">Note. </strong>
            {block.text}
          </p>
        </aside>
      );

    case 'table': {
      const [head, ...body] = block.rows ?? [];
      if (!head) return null;
      return (
        <div className="mb-5 overflow-x-auto rounded-card border border-glass">
          <table className="w-full text-left text-[14px] border-collapse">
            <thead>
              <tr className="bg-ink-900">
                {head.map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-extrabold text-ink-100 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row) => (
                <tr key={row.join('|')} className="border-t border-glass align-top">
                  {row.map((cell, i) => (
                    <td key={cell} className={`px-3 py-2 text-ink-200 ${i === 0 ? 'font-mono text-[13px] text-ink-100 whitespace-nowrap' : ''}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    default:
      return null;
  }
}

/** The live engine list, or an honest line saying it could not be loaded. */
function EngineList() {
  const [engines, setEngines] = useState<LiveEngine[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    // Same-origin relative path, exactly like every other call the web app
    // makes. The CLI's own absolute-base override is for the CLI only.
    fetch('/api/vinaxcli/meta', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { engines?: LiveEngine[] }) => setEngines(Array.isArray(body.engines) ? body.engines : []))
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <p className="mb-5 text-[14px] text-ink-400">
        The live engine list could not be loaded right now. Run <code className="font-mono text-ink-200">vinax models</code> to
        see what is available.
      </p>
    );
  }
  if (!engines) {
    return <p className="mb-5 text-[14px] text-ink-400">Loading the current engine list…</p>;
  }
  if (!engines.length) {
    return <p className="mb-5 text-[14px] text-ink-400">No engines are being advertised right now.</p>;
  }

  return (
    <div className="mb-5 overflow-x-auto rounded-card border border-glass">
      <table className="w-full text-left text-[14px] border-collapse">
        <caption className="sr-only">VinaX CLI engines, fetched live</caption>
        <thead>
          <tr className="bg-ink-900">
            <th scope="col" className="px-3 py-2 font-extrabold text-ink-100">Engine</th>
            <th scope="col" className="px-3 py-2 font-extrabold text-ink-100">What it is for</th>
            <th scope="col" className="px-3 py-2 font-extrabold text-ink-100 whitespace-nowrap">--model</th>
          </tr>
        </thead>
        <tbody>
          {engines.map((e) => (
            <tr key={e.id} className="border-t border-glass align-top">
              <td className="px-3 py-2 font-mono text-[13px] text-ink-100 whitespace-nowrap">{e.id}</td>
              <td className="px-3 py-2 text-ink-200">
                {e.hint || e.label}
                {!e.available && <span className="text-ink-400"> · not configured right now</span>}
              </td>
              <td className="px-3 py-2 text-ink-200">{e.acceptsModel ? 'Yes' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section }: { section: DocSection }) {
  return (
    <section id={section.id} className="scroll-mt-20 mb-12" aria-labelledby={`${section.id}-heading`}>
      <h2 id={`${section.id}-heading`} className="text-xl md:text-2xl font-extrabold tracking-[-0.02em] text-ink-100 mb-3">
        {section.title}
      </h2>
      {section.blocks.map((block, i) => (
        <Block key={`${section.id}-${i}`} block={block} />
      ))}
      {section.id === 'engines' && <EngineList />}
    </section>
  );
}

export default function CliDocsPage() {
  usePageMeta({
    title: 'VinaX CLI Documentation',
    description:
      'Install and use VinaX CLI to work with code, files, terminal commands, Git, tests and development workflows directly from your terminal.',
    canonicalPath: '/VinaXAI/cli/docs',
  });

  const groups = useMemo(() => docGroups(), []);
  const [active, setActive] = useState(DOC_SECTIONS[0].id);
  const [navOpen, setNavOpen] = useState(false);

  // Scroll spy: highlight the section the reader is actually looking at.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    for (const s of DOC_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const jump = useCallback((id: string) => {
    setNavOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Move focus with the scroll so keyboard and screen-reader users land in
    // the section they chose, not back at the top of the document.
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }, []);

  return (
    <div className="min-h-[100dvh] bg-ink-950 text-ink-100">
      <a
        href="#cli-docs-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-md focus:bg-ember-500 focus:text-ink-950 focus:font-extrabold"
      >
        Skip to documentation
      </a>

      <header className="sticky top-0 z-30 border-b border-glass bg-ink-950/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            to="/VinaXAI"
            className="text-sm font-extrabold text-ink-100 hover:text-ember-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 rounded"
          >
            VinaX AI
          </Link>
          <span aria-hidden className="text-ink-600">/</span>
          <span className="text-sm text-ink-300">CLI</span>
          <div className="flex-1" />
          <Link
            to="/"
            className="text-sm text-ink-300 hover:text-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 rounded"
          >
            Music
          </Link>
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            aria-controls="cli-docs-nav"
            className="lg:hidden px-3 py-1.5 rounded-md border border-glass text-sm font-semibold text-ink-200 hover:bg-ink-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400"
          >
            Contents
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 lg:flex lg:gap-10">
        <nav
          id="cli-docs-nav"
          aria-label="Documentation contents"
          className={`${navOpen ? 'block' : 'hidden'} lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto py-6 lg:py-10`}
        >
          {groups.map((group) => (
            <div key={group.group} className="mb-5">
              <p className="text-[11px] uppercase tracking-wider font-extrabold text-ink-400 mb-1.5">{group.group}</p>
              <ul className="space-y-0.5">
                {group.sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        jump(s.id);
                      }}
                      aria-current={active === s.id ? 'true' : undefined}
                      className={`block px-2 py-1 rounded text-[13px] leading-snug transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${
                        active === s.id ? 'bg-ink-800 text-ink-100 font-semibold' : 'text-ink-300 hover:text-ink-100 hover:bg-ink-900'
                      }`}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main id="cli-docs-main" className="min-w-0 flex-1 py-8 lg:py-12 max-w-3xl">
          <p className="text-[13px] uppercase tracking-wider font-extrabold text-ember-400 mb-2">Documentation</p>
          <h1 className="text-3xl md:text-[40px] font-extrabold tracking-[-0.03em] leading-tight mb-3">VinaX CLI</h1>
          <p className="text-[17px] leading-relaxed text-ink-300 mb-10">
            The VinaX coding agent, in your terminal. It reads your project, edits it, runs your tests, and commits and
            pushes when you approve — on your own machine, under your own permissions.
          </p>

          {DOC_SECTIONS.map((section) => (
            <Section key={section.id} section={section} />
          ))}

          <footer className="border-t border-glass pt-6 mt-4">
            <p className="text-[14px] text-ink-400">
              Questions or a problem?{' '}
              <Link to="/contact" className="text-ember-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 rounded">
                Contact VinaX
              </Link>
              . For the assistant in your browser, open{' '}
              <Link to="/VinaXAI" className="text-ember-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 rounded">
                VinaX AI
              </Link>
              .
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
