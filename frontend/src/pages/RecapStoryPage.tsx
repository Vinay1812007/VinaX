import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { buildRecap, recapReady, type RecapData } from '@/features/recap/recap';
import { loadProfile } from '@/services/personalization/storage';
import { languageLabel } from '@/constants/languages';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { getLocal } from '@/services/storage/local';
import { KEYS } from '@/constants/storage-keys';
import { toast } from '@/store/toastStore';
import { ShareIcon, SparkleIcon, XIcon, PlayIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';
import '@/styles/pages/secondary.css';

/**
 * 15.0 — "Wrapped": the year's recap as full-screen story slides. Tap the
 * right half (or press →) for the next slide, the left half for the
 * previous one; each slide holds for a few seconds on its own; the bars at
 * the top show where you are. The last slide shares the same card the
 * Recap page paints. Everything comes from the on-device recap
 * (features/recap/recap.ts); nothing is uploaded.
 */

const HOLD_MS = 5200;

interface Slide { key: string; kicker: string; title: string; body?: string; big?: string; tone: 'ember' | 'tide' | 'ink' | 'art' }

const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;

export function storySlides(r: RecapData): Slide[] {
  const slides: Slide[] = [
    { key: 'open', kicker: `${r.year}`, title: 'Your year in music', body: `${r.daysTogether} ${r.daysTogether === 1 ? 'day' : 'days'} of music together. Tap to begin.`, tone: 'ember' },
    { key: 'plays', kicker: 'You pressed play', big: r.totalPlays.toLocaleString('en-IN'), title: `${r.totalPlays === 1 ? 'time' : 'times'} this year`, body: `About ${r.estMinutes.toLocaleString('en-IN')} minutes, ${r.completes.toLocaleString('en-IN')} songs played to the end.`, tone: 'tide' },
  ];
  if (r.topArtists[0]) {
    slides.push({ key: 'artist', kicker: 'Your top artist', title: r.topArtists[0].name, body: `${r.topArtists[0].plays} plays${r.topArtists[1] ? ` · then ${r.topArtists.slice(1, 4).map((a) => a.name).join(', ')}` : ''}`, tone: 'art' });
  }
  if (r.topLanguages[0]) {
    slides.push({ key: 'lang', kicker: 'Your language', big: `${r.topLanguages[0].pct}%`, title: languageLabel(r.topLanguages[0].id), body: r.topLanguages[1] ? `${r.topLanguages.slice(1, 3).map((l) => `${languageLabel(l.id)} ${l.pct}%`).join(' · ')}` : undefined, tone: 'ink' });
  }
  if (r.onRepeat) slides.push({ key: 'repeat', kicker: 'On repeat', title: r.onRepeat.title, body: `${r.onRepeat.subtitle} · ${r.onRepeat.count} plays lately`, tone: 'art' });
  slides.push({ key: 'hour', kicker: 'Your hour', big: hourLabel(r.peakHour), title: 'is when the music is on', body: `${r.favorites} favourites kept along the way.`, tone: 'tide' });
  slides.push({ key: 'persona', kicker: 'Which makes you', title: r.persona, body: 'Share the card, or keep listening.', tone: 'ember' });
  return slides;
}

export default function RecapStoryPage() {
  usePageTitle('Your year, as a story');
  const navigate = useNavigate();
  const entries = useHistoryStore((s) => s.entries);
  const favorites = useLibraryStore((s) => s.favorites);
  const recap = useMemo(
    () => buildRecap(loadProfile(), entries, favorites.length, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profile is read once per visit
    [entries.length, favorites.length],
  );
  const slides = useMemo(() => storySlides(recap), [recap]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [sharing, setSharing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const ready = recapReady(recap);
  useFocusTrap(dialogRef, ready, () => navigate(-1));

  const artSong = useMemo(() => {
    const name = recap.topArtists[0]?.name?.toLowerCase();
    const hit = name ? entries.find((e) => e.song.subtitle.toLowerCase().includes(name)) : undefined;
    return hit?.song ?? entries[0]?.song ?? null;
  }, [entries, recap.topArtists]);
  const onRepeatSong = useMemo(
    () => (recap.onRepeat ? entries.find((e) => e.song.title === recap.onRepeat?.title)?.song ?? null : null),
    [entries, recap.onRepeat],
  );

  const go = useCallback((d: number) => setI((cur) => Math.max(0, Math.min(slides.length - 1, cur + d))), [slides.length]);

  useEffect(() => {
    if (!ready || paused || i >= slides.length - 1) return;
    const t = setTimeout(() => go(1), HOLD_MS);
    return () => clearTimeout(t);
  }, [i, paused, ready, slides.length, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const shareCard = async (): Promise<void> => {
    setSharing(true);
    try {
      const [{ renderRecapCard }, { shareOrSaveImage }] = await Promise.all([import('@/features/recap/shareCard'), import('@/utils/shareImage')]);
      const blob = await renderRecapCard(recap, getLocal<string>(KEYS.userName, ''));
      await shareOrSaveImage(blob, `vinax-${recap.year}-wrapped.png`, `My ${recap.year} in Music`);
    } catch {
      toast('Could not build the card — try again');
    } finally {
      setSharing(false);
    }
  };

  if (!ready) {
    return (
      <div className="vx-empty-page">
        <span className="vx-empty-icon" aria-hidden><SparkleIcon className="w-9 h-9" /></span>
        <h1>Your year, as a story</h1>
        <p>The story unlocks after about 20 plays. Every song is counted on this device only.</p>
        <Link to="/" className="px-6 py-3 rounded-full btn-primary">Play something</Link>
      </div>
    );
  }

  const slide = slides[i];
  const last = i === slides.length - 1;
  const art = slide.tone === 'art' ? (slide.key === 'repeat' ? onRepeatSong : artSong) : null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Your ${recap.year} in music, slide ${i + 1} of ${slides.length}`}
      className={cn('vx-story', `is-${slide.tone}`)}
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
    >
      {art && <img className="vx-story-art" src={bestImage(art.images, 500)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" aria-hidden />}
      <div className="vx-story-bars" aria-hidden>
        {slides.map((s, k) => <i key={s.key} className={cn(k < i && 'is-done', k === i && !paused && 'is-live')} style={k === i ? { animationDuration: `${HOLD_MS}ms` } : undefined} />)}
      </div>
      <button type="button" className="vx-story-close" aria-label="Close" onClick={() => navigate(-1)}><XIcon /></button>
      <button type="button" className="vx-story-tap is-prev" aria-label="Previous slide" onClick={() => go(-1)} />
      <button type="button" className="vx-story-tap is-next" aria-label="Next slide" onClick={() => go(1)} />
      <div className="vx-story-body" key={slide.key}>
        <p className="vx-story-kicker">{slide.kicker}</p>
        {slide.big && <p className="vx-story-big">{slide.big}</p>}
        <h1 className="vx-story-title">{slide.title}</h1>
        {slide.body && <p className="vx-story-text">{slide.body}</p>}
        {slide.key === 'repeat' && onRepeatSong && (
          <button type="button" className="vx-story-pill" onClick={() => usePlayerStore.getState().playQueue([onRepeatSong], 0)}><PlayIcon className="w-4 h-4" /> Play it again</button>
        )}
        {last && (
          <div className="vx-story-actions">
            <button type="button" className="vx-story-pill is-primary" disabled={sharing} onClick={() => void shareCard()}><ShareIcon className="w-4 h-4" /> {sharing ? 'Painting…' : 'Share the card'}</button>
            <Link to="/recap" className="vx-story-pill">See the full recap</Link>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
