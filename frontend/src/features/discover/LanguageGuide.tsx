import { Link } from 'react-router-dom';
import { LANGUAGE_GUIDES } from '@/content/languageGuides';
import '@/styles/pages/secondary.css';

/** The written guide on a language hub. Same text the build prerenders for crawlers. */
export function LanguageGuide({ language, label }: { language: string; label: string }) {
  const guide = LANGUAGE_GUIDES[language];
  if (!guide) return null;
  return (
    <section className="vx-section" aria-labelledby="vx-lang-guide">
      <div className="vx-article">
        <h2 id="vx-lang-guide">About {label} music</h2>
        {guide.paragraphs.map((p) => <p key={p.slice(0, 32)}>{p}</p>)}
        <p>
          Try searching for{' '}
          {guide.tryThese.map((t, i) => (
            <span key={t}>
              {i > 0 && (i === guide.tryThese.length - 1 ? ' or ' : ', ')}
              <Link to={`/search/${encodeURIComponent(t)}`}>{t}</Link>
            </span>
          ))}
          , or describe a mood in your own words.
        </p>
      </div>
    </section>
  );
}
