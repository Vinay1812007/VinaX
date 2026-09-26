import { Link } from 'react-router-dom';
import { useTutorialStore } from '@/store/tutorialStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { CheckIcon } from '@/components/Icons';

function Mark({ done, n }: { done: boolean; n: number }) {
  return <span className="vxh-step-mark" aria-hidden>{done ? <CheckIcon /> : n}</span>;
}

/** First-run checklist: three small steps, hidden once the listener has played five songs and saved one. */
export function ListeningGuide() {
  const plays = useHistoryStore((s) => s.entries.length);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const done = useTutorialStore((s) => s.done);
  if (plays >= 5 && favorites > 0) return null;
  const steps = [plays > 0, favorites > 0, done.includes('first-song')];
  const completed = steps.filter(Boolean).length;
  return (
    <section className="vxh-guide" aria-label="Getting started">
      <div>
        <h2>Get started</h2>
        <div className="vxh-guide-meter" aria-hidden>
          {steps.map((s, i) => <span key={i} className={s ? 'is-done' : undefined} />)}
        </div>
        <p className="vxh-guide-count">{completed} of 3 done</p>
      </div>
      <div className="vxh-guide-steps">
        <Link to="/search" className={plays > 0 ? 'is-done' : undefined}>
          <Mark done={plays > 0} n={1} /><span>{plays > 0 ? 'First song played' : 'Find your first song'}</span>
        </Link>
        <Link to={favorites ? '/favorites' : '/made-for-you'} className={favorites > 0 ? 'is-done' : undefined}>
          <Mark done={favorites > 0} n={2} /><span>{favorites > 0 ? 'Favourite saved' : 'Find a song to love'}</span>
        </Link>
        <button type="button" onClick={() => useTutorialStore.getState().start('first-song')} className={done.includes('first-song') ? 'is-done' : undefined}>
          <Mark done={done.includes('first-song')} n={3} /><span>{done.includes('first-song') ? 'Replay the walkthrough' : 'Take a guided tour'}</span>
        </button>
      </div>
    </section>
  );
}
