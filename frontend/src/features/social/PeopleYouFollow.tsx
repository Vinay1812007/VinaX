import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EntityHeader, EntityMeta, GlyphCover } from '@/components/EntityHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { UsersIcon } from '@/components/Icons';
import { currentAccount } from '@/services/auth/google';
import { useSocialStore } from '@/features/social/store';
import { JoinRoomLink } from '@/features/social/JoinRoomLink';
import { parseHandle } from '@/features/social/handle';
import { letterAvatar } from '@/utils/avatar';
import { toast } from '@/store/toastStore';
import type { PublicProfile } from '@/services/social/api';

/**
 * /following → People: every listener you follow (the list GET /api/follow
 * returns, kept on the device), not only the ones sharing what they play on
 * Home. Open a profile, Join a room a friend lets you into, Unfollow, or find
 * someone by their handle.
 */
export function PeopleYouFollow() {
  const signedIn = !!currentAccount();
  const following = useSocialStore((s) => s.following);
  const profile = useSocialStore((s) => s.profile);
  const list = Array.isArray(following) ? following : [];
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (signedIn) void useSocialStore.getState().refresh();
  }, [signedIn]);

  const unfollow = async (p: PublicProfile): Promise<void> => {
    const who = p.name ?? p.handle;
    setPending(p.handle);
    const still = await useSocialStore.getState().follow(p.handle, false);
    setPending(null);
    if (still) toast('Could not unfollow right now');
    else toast(`Unfollowed ${who}`, { action: { label: 'Undo', onClick: () => void useSocialStore.getState().follow(p.handle, true) } });
  };

  return (
    <div className="vx-entity">
      <EntityHeader
        kind="Following"
        title="People you follow"
        art={<GlyphCover tone="smart" icon={<UsersIcon />} />}
        meta={<EntityMeta items={[signedIn ? `${list.length} ${list.length === 1 ? 'person' : 'people'}` : null, profile && typeof profile.followers === 'number' ? `${profile.followers} follower${profile.followers === 1 ? '' : 's'}` : null]} />}
      />

      <FindByHandle />

      <section className="vx-sec-block" aria-label="People you follow">
        {!signedIn ? (
          <>
            <SectionHeader title="Your people" explanation="Sign in to follow listeners. Their profiles, and a Join button when they host Listen Together, show here." />
            <Link to="/login" className="vx-tap px-5 min-h-[44px] inline-flex items-center rounded-full btn-primary font-semibold">Sign in</Link>
          </>
        ) : !list.length ? (
          <SectionHeader title="Your people" explanation="You follow nobody yet. Open a listener’s profile and press Follow, or find them by handle above." />
        ) : (
          <>
            <SectionHeader title="Your people" explanation="Tap to open a profile." />
            <ul className="vx-group">
              {list.map((p) => {
                const who = p.name ?? p.handle;
                return (
                  <li key={p.handle} className="vx-row">
                    <Link to={`/u/${p.handle}`} className="flex items-center gap-3 flex-1 min-w-0" aria-label={`${who}'s profile`}>
                      <img src={p.picture || letterAvatar(who)} onError={(e) => ((e.target as HTMLImageElement).src = letterAvatar(who))} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                      <span className="vx-row-main">
                        <span className="vx-row-label truncate-1">{who}</span>
                        <span className="vx-row-hint truncate-1">@{p.handle}{p.nowPlaying?.title ? ` · Playing ${p.nowPlaying.title}` : ''}</span>
                      </span>
                    </Link>
                    <JoinRoomLink profile={p} className="vx-tap px-4 min-h-[36px] inline-flex items-center rounded-full btn-primary text-[13px] font-semibold shrink-0" />
                    <button type="button" onClick={() => void unfollow(p)} disabled={pending === p.handle} aria-label={`Unfollow ${who}`} className="vx-tap px-4 min-h-[36px] rounded-full btn-secondary text-[13px] font-semibold shrink-0 disabled:opacity-60">
                      Unfollow
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** "Find by handle": type `name`, `@name` or a profile link, and the profile opens. */
function FindByHandle() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const handle = parseHandle(text);
    if (!handle) { setBad(true); return; }
    navigate(`/u/${handle}`);
  };
  return (
    <section className="vx-sec-block" aria-label="Find by handle">
      <SectionHeader title="Find by handle" explanation="Type someone’s handle, or paste their profile link." />
      <form onSubmit={submit} className="flex items-center gap-2 max-w-md">
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setBad(false); }}
          placeholder="@handle"
          aria-label="Handle"
          aria-invalid={bad || undefined}
          className={`vx-sec-field flex-1 min-w-0${bad ? ' is-invalid' : ''}`}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <button type="submit" disabled={!text.trim()} className="vx-tap px-5 min-h-[44px] rounded-full btn-primary font-semibold shrink-0 disabled:opacity-60">Open</button>
      </form>
      {bad && <p className="mt-2 text-[12.5px] text-ink-400">A handle is 3–20 letters, digits or underscores.</p>}
    </section>
  );
}
