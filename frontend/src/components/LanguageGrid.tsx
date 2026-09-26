import { Link } from 'react-router-dom';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { SectionHeader } from './SectionHeader';
import '@/styles/pages/browse.css';

const nativeNames: Record<string, string> = { telugu: 'తెలుగు', hindi: 'हिन्दी', tamil: 'தமிழ்', malayalam: 'മലയാളം', kannada: 'ಕನ್ನಡ', punjabi: 'ਪੰਜਾਬੀ', bengali: 'বাংলা', marathi: 'मराठी', gujarati: 'ગુજરાતી', urdu: 'اردو', english: 'English' };

/** Uses only the existing routable language hubs. */
export function LanguageGrid({ heading = true }: { heading?: boolean }) {
  return (
    <section aria-label="Explore languages">
      {heading && <SectionHeader title="Music in your language" seeAllTo="/languages" />}
      <div className="vx-lang-tiles">
        {HUB_LANGUAGES.map((id, i) => (
          <Link key={id} to={`/${id}-songs`} aria-label={`Explore ${languageLabel(id)} music`} className={`vx-lang-tile vx-tone-${(i % 12) + 1}`}>
            <strong aria-hidden>{nativeNames[id] || languageLabel(id)}</strong>
            <span aria-hidden>{languageLabel(id)}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
