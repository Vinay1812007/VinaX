import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { formatDuration } from '@/utils/format';
import { bestImage, FALLBACK_ART } from '@/utils/images';
import { languageLabel } from '@/constants/languages';
import { planQueue, type DiscoveryLevel, type QueuePlan } from '@/services/recommendation/queuePlanner';
import type { ArcShape } from '@/services/recommendation/sequencer';
import type { Mood } from '@/services/recommendation/mood';
import type { Song } from '@/types';

const SHAPES: Array<{ value: ArcShape; label: string; hint: string }> = [
  { value: 'steady', label: 'Steady', hint: 'Settle in, one gentle peak, ease off' },
  { value: 'build', label: 'Build up', hint: 'Start calm, climb to a high' },
  { value: 'wind-down', label: 'Wind down', hint: 'Start high, land soft' },
  { value: 'wave', label: 'Waves', hint: 'Rise and fall, twice' },
];
const MOODS: Array<{ value: Mood | 'any'; label: string }> = [
  { value: 'any', label: 'Any mood' },
  { value: 'romantic', label: 'Romantic' },
  { value: 'energetic', label: 'Energetic' },
  { value: 'chill', label: 'Chill' },
  { value: 'melancholy', label: 'Melancholy' },
  { value: 'devotional', label: 'Devotional' },
];
const MINUTES = [20, 30, 45, 60, 90];
const DISCOVERY: Array<{ value: DiscoveryLevel; label: string }> = [
  { value: 'low', label: 'Familiar' },
  { value: 'medium', label: 'Balanced' },
  { value: 'high', label: 'Adventurous' },
];

/**
 * v6.3.0 — Queue Builder. Describe the stretch you want — length, mood,
 * energy shape, how adventurous, which language, from what seed — and get
 * a PREVIEW of the planned queue (with each song's energy and a one-line
 * reason) before replacing the queue or adding it after the current song.
 */
