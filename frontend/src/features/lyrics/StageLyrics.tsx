import { SyncedLyrics } from '@/components/SyncedLyrics';
import { MicIcon } from '@/components/Icons';
import { cn } from '@/utils/cn';

/** What the lyrics hook resolves to: timed lines, plain text, either or neither. */
interface StageLyricsData {
  synced: Array<{ t: number; text: string }> | null;
  plain: string | null;
}

/** Widths of the loading bars: a ragged edge reads as "lines of a song". */
const SKELETON_WIDTHS = ['72%', '58%', '84%', '46%', '66%', '52%'];

/**
 * 9.0 — the full-screen player's lyrics, in every state: loading bars, synced
 * lines that follow the song (the active line bright, the rest quiet), plain
 * text when nobody timed them, and a calm empty state when no source has any.
 * The panel tab and the immersive layer both render this. Sized by
 * styles/pages/player.css (`.vx-lyrics-stage`, `.vx-np-lyrics-*`).
 */
export function StageLyrics({
  lyrics,
  layer,
}: {
  lyrics: { data?: StageLyricsData | null; isLoading: boolean };
  /** `panel`: the tab beside / under the player. `immersive`: the full-viewport layer. */
  layer: 'panel' | 'immersive';
}) {
  const { data, isLoading } = lyrics;
  if (isLoading && !data) {
    return (
      <div className={cn('vx-np-lyrics-loading', layer === 'immersive' && 'is-immersive')} role="status" aria-label="Loading lyrics">
        {SKELETON_WIDTHS.map((w, i) => (
          <span key={i} className="skeleton" style={{ width: w }} />
        ))}
      </div>
    );
  }
  if (data?.synced) {
    return <SyncedLyrics lines={data.synced} live size="stage" className={layer === 'immersive' ? 'vx-np-lyrics-pad-immersive' : 'vx-np-lyrics-pad'} />;
  }
  if (data?.plain) {
    return (
      <div className={layer === 'immersive' ? 'vx-np-lyrics-pad-immersive' : 'vx-np-lyrics-pad'}>
        <p className="vx-np-lyrics-note">These lyrics aren’t timed to the song.</p>
        <div className="vx-np-lyrics-plain">{data.plain}</div>
      </div>
    );
  }
  return (
    <div className={cn('vx-np-lyrics-empty', layer === 'immersive' && 'is-immersive')}>
      <span className="vx-np-lyrics-empty-badge" aria-hidden>
        <MicIcon />
      </span>
      <p className="vx-np-lyrics-empty-title">No lyrics for this song yet</p>
      <p className="vx-np-lyrics-empty-text">When a source has them, they show up here.</p>
    </div>
  );
}
