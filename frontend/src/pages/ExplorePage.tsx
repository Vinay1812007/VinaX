import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Chip } from '@/components/Chip';
import { MOODS, moodSeed } from '@/constants/seeds';
import { languageLabel } from '@/constants/languages';
import { useSettingsStore } from '@/store/settingsStore';
import { loadProfile } from '@/services/personalization/storage';
import { topLanguages } from '@/services/personalization/profile';
import {
  CompassIcon,
  PlayIcon,
  FilmIcon,
  GlobeIcon,
  HeartIcon,
  MusicIcon,
  SparkleIcon,
  WaveIcon,
} from '@/components/Icons';

const tiles: Array<{ to: string; label: string; hint: string; icon: typeof CompassIcon }> = [
  { to: '/discover', label: 'Discover', hint: 'Fresh picks & playlists', icon: CompassIcon },
  { to: '/charts', label: 'Charts', hint: 'Top songs by language', icon: WaveIcon },
  { to: '/movies', label: 'Movies', hint: 'Film soundtracks', icon: FilmIcon },
  { to: '/moods', label: 'Moods', hint: 'Music for every vibe', icon: SparkleIcon },
  { to: '/languages', label: 'Languages', hint: 'Pin what you listen to', icon: MusicIcon },
  { to: '/regions', label: 'Regions', hint: 'Tuned to your region', icon: GlobeIcon },
  { to: '/made-for-you', label: 'Made For You', hint: 'Your personal mixes', icon: HeartIcon },
  { to: '/quiz', label: 'Music Quiz', hint: 'Guess the song, beat your streak', icon: PlayIcon },
];

/** Package D3 — the mood × language matrix. Pick a language, tap a mood cell,
 *  land on real playable results for that exact combination. Languages come
 *  from what the listener actually plays (profile) plus their pinned set. */
function MoodLanguageGrid() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const [langs] = useState<string[]>(() => {
    const fromProfile = topLanguages(loadProfile(), 4).map((l) => l.id);
    const merged = [...new Set([...pinned, ...fromProfile])].slice(0, 4);
    return merged.length ? merged : ['hindi', 'english'];
  });
  const [lang, setLang] = useState(langs[0]);
  return (
    <section className="mt-8">
      <h2 className="text-lg font-extrabold tracking-tight mb-1">Any mood, your language</h2>
      <p className="text-xs text-ink-400 mb-3">Pick a language, tap a mood — instant results.</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar mb-3">
        {langs.map((l) => (
          <Chip key={l} active={lang === l} onClick={() => setLang(l)}>
            {languageLabel(l)}
          </Chip>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {MOODS.map((m) => (
          <Link
            key={m.id}
            to={`/search/${encodeURIComponent(moodSeed(m.id, lang))}`}
            className="glass-card glass-hover rounded-xl px-3 py-3 flex items-center gap-2.5 active:scale-[0.97] transition-transform"
          >
            <span aria-hidden className="text-lg">{m.emoji}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate">{m.label}</span>
              <span className="block text-[10px] text-ink-500 truncate">{languageLabel(lang)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function ExplorePage() {
  usePageTitle('Explore');
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-display tracking-tight mb-1">Explore</h1>
      <p className="text-sm text-ink-400 mb-5">Everything VinaX has to offer, in one place.</p>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(({ to, label, hint, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass-card glass-hover rounded-2xl p-4 flex flex-col gap-3 active:scale-[0.98] transition-transform"
          >
            <span className="w-11 h-11 rounded-xl bg-ember-500/15 text-ember-400 flex items-center justify-center">
              <Icon className="w-6 h-6" />
            </span>
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-xs text-ink-400">{hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <MoodLanguageGrid />
    </div>
  );
}
