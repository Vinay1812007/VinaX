/** Original minimal icon set — no third-party icon assets. */
interface IconProps {
  className?: string;
}

const base = (className?: string) => ({
  className: className ?? 'w-5 h-5',
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const PlayIcon = ({ className }: IconProps) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);
export const PauseIcon = ({ className }: IconProps) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);
export const NextIcon = ({ className }: IconProps) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <path d="M5 5.5v13l9-6.5z" />
    <rect x="16" y="5" width="3" height="14" rx="1" />
  </svg>
);
export const PrevIcon = ({ className }: IconProps) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <path d="M19 5.5v13l-9-6.5z" />
    <rect x="5" y="5" width="3" height="14" rx="1" />
  </svg>
);
export const ShuffleIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);
export const RepeatIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>
);
export const HeartIcon = ({ className, filled }: IconProps & { filled?: boolean }) => (
  <svg {...base(className)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 000-7.8z" />
  </svg>
);
export const SearchIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
export const HomeIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);
export const CompassIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" />
  </svg>
);
export const LibraryIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 4v16M9 4v16M14 5l5 15" />
  </svg>
);
export const SettingsIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a7.7 7.7 0 00.1-6l2-1.6-2-3.4-2.4 1a7.8 7.8 0 00-5.2-3L11.5 0h-.1L11 2a7.8 7.8 0 00-5.2 3l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 00.1 6l-2 1.6 2 3.4 2.4-1a7.8 7.8 0 005.1 3l.5 2h.1l.4-2a7.8 7.8 0 005.2-3l2.4 1 2-3.4z" />
  </svg>
);
export const QueueIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3 6h13M3 12h13M3 18h7M19 14v-4l3 2z" />
  </svg>
);
export const VolumeIcon = ({ className, muted }: IconProps & { muted?: boolean }) => (
  <svg {...base(className)}>
    <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    {muted ? <path d="M16 9l6 6M22 9l-6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18.5 6a9 9 0 010 12" />}
  </svg>
);
export const DotsIcon = ({ className }: IconProps) => (
  <svg {...base(className)} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);
export const SparkleIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
    <path d="M19 16l1 2.5L22.5 19.5 20 20.5 19 23l-1-2.5-2.5-1L18 18.5z" />
  </svg>
);
export const GlobeIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
  </svg>
);
export const FilmIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 15h18M9 4v16M15 4v16" />
  </svg>
);
export const MusicIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="7" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
    <path d="M10 18V5l10-2v13" />
  </svg>
);
export const ClockIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

export const DevicesIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

export const UsersIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.5a3 3 0 0 1 0 5.5" />
    <path d="M18.5 20c0-2.2-1-3.8-2.6-4.6" />
  </svg>
);
export const XIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const PlusIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const ShareIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <path d="M8.6 10.7l6.8-3.4M8.6 13.3l6.8 3.4" />
  </svg>
);
export const SunIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const MoonIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </svg>
);
export const ChevronDownIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const WaveIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M2 14q2.5-4 5 0t5 0 5 0 5 0" />
    <path d="M2 18q2.5-3 5 0t5 0 5 0 5 0" opacity="0.6" />
  </svg>
);

export const HelpIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ShieldIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export function WaveformIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  );
}

/** Two-line grip for drag-to-reorder handles (queue rows). */
export function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M5 9h14M5 15h14" />
    </svg>
  );
}
