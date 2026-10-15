/**
 * 13.4.0 — the menu the top-bar avatar opens: who is signed in, the profile
 * settings (account, taste, stats), the app settings (look, playback,
 * notifications, everything) and Sign out. It loads only when opened.
 *
 * Keyboard: opens with focus on the first item; arrows rove, Home/End jump,
 * Escape closes and hands focus back to the avatar, Tab closes.
 */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut, type Account } from '@/services/auth/google';
import { isNativePlatform } from '@/services/native';
import { pushSupported } from '@/services/push';
import { toast } from '@/store/toastStore';
import { BellIcon, ClockIcon, PlayIcon, SettingsIcon, ShieldIcon, SparkleIcon, SunIcon, UsersIcon } from './Icons';

type Icon = ComponentType<{ className?: string }>;
interface Item {
  label: string;
  to: string;
  icon: Icon;
}

export const PROFILE_ITEMS: Item[] = [
  { label: 'Account & sign-in', to: '/settings#profile', icon: UsersIcon },
  { label: 'Taste profile', to: '/taste-profile', icon: SparkleIcon },
  { label: 'Listening stats', to: '/stats', icon: ClockIcon },
  { label: 'Your data & privacy', to: '/settings#your-data', icon: ShieldIcon },
];

export const APP_ITEMS: Item[] = [
  { label: 'Appearance', to: '/settings#appearance', icon: SunIcon },
  { label: 'Playback', to: '/settings#playback', icon: PlayIcon },
  { label: 'Notifications', to: '/settings#notifications', icon: BellIcon },
  { label: 'All settings', to: '/settings', icon: SettingsIcon },
];

function SignOutIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
      <path d="M15 16l4-4-4-4M19 12H9" />
    </svg>
  );
}

export default function ProfileMenu({
  account,
  name,
  avatar,
  onClose,
}: {
  account: Account | null;
  name: string;
  avatar: ReactNode;
  onClose: (refocus: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const items = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);

  useEffect(() => {
    items()[0]?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t instanceof Element && t.closest('.vx-avatar'))) return;
      onClose(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      onClose(false);
    }
  };

  const go = (to: string) => {
    onClose(false);
    navigate(to);
  };
  const row = (it: Item) => {
    const I = it.icon;
    return (
      <button key={it.label} type="button" role="menuitem" tabIndex={-1} className="vx-pmenu-item" onClick={() => go(it.to)}>
        <I className="w-5 h-5" />
        <span>{it.label}</span>
      </button>
    );
  };
  const email = account?.user.email ?? null;
  const handle = account?.user.username ?? null;

  return (
    <div ref={ref} id="vx-profile-menu" role="menu" aria-label="Profile and settings" className="vx-pmenu vx-popover vx-mat-thick" onKeyDown={onKeyDown}>
      <div className="vx-pmenu-who">
        <span className="vx-pmenu-avatar" aria-hidden>
          {avatar}
        </span>
        <span className="vx-pmenu-id">
          <span className="vx-pmenu-name">{name || 'Your profile'}</span>
          {email && <span className="vx-pmenu-sub">{email}</span>}
          {handle && <span className="vx-pmenu-sub">@{handle}</span>}
        </span>
      </div>
      <div role="group" aria-labelledby="vx-pmenu-profile">
        <p id="vx-pmenu-profile" className="vx-pmenu-label">
          Profile settings
        </p>
        {PROFILE_ITEMS.map(row)}
      </div>
      <div role="group" aria-labelledby="vx-pmenu-app">
        <p id="vx-pmenu-app" className="vx-pmenu-label">
          App settings
        </p>
        {/* Settings shows Notifications only where this device can get them. */}
        {APP_ITEMS.filter((it) => it.label !== 'Notifications' || pushSupported() || isNativePlatform()).map(row)}
      </div>
      {account && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="vx-pmenu-item is-out"
          onClick={() => {
            onClose(false);
            signOut();
            toast('Signed out');
          }}
        >
          <SignOutIcon className="w-5 h-5" />
          <span>Sign out</span>
        </button>
      )}
    </div>
  );
}
