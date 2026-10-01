/**
 * 9.0 — small glyphs the library surfaces need and the shared icon set does
 * not carry. Same 24px grid and 1.8 stroke as components/Icons.tsx.
 */
const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** A push pin: pinned playlists list first. */
export const PinIcon = ({ className }: { className?: string }) => (
  <svg {...stroke} className={className ?? 'w-4 h-4'}>
    <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z" />
    <path d="M12 14v6" />
  </svg>
);

/** A filled pin for the small "pinned" marker in rows. */
export const PinMarkIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className ?? 'w-3.5 h-3.5'}>
    <path d="M8.5 3h7a1 1 0 0 1 .98 1.2L15.6 8.6l2.8 2.8c.38.38.6.89.6 1.42V14a1 1 0 0 1-1 1h-5v5.25a1 1 0 1 1-2 0V15H6a1 1 0 0 1-1-1v-1.18c0-.53.21-1.04.59-1.42L8.4 8.6 7.52 4.2A1 1 0 0 1 8.5 3z" />
  </svg>
);

/** A safe with an arrow: back up and restore. */
export const BackupIcon = ({ className }: { className?: string }) => (
  <svg {...stroke} className={className ?? 'w-5 h-5'}>
    <path d="M4 7.5C4 6.1 7.6 5 12 5s8 1.1 8 2.5S16.4 10 12 10 4 8.9 4 7.5z" />
    <path d="M4 7.5v4C4 12.9 7.6 14 12 14s8-1.1 8-2.5v-4" />
    <path d="M4 11.5v4C4 16.9 7.6 18 12 18c1 0 2-.06 2.9-.17" />
    <path d="M18 14v6M15.5 17.5 18 20l2.5-2.5" />
  </svg>
);

/** A phone handing over to another: move to a new device. */
export const HandoffIcon = ({ className }: { className?: string }) => (
  <svg {...stroke} className={className ?? 'w-5 h-5'}>
    <rect x="3" y="5" width="8" height="14" rx="2" />
    <rect x="15" y="5" width="6" height="11" rx="1.6" />
    <path d="M11.5 10.5h3M13 9l1.5 1.5L13 12" />
  </svg>
);

/** Lines of text flowing into a list: import a playlist from text. */
export const ImportTextIcon = ({ className }: { className?: string }) => (
  <svg {...stroke} className={className ?? 'w-5 h-5'}>
    <path d="M4 6h11M4 10.5h11M4 15h6" />
    <path d="M18 9v10M15 16l3 3 3-3" />
  </svg>
);
