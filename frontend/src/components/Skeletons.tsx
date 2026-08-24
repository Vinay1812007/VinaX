export function ShelfSkeleton() {
  return (
    <div className="mb-8">
      <div className="skeleton h-6 w-48 mb-4" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-36 sm:w-40 shrink-0">
            <div className="skeleton aspect-square rounded-xl" />
            <div className="skeleton h-3.5 w-3/4 mt-2.5" />
            <div className="skeleton h-3 w-1/2 mt-1.5" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="skeleton w-11 h-11 rounded-lg shrink-0" />
          <div className="flex-1">
            <div className="skeleton h-3.5 w-1/2" />
            <div className="skeleton h-3 w-1/3 mt-1.5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="flex items-end gap-6 mb-8">
      <div className="skeleton w-40 h-40 sm:w-52 sm:h-52 rounded-2xl shrink-0" />
      <div className="flex-1">
        <div className="skeleton h-4 w-20 mb-3" />
        <div className="skeleton h-8 w-2/3 mb-3" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="pt-4">
      <div className="skeleton h-8 w-56 mb-8" />
      <ShelfSkeleton />
      <ShelfSkeleton />
    </div>
  );
}

export function CardGridSkeleton({ cards = 12 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="p-2.5">
          <div className="skeleton aspect-square rounded-xl" />
          <div className="skeleton h-3.5 w-3/4 mt-2.5" />
          <div className="skeleton h-3 w-1/2 mt-1.5" />
        </div>
      ))}
    </div>
  );
}
