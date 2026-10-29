import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePageTitle } from '@/hooks/usePageTitle';
import { MOODS, moodSeed } from '@/constants/seeds';
import { HUB_LANGUAGES, languageLabel } from '@/constants/languages';
import { flattenSongPages, useInfiniteSongs } from '@/features/search/useInfiniteSongs';
import { useSettingsStore } from '@/store/settingsStore';
import { SongRow } from '@/components/SongRow';
import { ListSkeleton } from '@/components/Skeletons';
import { EmptyState, ErrorState } from '@/components/States';
import { InfiniteSentinel } from '@/components/InfiniteSentinel';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { BrowseTile, TileGlyph } from '@/features/discover/BrowseTile';
import { HubMoodTiles } from '@/features/discover/HubMoodTiles';
import { moodTone } from '@/features/discover/tones';
import { browseLanguage, categoryArt, categoryTone, groupCategories, useBrowseCategories } from '@/features/discover/useBrowse';
import { scrollBehavior } from '@/utils/motion';
import { FALLBACK_ART } from '@/utils/images';
import '@/styles/pages/browse.css';
import { usePlayerStore } from '@/store/playerStore';
import { PlayIcon } from '@/components/Icons';

const COVER = { '--bx-cover': '48px' } as CSSProperties;
const GROUP_PREVIEW = 12;

/**
 * 1.3 — the catalogue's own moods & genres (Romance, Party, Hip Hop, The
 * 1990s…), each a page of playlists and songs. When the API is down the
 * call fails and nothing shows here: the page is what it was before.
 */
function CatalogueCategories() {
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const q = useBrowseCategories(browseLanguage(pinned));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!q.data) return null;
  return (
    <>
      {groupCategories(q.data).map((g) => {
        const shown = open[g.key] ? g.items : g.items.slice(0, GROUP_PREVIEW);
        return (
          <section key={g.key} className="vx-section" aria-label={g.title}>
            <SectionHeader title={g.title} explanation="Playlists and songs from the catalogue" />
            <div className="bx-tile-grid">
              {shown.map((c) => {
                const art = categoryArt(c);
                return (
                  <BrowseTile
                    key={c.id}
                    to={`/browse/${encodeURIComponent(c.id)}`}
                    tone={categoryTone(c)}
                    title={c.name}
                    meta={c.isNew ? 'New' : undefined}
                    visual={art ? (
                      <span className="bx-cover-fan" style={COVER}>
                        <img
                          src={art}
                          alt=""
                          width={48}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => (e.currentTarget.src = FALLBACK_ART)}
                        />
                      </span>
                    ) : undefined}
                  />
                );
              })}
            </div>
            {g.items.length > GROUP_PREVIEW && (
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
                aria-expanded={!!open[g.key]}
                className="bx-text-btn mt-3 -ml-3"
              >
                {open[g.key] ? 'Show fewer' : `Show all ${g.items.length}`}
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * Moods: eight faces to pick from; the pick's songs follow underneath, in
 * the listener's first language when they have one. On a phone the list
 * starts below the fold, so picking a mood brings it into view.
 */
export default function MoodsPage() {
  usePageTitle('Moods');
  const [mood, setMood] = useState<string | null>(null);
  const lang = useSettingsStore((s) => s.pinnedLanguages[0] ?? null);
  const query = useInfiniteSongs(mood ? moodSeed(mood, lang) : '', !!mood);
  const songs = flattenSongPages(query.data?.pages);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const picksRef = useRef<HTMLElement>(null);
  const picked = MOODS.find((m) => m.id === mood);
  const hubLanguage = lang && (HUB_LANGUAGES as readonly string[]).includes(lang) ? lang : null;

  // Only a pick made here scrolls, and only when the list is out of view.
  const pickedHere = useRef(false);
  useEffect(() => {
    if (!mood || !pickedHere.current) return;
    pickedHere.current = false;
    const el = picksRef.current;
    if (!el) return;
    const { top } = el.getBoundingClientRect();
    if (top > window.innerHeight - 160) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, [mood]);

  return (
    <div className="vx-browse vx-browse-page max-w-screen-2xl mx-auto">
      <PageHeader
        title="Moods"
        subtitle={lang ? `Pick a mood for songs in ${languageLabel(lang)}.` : 'Pick a mood for songs that fit it.'}
      />
      <div className="bx-tile-grid is-quad vx-section" role="group" aria-label="Moods">
        {MOODS.map((m) => (
          <BrowseTile
            key={m.id}
            shape="mood"
            tone={moodTone(m.id)}
            title={m.label}
            meta={lang ? languageLabel(lang) : undefined}
            onClick={() => {
              pickedHere.current = true;
              setMood(m.id);
            }}
            pressed={mood === m.id}
            visual={<TileGlyph emoji>{m.emoji}</TileGlyph>}
          />
        ))}
      </div>
      {mood && (
        <section ref={picksRef} className="vx-section bx-anchor" aria-label={`${picked?.label} picks`}>
          <SectionHeader
            title={`${picked?.label} picks`}
            action={songs.length > 0 && (
              <button type="button" onClick={() => playQueue(songs, 0)} className="bx-pill">
                <PlayIcon /> Play all
              </button>
            )}
          />
          {query.isLoading && <ListSkeleton />}
          {query.isError && <ErrorState retry={() => query.refetch()} />}
          {!query.isLoading && !query.isError && songs.length === 0 && (
            <EmptyState title="Nothing for this mood right now" message="The catalogue had no songs for it just now — try another mood." />
          )}
          <div className="vx-track-list">
            {songs.map((song, i) => <SongRow key={song.id} song={song} songs={songs} index={i} />)}
          </div>
          {!query.isLoading && !query.isError && (
            <InfiniteSentinel
              onVisible={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
              disabled={!query.hasNextPage}
              loading={query.isFetchingNextPage}
            />
          )}
        </section>
      )}
      <CatalogueCategories />
      {hubLanguage && (
        <section className="vx-section" aria-label={`${languageLabel(hubLanguage)} mood pages`}>
          <SectionHeader title={`${languageLabel(hubLanguage)} by mood`} explanation="A page for each mood, ready to play" />
          <HubMoodTiles language={hubLanguage} />
        </section>
      )}
    </div>
  );
}
