import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { jamPath, type PublicProfile } from '@/services/social/api';

/**
 * v23 — Join a friend's Listen Together room: shown only when the server sent
 * a room code with their profile (it does so only for people who follow each
 * other, while the room is live, and while they let people join). A plain
 * link to the Listen Together page: nothing of the Together engine loads.
 * Home's "Friends are listening", the People tab on /following and a profile
 * page all use this one rule.
 */
export function JoinRoomLink({ profile, className, children = 'Join' }: { profile: Pick<PublicProfile, 'handle' | 'name' | 'jamCode'>; className?: string; children?: ReactNode }) {
  if (!profile.jamCode) return null;
  return (
    <Link to={jamPath(profile.jamCode)} className={className} aria-label={`Join ${profile.name ?? profile.handle}'s room`}>
      {children}
    </Link>
  );
}
