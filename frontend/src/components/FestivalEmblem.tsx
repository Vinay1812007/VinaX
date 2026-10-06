import { EMBLEMS, type EmblemId } from '@/constants/festivalEmblems';

/** A drawn festival emblem; colours come from the active skin (festivals.css). */
export function FestivalEmblem({ id, className = '' }: { id: EmblemId; className?: string }) {
  return (
    <svg
      className={`fest-emblem ${className}`.trim()}
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      // Static, in-repo markup (constants/festivalEmblems.ts) — never user content.
      dangerouslySetInnerHTML={{ __html: EMBLEMS[id] }}
    />
  );
}