export function QueueBuilderSheet({ onClose }: { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onClose);
  useDismissOnBack(true, onClose);
  const current = useCurrentSong();
  const favorites = useLibraryStore((s) => s.favorites);
  const pinned = useSettingsStore((s) => s.pinnedLanguages);
  const aiDj = useSettingsStore((s) => s.aiDj);
  const applyPlan = usePlayerStore((s) => s.applyPlan);
  const [seedMode, setSeedMode] = useState<'current' | 'favourite' | 'none'>(current ? 'current' : 'none');
  const [favSeedId, setFavSeedId] = useState(favorites[0]?.id ?? '');
  const [mood, setMood] = useState<Mood | 'any'>('any');
  const [shape, setShape] = useState<ArcShape>('steady');
  const [minutes, setMinutes] = useState(30);
  const [discovery, setDiscovery] = useState<DiscoveryLevel>('medium');
  const [language, setLanguage] = useState<string>(current?.language && current.language !== 'unknown' ? current.language : pinned[0] ?? '');
  const [goal, setGoal] = useState('');
  const [plan, setPlan] = useState<QueuePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef(0);
  useEffect(() => () => { runRef.current += 1; }, []);

  const seed: Song | null = seedMode === 'current' ? current : seedMode === 'favourite' ? favorites.find((s) => s.id === favSeedId) ?? null : null;

  const build = async () => {
    if (busy) return;
    const run = ++runRef.current;
    setBusy(true);
    setPlan(null);
    try {
      const p = await planQueue({ seed, mood, shape, minutes, discovery, language: language || null, goal: goal.trim() || undefined, useDj: aiDj });
      if (run !== runRef.current) return;
      setPlan(p);
      if (!p.songs.length) toast('Nothing matched that brief — try another mood, language or a wider discovery setting');
    } catch {
      if (run === runRef.current) toast('Could not build a plan right now');
    } finally {
      if (run === runRef.current) setBusy(false);
    }
  };
  const apply = (mode: 'replace' | 'append') => {
    if (!plan?.songs.length) return;
    applyPlan(plan.songs.map((s) => s.song), mode);
    toast(mode === 'replace' ? `Playing your ${minutes}-minute plan` : `Added ${plan.songs.length} songs after the current one`);
    onClose();
  };

  const chip = (on: boolean) => cn('px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors min-h-[36px]', on ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400');
  const langOptions = [...new Set([...(current?.language && current.language !== 'unknown' ? [current.language] : []), ...pinned])];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-6" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="queue-builder-title" className="w-full sm:max-w-2xl glass-modal rounded-t-3xl sm:rounded-3xl p-5 max-h-[92vh] overflow-y-auto animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <h2 id="queue-builder-title" className="text-lg font-bold">Build a queue</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-4">Say how long, what mood and how the energy should move. VinaX plans it from real songs your taste already reaches, shows you the arc, and only then touches the queue.</p>

        <fieldset className="mb-3">
          <legend className="text-xs font-semibold text-ink-300 mb-1.5">Start from</legend>
          <div className="flex flex-wrap gap-1.5">
            {current && <button type="button" onClick={() => setSeedMode('current')} aria-pressed={seedMode === 'current'} className={chip(seedMode === 'current')}>Now playing · {current.title}</button>}
            {favorites.length > 0 && <button type="button" onClick={() => setSeedMode('favourite')} aria-pressed={seedMode === 'favourite'} className={chip(seedMode === 'favourite')}>A favourite</button>}
            <button type="button" onClick={() => setSeedMode('none')} aria-pressed={seedMode === 'none'} className={chip(seedMode === 'none')}>My taste</button>
          </div>
          {seedMode === 'favourite' && (
            <>
              <label htmlFor="qb-fav" className="sr-only">Favourite to start from</label>
              <select id="qb-fav" value={favSeedId} onChange={(e) => setFavSeedId(e.target.value)} className="mt-2 bg-ink-800 border border-ink-600 rounded-xl px-3 py-2 text-sm text-ink-100 outline-none focus:border-ember-500 w-full">
                {favorites.slice(0, 60).map((s) => <option key={s.id} value={s.id}>{s.title} — {s.subtitle}</option>)}
              </select>
            </>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset>
            <legend className="text-xs font-semibold text-ink-300 mb-1.5">Length</legend>
            <div className="flex flex-wrap gap-1.5">{MINUTES.map((m) => <button key={m} type="button" onClick={() => setMinutes(m)} aria-pressed={minutes === m} className={chip(minutes === m)}>{m} min</button>)}</div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold text-ink-300 mb-1.5">Discovery</legend>
            <div className="flex flex-wrap gap-1.5">{DISCOVERY.map((d) => <button key={d.value} type="button" onClick={() => setDiscovery(d.value)} aria-pressed={discovery === d.value} className={chip(discovery === d.value)}>{d.label}</button>)}</div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold text-ink-300 mb-1.5">Mood</legend>
            <div className="flex flex-wrap gap-1.5">{MOODS.map((m) => <button key={m.value} type="button" onClick={() => setMood(m.value)} aria-pressed={mood === m.value} className={chip(mood === m.value)}>{m.label}</button>)}</div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold text-ink-300 mb-1.5">Energy shape</legend>
            <div className="flex flex-wrap gap-1.5">{SHAPES.map((s) => <button key={s.value} type="button" onClick={() => setShape(s.value)} aria-pressed={shape === s.value} title={s.hint} className={chip(shape === s.value)}>{s.label}</button>)}</div>
            <p className="text-[11px] text-ink-500 mt-1">{SHAPES.find((s) => s.value === shape)?.hint}</p>
          </fieldset>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="qb-lang" className="block text-xs font-semibold text-ink-300 mb-1">Language</label>
            <select id="qb-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="bg-ink-800 border border-ink-600 rounded-xl px-3 py-2 text-sm text-ink-100 outline-none focus:border-ember-500 w-full">
              <option value="">Any of my languages</option>
              {langOptions.map((l) => <option key={l} value={l}>{languageLabel(l)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="qb-goal" className="block text-xs font-semibold text-ink-300 mb-1">Tell the DJ <span className="font-normal text-ink-500">(optional)</span></label>
            <input id="qb-goal" value={goal} onChange={(e) => setGoal(e.target.value.slice(0, 160))} placeholder="a night drive, a study hour, cooking with family…" className="glass-input w-full px-3 py-2 rounded-xl text-sm" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => void build()} disabled={busy} className="btn-primary px-4 py-2 text-sm min-h-[44px] disabled:opacity-50">{busy ? 'Planning…' : plan ? 'Plan again' : 'Preview my queue'}</button>
          <span className="text-[11px] text-ink-400" role="status" aria-live="polite">
            {busy ? 'Gathering real songs and laying out the arc…' : plan ? `${plan.songs.length} songs · ${Math.round(plan.totalSec / 60)} min · from ${plan.candidates} candidates${plan.djTouched ? ' · AI DJ notes' : ''}` : ''}
          </span>
        </div>

        {plan && plan.songs.length > 0 && (
          <section aria-label="Planned queue" className="mt-4">
            {plan.intro && <p className="text-sm italic text-ink-200 mb-2">“{plan.intro}”</p>}
            <div className="flex items-end gap-[3px] h-10 mb-2" role="img" aria-label="Energy arc of the planned queue">
              {plan.songs.map((s, i) => (
                <span key={`${s.song.id}-${i}`} className="flex-1 rounded-t bg-ember-500/70" style={{ height: `${Math.round(20 + s.energy * 80)}%` }} title={`${s.song.title} · energy ${Math.round(s.energy * 100)}%`} />
              ))}
            </div>
            <ol className="space-y-1 max-h-64 overflow-y-auto">
              {plan.songs.map((s, i) => (
                <li key={`${s.song.id}-${i}`} className="flex items-center gap-2.5 glass-card rounded-xl p-2">
                  <span className="w-5 text-center text-xs text-ink-500 shrink-0">{i + 1}</span>
                  <img src={bestImage(s.song.images, 150)} onError={(e) => ((e.target as HTMLImageElement).src = FALLBACK_ART)} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate">{s.song.title}</span>
                    <span className="block text-[11px] text-ink-400 truncate">{s.song.subtitle} · {s.why}</span>
                  </span>
                  <span className="text-xs tabular-nums text-ink-400 shrink-0">{formatDuration(s.song.duration)}</span>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Cancel</button>
              {current && <button type="button" onClick={() => apply('append')} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Add after current</button>}
              <button type="button" onClick={() => apply('replace')} className="btn-primary px-4 py-2 text-sm min-h-[44px]">Play this plan</button>
            </div>
          </section>
        )}
        {!plan && (
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Cancel</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
