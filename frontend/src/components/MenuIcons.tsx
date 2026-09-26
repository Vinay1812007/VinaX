/**
 * 8.0.0 — glyphs for the song menu, drawn to the same 24px grid, 1.8 stroke
 * and round caps as Icons.tsx. Decorative: every item they sit in is named
 * by its text, so each svg is aria-hidden.
 */
import type { ReactElement } from 'react';

type Glyph = () => ReactElement;

const svg = (children: ReactElement | ReactElement[]): ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const MENU_GLYPHS = {
  radio: () => svg([<circle key="a" cx="12" cy="12" r="2" />, <path key="b" d="M8.5 15.5a5 5 0 010-7M15.5 8.5a5 5 0 010 7M5.6 18.4a9 9 0 010-12.8M18.4 5.6a9 9 0 010 12.8" />]),
  playNext: () => svg([<path key="a" d="M4 6h10M4 11h10M4 16h6" />, <path key="b" d="M16 13.5v6l5-3z" fill="currentColor" stroke="none" />]),
  addQueue: () => svg(<path d="M4 6h12M4 11h12M4 16h7M18 14v6M15 17h6" />),
  moreLike: () => svg(<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 012 2v4h5.5a2 2 0 012 2.3l-1.2 7A2 2 0 0117.3 20H7" />),
  lessLike: () => svg(<path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 01-2-2v-4H5.5a2 2 0 01-2-2.3l1.2-7A2 2 0 016.7 4H17" />),
  why: () => svg([<circle key="a" cx="12" cy="12" r="9" />, <path key="b" d="M12 11v5M12 8h.01" />]),
  later: () => svg(<path d="M6 3.5h12v17l-6-4-6 4z" />),
  details: () => svg([<rect key="a" x="4" y="3.5" width="16" height="17" rx="2.5" />, <path key="b" d="M8 8.5h8M8 12h8M8 15.5h5" />]),
  history: () => svg([<path key="a" d="M3.5 12a8.5 8.5 0 102.5-6" />, <path key="b" d="M3.5 4v4h4M12 8v4.5l3 2" />]),
  album: () => svg([<circle key="a" cx="12" cy="12" r="8.5" />, <circle key="b" cx="12" cy="12" r="2.5" />]),
  artist: () => svg([<circle key="a" cx="12" cy="8" r="4" />, <path key="b" d="M4.5 20.5c.8-3.7 3.8-6 7.5-6s6.7 2.3 7.5 6" />]),
  lyrics: () => svg(<path d="M4 6h16M4 11h16M4 16h9M17 14.5v6M17 14.5l3.5 1" />),
  download: () => svg(<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />),
  addTo: () => svg(<path d="M4 6h11M4 11h11M4 16h6M17 13v8M13 17h8" />),
  newList: () => svg([<rect key="a" x="3.5" y="3.5" width="17" height="17" rx="3" />, <path key="b" d="M12 8v8M8 12h8" />]),
  report: () => svg(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />),
  notInterested: () => svg([<circle key="a" cx="12" cy="12" r="8.5" />, <path key="b" d="M6 6l12 12" />]),
  neverPlay: () => svg([<circle key="a" cx="10" cy="8" r="4" />, <path key="b" d="M3 20.5c.7-3.5 3.5-5.7 7-5.9M15.5 15.5l5 5M20.5 15.5l-5 5" />]),
  share: () => svg(<path d="M12 3.5v12M7.5 8L12 3.5 16.5 8M5 12.5v6a2 2 0 002 2h10a2 2 0 002-2v-6" />),
  message: () => svg(<path d="M20.5 11.5a8.5 8.5 0 01-12.3 7.6L3.5 20.5l1.4-4.4a8.5 8.5 0 1115.6-4.6z" />),
  send: () => svg(<path d="M21 3.5L10.5 14M21 3.5l-6.5 17-4-6.5-6.5-4z" />),
  image: () => svg([<rect key="a" x="3.5" y="4.5" width="17" height="15" rx="2.5" />, <circle key="b" cx="9" cy="10" r="1.8" />, <path key="c" d="M20.5 16l-5-5-9 8.5" />]),
  story: () => svg([<rect key="a" x="6.5" y="2.5" width="11" height="19" rx="2.5" />, <path key="b" d="M10.5 18.5h3" />]),
  back: () => svg(<path d="M15 5l-7 7 7 7" />),
  chevron: () => svg(<path d="M9 5l7 7-7 7" />),
  clock: () => svg([<circle key="a" cx="12" cy="12" r="8.5" />, <path key="b" d="M12 7.5V12l3 2" />]),
  generic: () => svg(<circle cx="12" cy="12" r="1.5" />),
} satisfies Record<string, Glyph>;

export type MenuGlyph = keyof typeof MENU_GLYPHS;
