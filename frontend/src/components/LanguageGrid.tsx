import { Link } from 'react-router-dom';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { NATIVE_NAMES } from '@/features/discover/scripts';
import { languageTone } from '@/features/discover/tones';
import { SectionHeader } from './SectionHeader';
import '@/styles/pages/browse.css';

/** The routable language hubs, each tile led by the language's own script. */
export function LanguageGrid({ heading = true }: { heading?: boolean }) {
  return (
    <section aria-label="Explore languages">
      {heading && <SectionHeader title="Music in your language" seeAllTo="/languages" />}
      <div className="bx-langs">
        {HUB_LANGUAGES.map((id) => {
          const native = NATIVE_NAMES[id];
          return (
            <Link key={id} to={`/${id}-songs`} aria-label={`Explore ${languageLabel(id)} music`} className={`bx-lang ${languageTone(id)}`}>
              <strong className="bx-lang-script" aria-hidden lang={native?.lang} dir={native?.dir}>
                {native?.text ?? languageLabel(id)}
              </strong>
              <span className="bx-lang-name" aria-hidden>
                {languageLabel(id)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
