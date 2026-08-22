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
      <div className="max-w-md mx-auto text-center pt-6">
        <span className="inline-flex w-16 h-16 rounded-3xl bg-premium items-center justify-center shadow-glow mb-5">
          <SparkleIcon className="w-8 h-8 text-black" />
        </span>
        <h1 className="text-display tracking-tight mb-1">
          {finished ? 'Nice run!' : <span className="text-gradient">Guess the Song</span>}
        </h1>
        {finished ? (
          <>
            <p className="text-sm text-ink-400 mb-6">You scored {score} / {order.length}.</p>
            <div className="grid grid-cols-2 gap-3 mb-7">
              <div className="glass-card rounded-2xl p-4">
                <p className="text-3xl font-extrabold text-gradient">{score}/{order.length}</p>
                <p className="text-xs text-ink-400 mt-1">This round</p>
              </div>
              <div className="glass-card rounded-2xl p-4">
                <p className="text-3xl font-extrabold text-gradient">{best}</p>
                <p className="text-xs text-ink-400 mt-1">Best streak</p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-400 mb-7">
            A song plays — pick its title from four options before the chorus gives it away. Build a
            streak. Picks are drawn from your recent plays and the charts.
          </p>
        )}
        <button
          onClick={begin}
          disabled={pool.length < 4}
          className="btn-premium w-full py-3.5 rounded-full font-bold text-base disabled:opacity-50"
        >
          {pool.length < 4 ? 'Loading songs…' : finished ? 'Play again' : 'Start quiz'}
        </button>
        <Link to="/explore" className="block mt-4 text-sm text-ink-400 hover:text-ink-100">
          Back to Explore
        </Link>
      </div>
    );
  }

  // ---- Round / Reveal ----
  const revealed = phase === 'reveal';
  return (
    <div className="max-w-md mx-auto pt-2">
      <div className="flex items-center justify-between mb-5 text-sm">
        <span className="text-ink-400">Question {idx + 1} / {order.length}</span>
        <span className="flex items-center gap-3">
          <span className="font-semibold">Score {score}</span>
          <span className={cn('font-semibold', streak >= 2 ? 'text-gradient' : 'text-ink-400')}>
            🔥 {streak}
          </span>
        </span>
      </div>

      <div className="flex flex-col items-center mb-6">
        <div className="relative w-44 h-44 rounded-full overflow-hidden grid place-items-center">
          {revealed ? (
            <img src={bestImage(correct.images, 500)} alt="" className="w-full h-full object-cover animate-fade-up" />
          ) : (
            <>
              <div className="absolute inset-0 bg-premium opacity-90" />
              <div className="absolute inset-0 flex items-end justify-center gap-1.5 pb-12">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-white/90 animate-pulse-bar origin-bottom"
                    style={{ height: 28, animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </div>
              <PlayIcon className="relative w-9 h-9 text-black/95" />
            </>
          )}
        </div>
        {revealed && (
          <div className="text-center mt-3 animate-fade-up">
            <p className="font-bold">{correct.title}</p>
            <p className="text-sm text-ink-300">{correct.subtitle}</p>
          </div>
        )}
        {!revealed && (
          <button onClick={() => playSong(correct)} className="mt-3 text-xs font-semibold text-ink-400 hover:text-ink-100">
            ↻ Replay snippet
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
                'w-full text-left px-4 py-3 rounded-2xl glass-card transition-all',
                !revealed && 'glass-hover active:scale-[0.98]',
                revealed && isCorrect && 'ring-2 ring-emerald-400 bg-emerald-400/15',
                revealed && isChosen && !isCorrect && 'ring-2 ring-rose-400 bg-rose-400/15',
                revealed && !isCorrect && !isChosen && 'opacity-50',
              )}
            >
              <span className="block font-semibold truncate">{opt.title}</span>
              <span className="block text-xs text-ink-400 truncate">{opt.subtitle}</span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <button onClick={next} className="btn-premium w-full py-3.5 rounded-full font-bold text-base mt-5">
          {idx + 1 >= order.length ? 'See results' : 'Next song'}
        </button>
      )}
    </div>
  );
}
