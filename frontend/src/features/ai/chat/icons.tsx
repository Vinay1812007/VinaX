import type { ReactNode } from 'react';

/* Small inline icons the chat needs that are not in the shared set. Stroke
   icons on a 24 grid, drawn for VinaX. */
interface P {
  className?: string;
}
const line = (className?: string) => ({
  className: className ?? 'w-4 h-4',
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const MicIcon = ({ className }: P): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const SendIcon = ({ className }: P): ReactNode => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
    <path d="M12 20V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const StopIcon = ({ className }: P): ReactNode => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);
export const MenuIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const TrashIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
);
/** Panel with a rail — collapse / expand the chat list. */
export const PanelIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </svg>
);
export const CheckIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)} strokeWidth={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
/** Agent mode: a hub reaching out to three tools. */
export const AgentIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <circle cx="12" cy="12" r="2.6" />
    <path d="M12 9.4V5M9.8 13.4 6 16.2M14.2 13.4l3.8 2.8" />
    <circle cx="12" cy="3.8" r="1.3" />
    <circle cx="4.9" cy="17" r="1.3" />
    <circle cx="19.1" cy="17" r="1.3" />
  </svg>
);
export const CodeIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 5l-3 14" />
  </svg>
);
export const PageIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M13.5 3.5V8H18M8.5 12.5h7M8.5 16h5" />
  </svg>
);
export const ToolIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17v3h3l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.7 2.7-2.3-.7-.7-2.3z" />
  </svg>
);
export const FileIcon = PageIcon;
export const FolderIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 9.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z" />
  </svg>
);
export const BulbIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M9 17.5h6M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2h5c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3.5z" />
  </svg>
);
export const BookIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19v14H6.5a2 2 0 0 0-2 2z" />
    <path d="M4.5 19.5a2 2 0 0 0 2 2H19v-4M8.5 8h6.5" />
  </svg>
);
export const UploadIcon = ({ className }: P): ReactNode => (
  <svg {...line(className)}>
    <path d="M12 16V4.5M7.5 9 12 4.5 16.5 9M4.5 15.5V18A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5v-2.5" />
  </svg>
);
