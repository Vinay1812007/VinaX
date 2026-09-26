import type { Song } from '@/types';
import type { SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { PlayIcon } from '@/components/Icons';
import { bestImage, artSrcSet, FALLBACK_ART } from '@/utils/images';
import type { HomeDesign } from '@/services/recommendation/homeDesign';

const onArtError = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.srcset = '';
  e.currentTarget.src = FALLBACK_ART;
};

/** Up to four distinct covers for the featured collage (distinct by URL, so one album is not tiled four times). */
function collageArt(songs: Song[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const song of songs) {
    const src = bestImage(song.images, 250);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
    if (out.length === 4) break;
  }
  return out;
}

/**
 * The top of Home under the greeting: a compact "Jump back in" grid (recent
 * songs, one tap to resume) and the featured Aura Mix card. `.vx-hero` and
 * the "Play your Aura Mix" label are load-bearing for tests and the guided tour.
 */
export function HomeOpening({ design, songs, recent, onPlay, onResume }: {
  design: HomeDesign; songs: Song[]; recent: Song[];
  onPlay: () => void; onResume: (index: number) => void;
}) {
  const cover = songs[0] ? bestImage(songs[0].images, 350) : FALLBACK_ART;
  const collage = collageArt(songs);
  return <div className="vxh-opening">
    {recent.length > 0 && <section className="vxh-jump" aria-label="Jump back in">
      <div className="vxh-head"><h2>Jump back in</h2><Link className="vx-section-link" to="/history">History</Link></div>
      <div className="vxh-tiles">
        {recent.slice(0, 8).map((song, index) => <button key={song.id} type="button" className={`vx-quick-pick vxh-tile${index >= 6 ? ' is-wide-only' : ''}`} onClick={() => onResume(index)} aria-label={`Play ${song.title}`}>
          <img src={bestImage(song.images, 150)} srcSet={artSrcSet(song.images, 150)} sizes="56px" alt="" width={56} height={56} loading="lazy" decoding="async" onError={onArtError} />
          <span className="vxh-tile-text"><span className="vxh-tile-title">{song.title}</span><span className="vxh-tile-sub">{song.subtitle}</span></span>
          <span className="vxh-disc" aria-hidden><PlayIcon /></span>
        </button>)}
      </div>
    </section>}

    <section className="vx-hero vxh-feature" aria-label="Your Aura Mix">
      <img className="vxh-feature-wash" src={cover} alt="" aria-hidden decoding="async" onError={onArtError} />
      {collage.length === 4
        ? <div className="vxh-feature-art is-collage" aria-hidden>{collage.map((src) => <img key={src} src={src} alt="" width={100} height={100} decoding="async" onError={onArtError} />)}</div>
        : <div className="vxh-feature-art" aria-hidden><img src={cover} alt="" width={200} height={200} decoding="async" onError={onArtError} /></div>}
      <div className="vxh-feature-copy">
        <p className="vxh-feature-label">Aura Mix{songs.length > 0 && ` · ${songs.length} songs`}</p>
        <h2 className="vxh-feature-title">{design.title}</h2>
        {design.description && <p className="vxh-feature-desc" title={design.description}>{design.description}</p>}
        <div className="vxh-feature-actions">
          <button type="button" onClick={onPlay} disabled={!songs.length} className="vx-play-fab" aria-label="Play your Aura Mix"><PlayIcon /></button>
          <Link to="/made-for-you" className="vx-section-link">More mixes</Link>
        </div>
      </div>
    </section>
  </div>;
}
