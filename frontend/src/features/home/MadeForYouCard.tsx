/**
 * 13.0 — "Made for <name>": one tap builds a personal mix for the signed-in
 * listener from their own taste (favourite artists, languages, the time of
 * day). It opens AI Playlist with the request already sent: the AI curator
 * builds it while its free allowance lasts, and the on-device builder takes
 * over when it is spent or down (services/ai/playlist.ts), so the button
 * always gives a mix.
 */
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SparkleIcon } from '@/components/Icons';
import { useAccount } from '@/components/useAccount';
import { buildTasteSnapshot, type TasteSnapshot } from '@/services/ai/taste';

/** The request the card sends, from the listener's taste. Pure; exported for tests. */
export function personalMixPrompt(t: Pick<TasteSnapshot, 'topArtists' | 'preferredLanguages' | 'timeOfDay' | 'sessionVibe'>): string {
  const artists = t.topArtists.slice(0, 4);
  const langs = t.preferredLanguages.slice(0, 3);
  const parts = ['A personal mix made for me'];
  if (artists.length) parts.push(`in the spirit of ${artists.join(', ')}`);
  if (langs.length) parts.push(`in ${langs.join(' and ')}`);
  parts.push(`for this ${t.timeOfDay}${t.sessionVibe ? ` (${t.sessionVibe})` : ''}`);
  return `${parts.join(' ')}, with a few new discoveries I haven't heard.`.replace(/\s+/g, ' ');
}

export function MadeForYouCard(): ReactNode {
  const account = useAccount();
  const navigate = useNavigate();
  if (!account) return null;
  const first = (account.user.name ?? '').trim().split(/\s+/)[0] || 'you';
  const build = (): void => {
    const prompt = personalMixPrompt(buildTasteSnapshot());
    navigate(`/ai-playlist?build=${encodeURIComponent(prompt)}`);
  };
  return (
    <section className="vxh-madefor" aria-labelledby="vxh-madefor-title">
      <div className="vxh-madefor-text">
        <h2 id="vxh-madefor-title">Made for {first}</h2>
        <p>A fresh mix from your favourite artists, languages and the time of day. Built by AI, from your own taste.</p>
      </div>
      <button type="button" className="vxh-pill" onClick={build}>
        <SparkleIcon className="w-4 h-4" /> Build my mix
      </button>
    </section>
  );
}
