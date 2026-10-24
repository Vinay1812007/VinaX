import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Row, RowButton, Toggle } from '@/features/settings/SettingsControls';
import { currentAccount } from '@/services/auth/google';
import { useSocialStore } from '@/features/social/store';
import { toast } from '@/store/toastStore';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * 15.0 — Settings → Profile → Public profile: a handle, a line, the public
 * switch and "share what I'm playing". The profile exists only once the
 * listener saves a handle; "Remove my profile" deletes it and every follow.
 */
export function ProfileSettings() {
  const account = currentAccount();
  const profile = useSocialStore((s) => s.profile);
  const busy = useSocialStore((s) => s.busy);
  const [handle, setHandle] = useState(profile?.handle ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  useEffect(() => { setHandle(profile?.handle ?? ''); setBio(profile?.bio ?? ''); }, [profile?.handle, profile?.bio]);
  if (!account) return <Row label="Public profile" note="Sign in with Google to make a profile other listeners can follow."><span className="text-[13px] text-ink-400">Signed out</span></Row>;

  const valid = HANDLE_RE.test(handle.trim().toLowerCase());
  const dirty = handle.trim().toLowerCase() !== (profile?.handle ?? '') || (bio.trim() || '') !== (profile?.bio ?? '');
  const save = async () => {
    const p = await useSocialStore.getState().save({ handle: handle.trim().toLowerCase(), bio: bio.trim() || null, ...(profile ? {} : { public: true }) });
    const err = useSocialStore.getState().error;
    if (p) toast(profile ? 'Profile saved' : `Your profile is live at /u/${p.handle}`);
    else toast(err === 'taken' ? 'That handle is taken' : 'Could not save your profile');
  };

  return (
    <>
      <Row stack label="Public profile" note="A page other listeners can follow: your name and picture, a line, your top artists and languages, and your recent likes. Off by default; switch it on and pick a handle." keywords="profile handle follow friends social public">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-400">/u/</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="your_handle" maxLength={20} aria-label="Handle" className="vx-set-input w-44 font-mono" spellCheck={false} autoCapitalize="none" />
            <RowButton onClick={() => void save()} disabled={busy || !valid || !dirty}>{profile ? 'Save' : 'Create profile'}</RowButton>
          </div>
          {handle && !valid && <p className="text-[12.5px] text-ink-400">3–20 letters, digits or underscores.</p>}
          <input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you (optional)" maxLength={160} aria-label="Profile line" className="vx-set-input w-full max-w-md" />
          {profile && (
            <p className="text-[12.5px] text-ink-400">
              <Link to={`/u/${profile.handle}`} className="font-semibold text-ember-400 hover:underline">Open your profile</Link>
              {typeof profile.followers === 'number' && <> · {profile.followers} follower{profile.followers === 1 ? '' : 's'}</>}
            </p>
          )}
        </div>
      </Row>
      {profile && (
        <>
          <Row label="Visible to everyone" note="Off: only people you follow who follow you back can see it." keywords="private public profile">
            <Toggle on={profile.public} onChange={(v) => void useSocialStore.getState().save({ public: v })} label="Visible to everyone" disabled={busy} />
          </Row>
          <Row label="Share what I'm playing" note="Friends see the song you have on, for a few minutes after you play it." keywords="now playing friends listening">
            <Toggle on={!!profile.shareNow} onChange={(v) => void useSocialStore.getState().save({ shareNow: v, ...(v ? {} : { nowPlaying: null }) })} label="Share what I'm playing" disabled={busy} />
          </Row>
          <Row label="Remove my profile" note="Deletes the page and every follow. Your library and account stay.">
            <RowButton tone="danger" disabled={busy} onClick={() => { if (window.confirm('Remove your public profile and all follows?')) void useSocialStore.getState().remove().then(() => toast('Profile removed')); }}>Remove</RowButton>
          </Row>
        </>
      )}
    </>
  );
}
