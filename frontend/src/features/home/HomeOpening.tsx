import type { Song } from '@/types';
import { Link } from 'react-router-dom';
import { PlayIcon, SparkleIcon } from '@/components/Icons';
import { bestImage, artSrcSet, FALLBACK_ART } from '@/utils/images';
import type { HomeDesign } from '@/services/recommendation/homeDesign';

export function HomeOpening({ design, songs, recent, onPlay, onResume }: {
  design: HomeDesign; songs: Song[]; recent: Song[];
  onPlay: () => void; onResume: (index: number) => void;
}) {
  return <div className="vx-home-opening">
    <section className="vx-hero" aria-label="Your Aura Mix">
      <img className="vx-hero-cover" src={songs[0] ? bestImage(songs[0].images, 350) : FALLBACK_ART} alt="" width={176} height={176} decoding="async" onError={e => { e.currentTarget.src = FALLBACK_ART; }} />
      <div className="vx-hero-copy">
        <p className="vx-eyebrow flex items-center gap-2"><SparkleIcon className="w-4 h-4 text-ember-400" /> AURA MIX · FOR YOU</p>
        <h2 className="vx-hero-title mt-2">{design.title}</h2>
        <p className="text-sm text-ink-300 mt-2 max-w-lg">{design.description}</p>
        <div className="flex items-center flex-wrap gap-3 mt-4">
          <button type="button" onClick={onPlay} disabled={!songs.length} className="btn-primary px-5 inline-flex items-center gap-2" aria-label="Play your Aura Mix"><PlayIcon className="w-4 h-4" /> Play my mix</button>
          <Link to="/made-for-you" className="vx-section-link">Explore your mixes →</Link>
        </div>
      </div>
    </section>
    {recent.length > 0 && <section aria-label="Jump back in">
      <div className="vx-section-header"><h2>Jump back in</h2><Link className="vx-section-link" to="/history">History</Link></div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {recent.slice(0, 6).map((song, index) => <button key={song.id} className="vx-quick-pick" onClick={() => onResume(index)} aria-label={`Play ${song.title}`}>
          <img src={bestImage(song.images, 150)} srcSet={artSrcSet(song.images, 150)} sizes="56px" alt="" width={56} height={56} loading="lazy" onError={e => { e.currentTarget.srcset = ''; e.currentTarget.src = FALLBACK_ART; }} />
          <span><span className="block text-sm font-semibold truncate">{song.title}</span><span className="block text-xs text-ink-400 truncate">{song.subtitle}</span></span>
        </button>)}
      </div>
    </section>}
  </div>;
}
