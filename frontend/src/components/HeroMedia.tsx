import type { ReactNode } from 'react';

/** Entity hero layout only. Fetching, metadata, artwork and actions stay with the page. */
export function HeroMedia({ children }: { children: ReactNode }) {
  return <header className="vx-entity-hero">{children}</header>;
}
