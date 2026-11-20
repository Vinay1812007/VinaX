import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import { useSongDetails } from './useSongDetails';
import { songCredits } from './credits';
import { isEpisode } from '@/features/podcasts/paths';

/**
 * 1.20.1 — the Credits tab: Singers, Music, Lyrics and Starring, each name a
 * link, then Film, Label and Released. A song saved before its credits were
 * kept asks the catalogue for them once (the same cached lookup the song page uses).
 */
export function CreditsPanel({ song, filmTitle, tx }: { song: Song; filmTitle: string | null; tx: (key: string) => string }) {
  const needsLookup = !song.credits?.length && !isEpisode(song) && !song.generated;
  const details = useSongDetails(needsLookup ? song.id : undefined);
  const full = needsLookup && details.data?.id === song.id ? { ...song, credits: details.data.credits, label: song.label ?? details.data.label, copyright: song.copyright ?? details.data.copyright } : song;
  const c = songCredits(full, filmTitle);
  const facts: Array<[string, string, string | null]> = [
    ...(c.source ? [[c.source.role, c.source.name, c.source.to] as [string, string, string]] : []),
    ...(c.label ? [['Label', c.label, null] as [string, string, null]] : []),
    ...(c.year ? [['Released', c.year, null] as [string, string, null]] : []),
  ];
  if (!c.groups.length && !facts.length) {
    return <p className="vx-np-empty">{tx(needsLookup && details.isLoading ? 'Loading credits…' : 'No credits for this song yet.')}</p>;
  }
  return (
    <div className="vx-np-about-block">
      <h3 className="vx-np-about-label">{tx('Credits')}</h3>
      <dl className="vx-credits">
        {c.groups.map((g) => (
          <div key={g.role} className="vx-credits-row">
            <dt>{tx(g.role)}</dt>
            <dd>
              {g.people.map((p, i) => (
                <span key={p.name}>
                  {i > 0 && ', '}
                  <Link to={p.to}>{p.name}</Link>
                </span>
              ))}
            </dd>
          </div>
        ))}
        {facts.map(([role, name, to]) => (
          <div key={role} className="vx-credits-row">
            <dt>{tx(role)}</dt>
            <dd>{to ? <Link to={to}>{name}</Link> : name}</dd>
          </div>
        ))}
      </dl>
      {c.copyright && <p className="vx-credits-copy">{c.copyright}</p>}
    </div>
  );
}
