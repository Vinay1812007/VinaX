import type { Song } from '@/types';
import type { ReactNode, SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { PlayIcon, SparkleIcon } from '@/components/Icons';
import { RadioGlyph } from '@/features/radio/RadioGlyph';
import { bestImage, artSrcSet, FALLBACK_ART } from '@/utils/images';
import { languageLabel } from '@/constants/languages';
import type { HomeDesign } from '@/services/recommendation/homeDesign';

const onArtError = (e: SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.srcset = '';
  e.currentTarget.src = FALLBACK_ART;
};

/** Up to four distinct covers for the mix artwork (distinct by URL, so one album is not tiled four times). */
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

/** What the mix is made of, in plain words: its languages, most common first. */
function mixLine(songs: Song[]): string | null {
  const counts = new Map<string, number>();
  for (const s of songs) if (s.language && s.language !== 'unknown') counts.set(s.language, (counts.get(s.language) ?? 0) + 1);
  const langs = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => languageLabel(l));
  return langs.length ? `${langs.join(' and ')}, familiar first` : null;
}

/**
 * 9.0.0 — the top of Home: ONE obvious listening action. The Aura Mix card
 * (artwork-led, the mix's own colours behind it) with a large play button,
 * then quieter ways in — AI Radio, Surprise me, more mixes — and "Jump back
 * in", the songs played last, one tap to resume.
 *
 * 10.0.0 — a first visit passes `lead` (the free-music welcome, HomeWelcome):
 * it takes the opening's first column and the Aura Mix sits beside it.
 *
 * `.vx-hero` and the "Play your Aura Mix" label are load-bearing for the
 * browser tests and the guided tour.
 */
export function HomeHero({ design, songs, recent, lead, onPlay, onResume, onRadio, onSurprise }: {
  design: HomeDesign;
  songs: Song[];
  recent: Song[];
  lead?: ReactNode;
  onPlay: () => void;
  onResume: (index: number) => void;
  onRadio: () => void;
  onSurprise: () => void;
}) {
  const cover = songs[0] ? bestImage(songs[0].images, 350) : FALLBACK_ART;
  const collage = collageArt(songs);
  const line = mixLine(songs);
  return (
    <div className={lead ? 'vxh-opening is-welcome' : 'vxh-opening'}>
      {lead}
      <section className="vx-hero vxh-hero" aria-label="Your Aura Mix">
        <img className="vxh-hero-wash" src={cover} alt="" aria-hidden decoding="async" onError={onArtError} />
        <div className={collage.length === 4 ? 'vxh-hero-art is-collage' : 'vxh-hero-art'} aria-hidden>
          {collage.length === 4
            ? collage.map((src) => <img key={src} src={src} alt="" width={120} height={120} decoding="async" onError={onArtError} />)
            : <img src={cover} alt="" width={240} height={240} decoding="async" onError={onArtError} />}
        </div>
        <div className="vxh-hero-copy">
          <p className="vxh-hero-kicker"><SparkleIcon /> Aura Mix{songs.length > 0 && ` · ${songs.length} songs`}</p>
          <h2 className="vxh-hero-title">{design.title}</h2>
          <p className="vxh-hero-desc">{line ? `${line}. ` : ''}{design.description}</p>
          <div className="vxh-hero-actions">
            <button type="button" onClick={onPlay} disabled={!songs.length} className="vx-play-fab is-lg" aria-label="Play your Aura Mix"><PlayIcon /></button>
            <button type="button" onClick={onRadio} className="vxh-pill"><RadioGlyph /> AI Radio</button>
            <button type="button" onClick={onSurprise} className="vxh-pill is-quiet"><SparkleIcon /> Surprise me</button>
            <Link to="/made-for-you" className="vx-section-link vxh-hero-more">More mixes</Link>
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="vxh-jump" aria-label="Jump back in">
          <div className="vxh-head"><h2>Jump back in</h2><Link className="vx-section-link" to="/history">History</Link></div>
          <div className="vxh-tiles">
            {recent.slice(0, 8).map((song, index) => (
              <button key={song.id} type="button" className={`vxh-tile${index >= 6 ? ' is-wide-only' : ''}`} onClick={() => onResume(index)} aria-label={`Play ${song.title}`}>
                <img src={bestImage(song.images, 150)} srcSet={artSrcSet(song.images, 150)} sizes="56px" alt="" width={56} height={56} loading="lazy" decoding="async" onError={onArtError} />
                <span className="vxh-tile-text"><span className="vxh-tile-title">{song.title}</span><span className="vxh-tile-sub">{song.subtitle}</span></span>
                <span className="vxh-disc" aria-hidden><PlayIcon /></span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
