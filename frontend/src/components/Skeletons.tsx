/**
 * 8.0 — loading shapes that match the real cards and rows, so nothing jumps
 * when data lands: square 8px-radius art + a title line + a shorter subtitle
 * line for cards; 56px art + two lines for rows.
 */
function CardBones() {
  return (
    <>
      <div className="skeleton aspect-square rounded-lg" />
      <div className="skeleton h-3.5 w-4/5 mt-3 rounded" />
      <div className="skeleton h-3 w-1/2 mt-2 rounded" />
    </>
  );
}

export function ShelfSkeleton() {
  return (
    <div className="mb-8 md:mb-10">
      <div className="skeleton h-5 w-44 mb-4 rounded" />
      <div className="flex gap-3 md:gap-4 overflow-hidden">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-40 md:w-44 shrink-0">
            <CardBones />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 min-h-[68px] px-2.5 py-1.5">
          <div className="skeleton w-14 h-14 rounded-md shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="skeleton h-3.5 w-1/2 rounded" />
            <div className="skeleton h-3 w-1/3 mt-2 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    // Mirrors the real hero (.vx-entity-hero on Album / Artist / Playlist): a
    // column with centred 200px art on phones, an end-aligned row with fluid
    // art from md up — so nothing jumps when the data lands.
    <div className="vx-entity-hero" role="status" aria-label="Loading">
      <div className="skeleton shrink-0 aspect-square w-[200px] self-center md:self-auto md:w-[clamp(160px,18vw,232px)] rounded-xl" />
      <div className="flex-1 w-full min-w-0">
        <div className="skeleton h-3 w-16 mb-4 rounded" />
        <div className="skeleton h-10 w-2/3 mb-4 rounded-md" />
        <div className="skeleton h-3.5 w-1/3 rounded" />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="pt-4" role="status" aria-label="Loading your listening space">
      <div className="skeleton h-8 w-56 mb-8 rounded-md" />
      <ShelfSkeleton />
      <ShelfSkeleton />
    </div>
  );
}

export function CardGridSkeleton({ cards = 12 }: { cards?: number }) {
  return (
    // auto-fill, not breakpoint counts: columns follow the space actually left
    // after the sidebar and the now-playing rail, not the viewport width.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-3 gap-y-6 md:gap-x-4">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i}>
          <CardBones />
        </div>
      ))}
    </div>
  );
}
