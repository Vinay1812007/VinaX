/** VinaX AI — the few icons the chat needs, kept in its own lazy chunk. */
interface P { className?: string }
const base = (className?: string) => ({
  className: className ?? 'w-5 h-5', viewBox: '0 0 24 24', fill: 'none' as const, stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const ArrowUpIcon = ({ className }: P) => (<svg {...base(className)}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>);
export const ArrowDownIcon = ({ className }: P) => (<svg {...base(className)}><path d="M12 5v14M5.5 12.5 12 19l6.5-6.5" /></svg>);
export const ArrowLeftIcon = ({ className }: P) => (<svg {...base(className)}><path d="M19 12H5M11.5 5.5 5 12l6.5 6.5" /></svg>);
export const StopIcon = ({ className }: P) => (<svg {...base(className)} fill="currentColor" stroke="none"><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></svg>);
export const CopyIcon = ({ className }: P) => (<svg {...base(className)}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></svg>);
export const RetryIcon = ({ className }: P) => (<svg {...base(className)}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" /></svg>);
export const NewChatIcon = ({ className }: P) => (<svg {...base(className)}><path d="M12 5.5H7a2.5 2.5 0 0 0-2.5 2.5v9A2.5 2.5 0 0 0 7 19.5h9a2.5 2.5 0 0 0 2.5-2.5v-5M16.5 4.5l3 3L12 15H9v-3z" /></svg>);
export const ChevronIcon = ({ className }: P) => (<svg {...base(className)}><path d="m9 6 6 6-6 6" /></svg>);
export const PlaySmallIcon = ({ className }: P) => (<svg {...base(className)} fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z" /></svg>);
export const PauseSmallIcon = ({ className }: P) => (<svg {...base(className)} fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>);
export const SparkIcon = ({ className }: P) => (<svg {...base(className)}><path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5zM18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.2-2.2.9-2.5 2.5-.3-1.6-1-2.3-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z" /></svg>);
export const ChevronDownSmallIcon = ({ className }: P) => (<svg {...base(className)}><path d="m6 9 6 6 6-6" /></svg>);
export const MenuIcon = ({ className }: P) => (<svg {...base(className)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
export const PlusSmallIcon = ({ className }: P) => (<svg {...base(className)}><path d="M12 5v14M5 12h14" /></svg>);
export const PencilIcon = ({ className }: P) => (<svg {...base(className)}><path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z" /></svg>);
export const DotsIcon = ({ className }: P) => (<svg {...base(className)} fill="currentColor" stroke="none"><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></svg>);
export const StarIcon = ({ className, filled }: P & { filled?: boolean }) => (<svg {...base(className)} fill={filled ? 'currentColor' : 'none'}><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z" /></svg>);
export const TrashIcon = ({ className }: P) => (<svg {...base(className)}><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>);
export const SearchSmallIcon = ({ className }: P) => (<svg {...base(className)}><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>);
export const SidebarIcon = ({ className }: P) => (<svg {...base(className)}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></svg>);
export const ThinkIcon = ({ className }: P) => (<svg {...base(className)}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z" /></svg>);
export const ContinueIcon = ({ className }: P) => (<svg {...base(className)}><path d="M5 12h12M13 6l6 6-6 6" /></svg>);
export const CloseIcon = ({ className }: P) => (<svg {...base(className)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
