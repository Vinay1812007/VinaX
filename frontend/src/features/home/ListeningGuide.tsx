import { Link } from 'react-router-dom';
import { useTutorialStore } from '@/store/tutorialStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';

export function ListeningGuide() {
  const plays = useHistoryStore((s) => s.entries.length);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const done = useTutorialStore((s) => s.done);
  if (plays >= 5 && favorites > 0) return null;
  const completed = Number(plays > 0) + Number(favorites > 0) + Number(done.includes('first-song'));
  return (
    <section className="vx-listening-guide" aria-label="Getting started">
      <div>
        <p className="vx-eyebrow">MAKE YOURSELF AT HOME · {completed}/3</p>
        <h2>A little listening goes a long way.</h2>
        <p>Play a song, save a favourite, and let your next mix take shape.</p>
      </div>
      <div className="vx-guide-actions">
        <Link to="/search">
          {plays > 0 ? '✓ First song played' : '01 Find your first song'} <span>↗</span>
        </Link>
        <Link to={favorites ? '/favorites' : '/made-for-you'}>
          {favorites > 0 ? '✓ Favourite saved' : '02 Find a song to love'} <span>↗</span>
        </Link>
        <button onClick={() => useTutorialStore.getState().start('first-song')}>
          {done.includes('first-song') ? '✓ Replay the walkthrough' : '03 Take a guided tour'}{' '}
          <span>↗</span>
        </button>
      </div>
    </section>
  );
}
