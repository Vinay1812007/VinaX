import { Link } from 'react-router-dom';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useJsonLd } from '@/hooks/useSeo';
import { SITE_ORIGIN } from '@/utils/schema';
import { songPath } from '@/utils/slug';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { usePlayerStore } from '@/store/playerStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { MOOD_HUBS, type MoodHub } from '@/constants/hubs';

/**
 * Mood × language landing page (/telugu-romantic-songs …): a real, playable
 * page for the exact queries people type into Google — 72 of them, all
 * sourced live from the catalog and edge-rendered for crawlers (see
 * functions/_lib/render.ts renderHub).
 */
export default function MoodHubPage({ language, mood }: { language: string; mood: MoodHub }) {
  const label = languageLabel(language);
  const q = useInfiniteSongs(`${label} ${mood.query}`);
  const songs = flattenSongPages(q.data?.pages);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const path = `/${language}-${mood.slug}-songs`;

  usePageMeta({
    title: `${label} ${mood.label} Songs — Stream Free`,
    description: `The best ${label} ${mood.label.toLowerCase()} songs — ${mood.blurb}. Stream free on VinaX, no login, tuned to you.`,
    canonicalPath: path,
  });
  useJsonLd(
    songs.length > 0 && {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${label} ${mood.label} Songs`,
      numberOfItems: Math.min(songs.length, 25),
      itemListElement: songs.slice(0, 25).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_ORIGIN}${songPath(s)}`,
      })),
    },
  );

  return (
    <div className="max-w-4xl mx-auto">
      <header className="mb-7">
        <p className="text-xs uppercase tracking-widest text-ink-400 font-semibold mb-1.5">
          <Link to={`/${language}-songs`} className="hover:text-ink-200">{label} songs</Link> · {mood.label}
        </p>
        <h1 className="text-display tracking-tight">{label} {mood.label} Songs</h1>
        <p className="text-sm text-ink-300 mt-2 max-w-2xl">
          {label} {mood.label.toLowerCase()} songs — {mood.blurb}. Free, no login, updated from the live catalog.
        </p>
        {songs.length > 0 && (
          <button onClick={() => playQueue(songs, 0)} className="btn-primary px-6 py-2.5 rounded-full mt-4">
            Play all
          </button>
        )}
      </header>

      <section className="mb-8">
        {q.isLoading && <ListSkeleton />}
        {songs.map((song, i) => (
          <SongRow key={song.id} song={song} songs={songs} index={i} />
        ))}
        {!q.isLoading && songs.length === 0 && (
          <p className="text-sm text-ink-400">Nothing surfaced right now — the catalog may be briefly unreachable. Pull to refresh or try again shortly.</p>
        )}
        <InfiniteSentinel
          onVisible={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          disabled={!q.hasNextPage}
          loading={q.isFetchingNextPage}
        />
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">More {label} moods</h2>
        <div className="flex flex-wrap gap-2 mb-5">
          {MOOD_HUBS.filter((m) => m.slug !== mood.slug).map((m) => (
            <Link key={m.slug} to={`/${language}-${m.slug}-songs`} className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100">
              {label} {m.label.toLowerCase()} songs
            </Link>
          ))}
        </div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink-400 mb-3">{mood.label} songs in other languages</h2>
        <div className="flex flex-wrap gap-2">
          {HUB_LANGUAGES.filter((l) => l !== language).slice(0, 8).map((l) => (
            <Link key={l} to={`/${l}-${mood.slug}-songs`} className="px-3.5 py-2 rounded-full text-xs font-semibold bg-ink-800/70 text-ink-200 border border-glass transition hover:bg-ink-700 hover:text-ink-100">
              {languageLabel(l)} {mood.label.toLowerCase()} songs
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
