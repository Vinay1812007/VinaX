/**
 * 10.1 — the typeahead panel under the search field: query completions
 * (recent, trending, titles already returned) with the typed part in bold,
 * then quick hits for songs (tap plays), artists and albums.
 *
 * One listbox for the whole panel, grouped, so ↑/↓ walk every row and the
 * field's aria-activedescendant always names a real option. Focus never
 * leaves the field: rows keep it with a pointerdown preventDefault and act on
 * a tap that did not scroll.
 */
import { useRef, type ReactNode } from 'react';
import type { Album, Artist, Song } from '@/types';
import { ListSkeleton } from '@/components/Skeletons';
import { ClockIcon, PlayIcon, SearchIcon } from '@/components/Icons';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { letterAvatar } from '@/utils/avatar';
import { cn } from '@/utils/cn';
import type { Completion } from './rerank';

export type TypeaheadItem =
  | { kind: 'query'; text: string; source: Completion['source'] }
  | { kind: 'song'; song: Song; index: number }
  | { kind: 'artist'; artist: Artist }
  | { kind: 'album'; album: Album };

/** Rows shown per quick-hit group. */
export const TYPEAHEAD_SONGS = 4;
export const TYPEAHEAD_ARTISTS = 3;
export const TYPEAHEAD_ALBUMS = 3;

/** Completions first, then songs, artists and albums — the panel's order,
 *  and the order the arrow keys walk. */
export function typeaheadItems(
  queries: readonly Completion[],
  hits: { songs: readonly Song[]; artists: readonly Artist[]; albums: readonly Album[] },
): TypeaheadItem[] {
  return [
    ...queries.map((c): TypeaheadItem => ({ kind: 'query', text: c.text, source: c.source })),
    ...hits.songs.slice(0, TYPEAHEAD_SONGS).map((song, index): TypeaheadItem => ({ kind: 'song', song, index })),
    ...hits.artists.slice(0, TYPEAHEAD_ARTISTS).map((artist): TypeaheadItem => ({ kind: 'artist', artist })),
    ...hits.albums.slice(0, TYPEAHEAD_ALBUMS).map((album): TypeaheadItem => ({ kind: 'album', album })),
  ];
}

/** ↑/↓ with wrap-around; -1 (nothing highlighted) steps to either end. */
export function stepSelection(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}

export const optionId = (listId: string, i: number) => `${listId}-opt-${i}`;

type GraphemeSegmenter = new (locale?: string, options?: { granularity: 'grapheme' }) => {
  segment(input: string): Iterable<{ index: number; segment: string }>;
};

/** Widen [start, end) to whole character clusters, so a highlight never
 *  splits a conjunct or a vowel sign from its consonant (Indic scripts shape
 *  across those code points; a split shows broken glyphs). Without
 *  Intl.Segmenter the range is returned as it came. */
function clusterBounds(text: string, start: number, end: number): [number, number] {
  const Seg = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (!Seg) return [start, end];
  let from = start;
  let to = end;
  for (const g of new Seg(undefined, { granularity: 'grapheme' }).segment(text)) {
    const gEnd = g.index + g.segment.length;
    if (g.index < start && gEnd > start) from = g.index;
    if (g.index < end && gEnd > end) to = gEnd;
    if (g.index >= end) break;
  }
  return [from, to];
}

/** Bold the matched substring so suggestions read as completions (P2-30). */
export function Highlight({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  const [from, to] = clusterBounds(text, i, i + term.length);
  return (
    <>
      {text.slice(0, from)}
      <span className="search-hl">{text.slice(from, to)}</span>
      {text.slice(to)}
    </>
  );
}

function Option({
  id,
  selected,
  dim,
  onPick,
  onHover,
  className,
  children,
}: {
  id: string;
  selected: boolean;
  dim?: boolean;
  onPick: () => void;
  onHover: () => void;
  className?: string;
  children: ReactNode;
}) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={dim || undefined}
      className={cn('search-option', className, dim && 'is-stale')}
      onPointerDown={(e) => {
        e.preventDefault(); // keep the field focused so the panel stays open
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const p = pointer.current;
        pointer.current = null;
        if (!dim && p && Math.abs(e.clientX - p.x) < 12 && Math.abs(e.clientY - p.y) < 12) onPick();
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') onHover();
      }}
      onClick={(e) => {
        // Assistive tech "clicks" without pointer events.
        if (e.detail === 0 && !dim) onPick();
      }}
    >
      {children}
    </div>
  );
}

