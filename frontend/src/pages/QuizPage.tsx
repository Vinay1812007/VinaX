import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Song } from '@/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useContinueListening } from '@/features/home/useHomeShelves';
import { useInfiniteSongs, flattenSongPages } from '@/features/search/useInfiniteSongs';
import { trendingSeed } from '@/constants/seeds';
import { getLocal, setLocal } from '@/services/storage/local';
import { bestImage } from '@/utils/images';
import { cn } from '@/utils/cn';
import { PlayIcon, SparkleIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

const TOTAL = 8;
const BEST_KEY = 'vinax.quiz.best';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Phase = 'intro' | 'round' | 'reveal' | 'done';

export default function QuizPage() {
  usePageTitle('Music Quiz');
  const playSong = usePlayerStore((s) => s.playSong);
  const lang = useSettingsStore((s) => s.pinnedLanguages[0] ?? 'hindi');
  const personal = useContinueListening(40);
  const trending = useInfiniteSongs(trendingSeed(lang));

  const pool = useMemo(() => {
    const seen = new Set<string>();
    const out: Song[] = [];
    for (const s of [...personal, ...flattenSongPages(trending.data?.pages)]) {
      if (!s || !s.id || !s.title || !s.subtitle || !s.images?.length) continue;
      const key = `${s.title}|${s.subtitle}`.toLowerCase();
      if (seen.has(s.id) || seen.has(key)) continue;
      seen.add(s.id);
      seen.add(key);
      out.push(s);
    }
    return out;
  }, [personal, trending.data]);

  const [phase, setPhase] = useState<Phase>('intro');
  const [order, setOrder] = useState<Song[]>([]);
  const [idx, setIdx] = useState(0);
  const [options, setOptions] = useState<Song[]>([]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(() => getLocal<number>(BEST_KEY, 0));

  const correct = order[idx];

  function startRound(seq: Song[], i: number) {
    const c = seq[i];
    const distractors = shuffle(pool.filter((s) => s.id !== c.id)).slice(0, 3);
    setOptions(shuffle([c, ...distractors]));
    setChosenId(null);
    setIdx(i);
    setPhase('round');
    playSong(c);
  }

  function begin() {
    if (pool.length < 4) return;
    const seq = shuffle(pool).slice(0, Math.min(TOTAL, pool.length));
    setOrder(seq);
    setScore(0);
    setStreak(0);
    startRound(seq, 0);
  }

  function answer(opt: Song) {
    if (chosenId) return;
    setChosenId(opt.id);
    if (opt.id === correct.id) {
      setScore((v) => v + 1);
      setStreak((v) => {
        const ns = v + 1;
        if (ns > best) {
          setBest(ns);
          setLocal(BEST_KEY, ns);
        }
        return ns;
      });
    } else {
      setStreak(0);
    }
    setPhase('reveal');
  }

  function next() {
    if (idx + 1 >= order.length) setPhase('done');
    else startRound(order, idx + 1);
  }

  // ---- Intro ----
  if (phase === 'intro' || phase === 'done') {
    const finished = phase === 'done';
    return (
      <div className="vx-sec is-narrow text-center pt-6">
        <span className="vx-empty-icon mx-auto" aria-hidden>
          <SparkleIcon className="w-9 h-9" />
        </span>
        <h1 className="vx-page-title mb-2">
          {finished ? 'Nice run' : 'Guess the song'}
        </h1>
        {finished ? (
          <>
            <p className="text-[15px] text-ink-400 mb-6">You scored {score} of {order.length}.</p>
            <div className="vx-kpis mb-8 text-left">
              <div className="vx-kpi">
                <span className="vx-kpi-label">This round</span>
                <span className="vx-kpi-value">{score}/{order.length}</span>
              </div>
              <div className="vx-kpi">
                <span className="vx-kpi-label">Best streak</span>
                <span className="vx-kpi-value">{best}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-[15px] text-ink-400 mb-8 leading-relaxed">
            A song plays — pick its title from four options. Songs come from your recent plays and the charts.
          </p>
        )}
        {pool.length >= 4 || trending.isLoading ? (
          <button
            type="button"
            onClick={begin}
            disabled={pool.length < 4}
            className="btn-primary w-full !min-h-[52px] rounded-full text-base disabled:opacity-50"
          >
            {pool.length < 4 ? 'Loading songs…' : finished ? 'Play again' : 'Start quiz'}
          </button>
        ) : (
          // The charts request settled without enough songs for four options.
          // This used to sit on "Loading songs…" forever; say what happened
          // and offer the retry.
          <div role="alert">
            <p className="text-[15px] text-ink-300 mb-4">
              {trending.isError
                ? 'We couldn’t reach the music servers to load quiz songs. Check your connection and try again.'
                : 'Not enough songs to build a round yet — play a few songs, or try again.'}
            </p>
            <button
              type="button"
              onClick={() => void trending.refetch()}
              disabled={trending.isFetching}
              className="btn-primary w-full !min-h-[52px] rounded-full text-base disabled:opacity-50"
            >
              {trending.isFetching ? 'Loading songs…' : 'Retry'}
            </button>
          </div>
        )}
        <Link to="/explore" className="inline-flex items-center min-h-[44px] mt-3 text-sm font-semibold text-ink-400 hover:text-ink-100">
          Back to Explore
        </Link>
      </div>
    );
  }

  // ---- Round / Reveal ----
  const revealed = phase === 'reveal';
  return (
    <div className="vx-sec is-narrow pt-2">
      <div className="vx-quiz-progress" aria-hidden>
        {order.map((s, i) => (
          <i key={s.id} className={i < idx || (i === idx && revealed) ? 'is-done' : i === idx ? 'is-now' : undefined} />
        ))}
      </div>
      <div className="flex items-center justify-between mb-6 text-[14px] tabular-nums">
        <span className="text-ink-400 font-semibold">Question {idx + 1} of {order.length}</span>
        <span className="flex items-center gap-4">
          <span className="font-semibold text-ink-100">Score {score}</span>
          <span className={cn('font-semibold', streak >= 2 ? 'text-ink-100' : 'text-ink-400')}>
            Streak {streak}
          </span>
        </span>
      </div>

      <div className="flex flex-col items-center mb-6">
        <div className="vx-quiz-art">
          {revealed ? (
            <img src={bestImage(correct.images, 500)} alt="" className="animate-fade-up" />
          ) : (
            <>
              <span className="vx-quiz-bars" aria-hidden>
                {[0, 1, 2, 3, 4].map((i) => (
                  <i key={i} className="animate-pulse-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </span>
              <PlayIcon className="relative w-11 h-11 text-[color:var(--vx-on-accent)]" />
            </>
          )}
        </div>
        {revealed && (
          <div className="text-center mt-4 animate-fade-up">
            <p className="text-[17px] font-bold text-ink-100">{correct.title}</p>
            <p className="text-[14px] text-ink-400">{correct.subtitle}</p>
          </div>
        )}
        {!revealed && (
          <button onClick={() => playSong(correct)} className="mt-3 min-h-[44px] px-3 text-[13px] font-semibold text-ink-400 hover:text-ink-100">
            Replay snippet
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {options.map((opt) => {
          const isCorrect = opt.id === correct.id;
          const isChosen = opt.id === chosenId;
          return (
            <button
              key={opt.id}
              onClick={() => answer(opt)}
              disabled={revealed}
              className={cn(
                'vx-quiz-option',
                revealed && isCorrect && 'is-correct',
                revealed && isChosen && !isCorrect && 'is-wrong',
                revealed && !isCorrect && !isChosen && 'opacity-50',
              )}
            >
              <span className="block text-[15px] font-semibold text-ink-100 truncate">{opt.title}</span>
              <span className="block text-[13px] text-ink-400 truncate">{opt.subtitle}</span>
              {revealed && isCorrect && <span className="sr-only">Correct</span>}
              {revealed && isChosen && !isCorrect && <span className="sr-only">Your pick, wrong</span>}
            </button>
          );
        })}
      </div>

      {revealed && (
        <button onClick={next} className="btn-primary w-full !min-h-[52px] rounded-full text-base mt-6">
          {idx + 1 >= order.length ? 'See results' : 'Next song'}
        </button>
      )}
    </div>
  );
}
