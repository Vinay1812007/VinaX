import { usePageTitle } from '@/hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useReasonStore } from '@/store/reasonStore';
import { EmptyState } from '@/components/States';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { toast } from '@/store/toastStore';
import { XIcon } from '@/components/Icons';
import { TUNE_OPTIONS, type TuneIntent } from '@/services/recommendation/tune';

const TUNES: Array<{ intent: TuneIntent; label: string }> = TUNE_OPTIONS.filter((o) => o.id !== 'surprise').map(
  (o) => ({ intent: o.id, label: o.label }),
);

/** Canvas 4d — Queue with the AI DJ: tuning chips, teal now-playing card,
 *  and "Up next — and why" rows carrying the DJ's real reasons. */
export default function QueuePage() {
  usePageTitle('Queue');
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playAt = usePlayerStore((s) => s.playAt);
  const removeAt = usePlayerStore((s) => s.removeAt);
  const tuneQueue = usePlayerStore((s) => s.tuneQueue);
  const song = useCurrentSong();
  const reasons = useReasonStore((s) => s.reasons);
  const upNext = queue.slice(index + 1);

  const tune = (intent: TuneIntent, label: string): void => {
    tuneQueue(intent);
    toast(`${label} — retuning what's next`);
  };
  const surprise = (): void => {
    const pick = TUNES[Math.floor(Math.random() * TUNES.length)];
    tuneQueue(pick.intent);
    toast('Surprise coming up ✦');
  };

  if (!queue.length) {
    return (
      <EmptyState
        title="Queue is empty"
        message="Play something and the AI DJ will build around it."
        action={<Link to="/" className="px-5 py-2.5 rounded-full btn-primary">Browse Home</Link>}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <h1 className="text-[26px] font-extrabold tracking-tight">Queue</h1>
      <p className="text-xs font-semibold text-ink-400 mb-4">AI DJ · builds around what&rsquo;s playing</p>

      {/* tune chips */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <button
          onClick={surprise}
          className="h-[38px] px-4 rounded-full text-xs font-extrabold text-ink-100 border border-ember-400/30 transition active:scale-95"
          style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.22), rgba(96,165,250,0.14))' }}
        >
          ✦ Surprise me
        </button>
        {TUNES.map((t) => (
          <button
            key={t.intent}
            onClick={() => tune(t.intent, t.label)}
            className="h-[38px] px-4 rounded-full text-xs font-bold bg-[var(--tile)] border border-[var(--glass-border)] text-ink-200 hover:bg-[var(--tile-hover)] transition active:scale-95"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* now playing */}
      {song && (
        <div
          className="vx-nowcard rounded-[20px] border border-[var(--glass-border)] p-3.5 flex items-center gap-3 mb-6"
        >
          <img
            src={bestImage(song.images, 120)}
            onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-12 h-12 rounded-xl object-cover shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-extrabold truncate">{song.title}</p>
            <p className="text-[11px] font-semibold text-ink-300">Now playing</p>
          </div>
          {isPlaying && (
            <span className="vx-eq" style={{ height: 16 }} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
      )}

      {/* up next — and why */}
      <h2 className="text-base font-extrabold mb-2.5">Up next — and why</h2>
      {upNext.length === 0 ? (
        <p className="text-sm text-ink-400">Nothing queued — tap a tune chip and the DJ fills it.</p>
      ) : (
        <ul className="space-y-2">
          {upNext.map((s, i) => {
            const realIndex = index + 1 + i;
            const why = reasons[s.id] ?? 'Fits the vibe you’ve been building';
            return (
              <li key={`${s.id}-${realIndex}`} className="rounded-[18px] bg-[var(--tile)] border border-[var(--glass-border)] p-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => playAt(realIndex)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <img
                      src={bestImage(s.images, 96)}
                      onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-[42px] h-[42px] rounded-[10px] object-cover shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold truncate">{s.title}</span>
                      <span className="block text-[11px] font-semibold text-ink-400 truncate">{s.subtitle}</span>
                    </span>
                  </button>
                  <button
                    onClick={() => removeAt(realIndex)}
                    aria-label={`Remove ${s.title} from queue`}
                    className="p-1.5 rounded-full text-ink-400 hover:text-ink-100 hover:bg-[var(--tile-hover)] shrink-0"
                  >
                    <XIcon className="w-4 h-4" />
                  </button>
                </div>
                <p className="vx-reason mt-2 rounded-[11px] px-2.5 py-1.5 text-[11px] font-semibold truncate">{why}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