const onArtError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.src = FALLBACK_ART;
};

export function SearchTypeahead({
  listId,
  items,
  term,
  selected,
  loading,
  stale,
  onPick,
  onHover,
}: {
  listId: string;
  items: TypeaheadItem[];
  term: string;
  selected: number;
  loading: boolean;
  stale: boolean;
  onPick: (item: TypeaheadItem) => void;
  onHover: (index: number) => void;
}) {
  const groups: { label: string | null; key: string; rows: { item: TypeaheadItem; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const key = item.kind;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push({ item, i });
    else
      groups.push({
        key,
        label: key === 'song' ? 'Songs' : key === 'artist' ? 'Artists' : key === 'album' ? 'Albums' : null,
        rows: [{ item, i }],
      });
  });
  const hasHits = items.some((x) => x.kind !== 'query');

  const row = ({ item, i }: { item: TypeaheadItem; i: number }) => {
    const common = {
      key: `${item.kind}-${i}`,
      id: optionId(listId, i),
      selected: selected === i,
      onPick: () => onPick(item),
      onHover: () => onHover(i),
    };
    if (item.kind === 'query') {
      const Icon = item.source === 'recent' ? ClockIcon : SearchIcon;
      return (
        <Option {...common} className="is-query">
          <span className={cn('search-option-glyph', item.source === 'trending' && 'is-trend')} aria-hidden>
            {item.source === 'trending' ? <TrendGlyph /> : <Icon />}
          </span>
          <span className="search-option-text">
            <Highlight text={item.text} term={term} />
          </span>
          {item.source !== 'title' && (
            <span className="search-option-tag">{item.source === 'recent' ? 'Recent' : 'Trending'}</span>
          )}
        </Option>
      );
    }
    if (item.kind === 'song') {
      const s = item.song;
      return (
        <Option {...common} dim={stale} className="is-hit">
          <img src={bestImage(s.images, 150)} onError={onArtError} alt="" width={44} height={44} decoding="async" />
          <span className="search-quick-text">
            <span className="search-quick-title">
              <Highlight text={s.title} term={term} />
            </span>
            <span className="search-quick-sub">Song · {s.subtitle}</span>
          </span>
          <span className="search-option-play" aria-hidden>
            <PlayIcon />
          </span>
        </Option>
      );
    }
    if (item.kind === 'artist') {
      const a = item.artist;
      const art = bestImage(a.images, 150);
      return (
        <Option {...common} dim={stale} className="is-hit">
          <img
            className="is-round"
            src={art === FALLBACK_ART ? letterAvatar(a.name) : art}
            onError={onArtError}
            alt=""
            width={44}
            height={44}
            decoding="async"
          />
          <span className="search-quick-text">
            <span className="search-quick-title">
              <Highlight text={a.name} term={term} />
            </span>
            <span className="search-quick-sub">Artist</span>
          </span>
        </Option>
      );
    }
    const al = item.album;
    return (
      <Option {...common} dim={stale} className="is-hit">
        <img src={bestImage(al.images, 150)} onError={onArtError} alt="" width={44} height={44} decoding="async" />
        <span className="search-quick-text">
          <span className="search-quick-title">
            <Highlight text={al.title} term={term} />
          </span>
          <span className="search-quick-sub">Album{al.subtitle ? ` · ${al.subtitle}` : ''}</span>
        </span>
      </Option>
    );
  };

  return (
    <div className="search-panel" data-vx-overlay>
      <div id={listId} role="listbox" aria-label="Search suggestions" aria-busy={loading}>
        {groups.map((g) =>
          g.label ? (
            <div key={g.key} role="group" aria-labelledby={`${listId}-${g.key}`} className="search-panel-group">
              <p id={`${listId}-${g.key}`} className="search-panel-label" role="presentation">
                {g.label}
              </p>
              {g.rows.map(row)}
            </div>
          ) : (
            <div key={g.key} role="group" aria-label="Suggestions" className="search-panel-group">
              {g.rows.map(row)}
            </div>
          ),
        )}
      </div>
      {loading && !hasHits && (
        <div className="search-panel-loading" aria-hidden>
          <ListSkeleton rows={3} />
        </div>
      )}
    </div>
  );
}

/** A small rising line: "people search this now". */
function TrendGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}
