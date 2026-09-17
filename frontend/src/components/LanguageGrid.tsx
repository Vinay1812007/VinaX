import { Link } from 'react-router-dom';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
const nativeNames: Record<string, string> = { telugu: 'తెలుగు', hindi: 'हिन्दी', tamil: 'தமிழ்', malayalam: 'മലയാളം', kannada: 'ಕನ್ನಡ', punjabi: 'ਪੰਜਾਬੀ', bengali: 'বাংলা', marathi: 'मराठी', gujarati: 'ગુજરાતી', urdu: 'اردو', english: 'English' };
/** Uses only the existing routable language hubs. */
export function LanguageGrid() {
  return <section aria-label="Explore languages"><div className="vx-section-header"><h2>Music in your language</h2><Link className="vx-section-link" to="/languages">Your preferences</Link></div>
    <div className="vx-language-grid">{HUB_LANGUAGES.map(id => <Link key={id} to={`/${id}-songs`} aria-label={`Explore ${languageLabel(id)} music`}><strong aria-hidden>{nativeNames[id] || languageLabel(id)}</strong><span>{languageLabel(id)} · Explore →</span></Link>)}</div>
  </section>;
}
