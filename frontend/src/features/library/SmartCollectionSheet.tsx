import { useEffect, useMemo, useState } from 'react';
import { LANGUAGES, languageLabel } from '@/constants/languages';
import { Sheet } from '@/components/Sheet';
import { useLibraryStore } from '@/store/libraryStore';
import { useHistoryStore } from '@/store/historyStore';
import { useSmartCollectionStore } from '@/store/smartCollectionStore';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { formatDuration } from '@/utils/format';
import { EMPTY_RULES, describeRules, evaluateSmartCollection, type SmartCollection, type SmartRules, type SmartSort } from './smartCollections';

const SORTS: Array<{ value: SmartSort; label: string }> = [
  { value: 'recent', label: 'Recently played first' },
  { value: 'plays', label: 'Most played first' },
  { value: 'title', label: 'Title' },
  { value: 'artist', label: 'Artist' },
  { value: 'duration', label: 'Longest first' },
  { value: 'newest', label: 'Newest year first' },
];

const numField = (v: number | null): string => (v === null ? '' : String(v));
const parseNum = (v: string): number | null => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * v6.1.0 — create / edit a smart collection with a LIVE preview of what the
 * rules pick from the local library right now. Rules only see metadata the
 * device already holds (favourites, playlists, Listen Later, history), so
 * the sheet says so up front instead of implying a catalogue search.
 */
export function SmartCollectionSheet({ existing, onClose }: { existing?: SmartCollection; onClose(): void }) {
  const favorites = useLibraryStore((s) => s.favorites);
  const collections = useLibraryStore((s) => s.collections);
  const later = useLibraryStore((s) => s.later);
  const history = useHistoryStore((s) => s.entries);
  const create = useSmartCollectionStore((s) => s.create);
  const update = useSmartCollectionStore((s) => s.update);

  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '');
  const [rules, setRules] = useState<SmartRules>(existing?.rules ?? EMPTY_RULES);
  const [sort, setSort] = useState<SmartSort>(existing?.sort ?? 'recent');
  const [limit, setLimit] = useState(existing?.limit ?? 0);
  const [artistText, setArtistText] = useState((existing?.rules.artists ?? []).join(', '));
  const [minMin, setMinMin] = useState(existing?.rules.minDuration != null ? String(Math.round(existing.rules.minDuration / 60)) : '');
  const [maxMin, setMaxMin] = useState(existing?.rules.maxDuration != null ? String(Math.round(existing.rules.maxDuration / 60)) : '');

  // Artists and durations are typed as text; fold them into the rules as they settle.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setRules((r) => ({
        ...r,
        artists: artistText.split(',').map((a) => a.trim()).filter(Boolean).slice(0, 20),
        minDuration: parseNum(minMin) === null ? null : Math.max(0, (parseNum(minMin) as number) * 60),
        maxDuration: parseNum(maxMin) === null ? null : Math.max(0, (parseNum(maxMin) as number) * 60),
      }));
    }, 200);
    return () => window.clearTimeout(t);
  }, [artistText, minMin, maxMin]);

  const preview = useMemo(
    () => evaluateSmartCollection({ rules, sort, limit }, { favorites, collections, later, history }),
    [rules, sort, limit, favorites, collections, later, history],
  );
  const localTotal = useMemo(() => new Set([...favorites, ...collections.flatMap((c) => c.songs), ...later, ...history.map((e) => e.song)].map((s) => s.id)).size, [favorites, collections, later, history]);
  const languagesInLibrary = useMemo(() => {
    const ids = new Set<string>();
    for (const s of [...favorites, ...collections.flatMap((c) => c.songs), ...later, ...history.map((e) => e.song)]) if (s.language) ids.add(s.language.toLowerCase());
    return LANGUAGES.filter((l) => ids.has(l.id));
  }, [favorites, collections, later, history]);

  const toggleLang = (id: string) =>
    setRules((r) => ({ ...r, languages: r.languages.includes(id) ? r.languages.filter((l) => l !== id) : [...r.languages, id] }));

  const save = () => {
    const n = name.trim();
    if (!n) {
      toast('Give the smart collection a name');
      return;
    }
    if (existing) {
      update(existing.id, { name: n, rules, sort, limit, emoji });
      toast(`Updated “${n}”`);
    } else {
      create({ name: n, rules, sort, limit, emoji });
      toast(`Created “${n}” — it updates itself as your library changes`);
    }
    onClose();
  };

  const field = 'glass-input w-full px-3 py-2 rounded-xl text-sm';
  const chip = (on: boolean) => cn('px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors min-h-[32px]', on ? 'border-ember-500 bg-ember-500/15 text-ember-300' : 'border-ink-600 text-ink-300 hover:border-ink-400');

  // <Sheet> portals to <body>: fixed overlays must not live inside a transformed page section.
  return (
    <Sheet onClose={onClose} labelledBy="smart-sheet-title" size="2xl">
        <h2 id="smart-sheet-title" className="text-lg font-bold">{existing ? 'Edit smart collection' : 'New smart collection'}</h2>
        <p className="text-xs text-ink-400 mt-0.5 mb-4">
          Rules run over the music already on this device — favourites, playlists, Listen Later and history ({localTotal} songs). They use the metadata the catalogue gave those songs; they never search the catalogue.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="smart-name" className="block text-xs font-semibold text-ink-300 mb-1">Name</label>
            <input id="smart-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Telugu favourites this month" className={field} autoFocus />
          </div>
          <div>
            <label htmlFor="smart-emoji" className="block text-xs font-semibold text-ink-300 mb-1">Emoji</label>
            <input id="smart-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="✨" className={cn(field, 'w-20 text-center')} />
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-ink-300 mb-1.5">Languages <span className="font-normal text-ink-500">(any of)</span></legend>
          {languagesInLibrary.length ? (
            <div className="flex flex-wrap gap-1.5">
              {languagesInLibrary.map((l) => (
                <button key={l.id} type="button" onClick={() => toggleLang(l.id)} aria-pressed={rules.languages.includes(l.id)} className={chip(rules.languages.includes(l.id))}>
                  {l.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-500">No language tags in your library yet.</p>
          )}
        </fieldset>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="smart-artists" className="block text-xs font-semibold text-ink-300 mb-1">Artists <span className="font-normal text-ink-500">(comma-separated, any of)</span></label>
            <input id="smart-artists" value={artistText} onChange={(e) => setArtistText(e.target.value)} placeholder="Sid Sriram, Ilaiyaraaja" className={field} />
          </div>
          <div>
            <label htmlFor="smart-text" className="block text-xs font-semibold text-ink-300 mb-1">Words in title, artist or album</label>
            <input id="smart-text" value={rules.text} onChange={(e) => setRules((r) => ({ ...r, text: e.target.value.slice(0, 80) }))} placeholder="love, rain…" className={field} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="smart-min" className="block text-xs font-semibold text-ink-300 mb-1">Min minutes</label>
              <input id="smart-min" type="number" inputMode="numeric" min={0} value={minMin} onChange={(e) => setMinMin(e.target.value)} className={field} />
            </div>
            <div className="flex-1">
              <label htmlFor="smart-max" className="block text-xs font-semibold text-ink-300 mb-1">Max minutes</label>
              <input id="smart-max" type="number" inputMode="numeric" min={0} value={maxMin} onChange={(e) => setMaxMin(e.target.value)} className={field} />
            </div>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="smart-yfrom" className="block text-xs font-semibold text-ink-300 mb-1">Year from</label>
              <input id="smart-yfrom" type="number" inputMode="numeric" value={numField(rules.yearFrom)} onChange={(e) => setRules((r) => ({ ...r, yearFrom: parseNum(e.target.value) }))} className={field} />
            </div>
            <div className="flex-1">
              <label htmlFor="smart-yto" className="block text-xs font-semibold text-ink-300 mb-1">Year to</label>
              <input id="smart-yto" type="number" inputMode="numeric" value={numField(rules.yearTo)} onChange={(e) => setRules((r) => ({ ...r, yearTo: parseNum(e.target.value) }))} className={field} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setRules((r) => ({ ...r, favoritesOnly: !r.favoritesOnly }))} aria-pressed={rules.favoritesOnly} className={chip(rules.favoritesOnly)}>Favourites only</button>
          <button type="button" onClick={() => setRules((r) => ({ ...r, neverPlayed: !r.neverPlayed, playedWithinDays: r.neverPlayed ? r.playedWithinDays : null }))} aria-pressed={rules.neverPlayed} className={chip(rules.neverPlayed)}>Never played</button>
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setRules((r) => ({ ...r, playedWithinDays: r.playedWithinDays === d ? null : d, neverPlayed: false }))} aria-pressed={rules.playedWithinDays === d} className={chip(rules.playedWithinDays === d)}>
              Played in {d} days
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="smart-sort" className="block text-xs font-semibold text-ink-300 mb-1">Order</label>
            <select id="smart-sort" value={sort} onChange={(e) => setSort(e.target.value as SmartSort)} className="bg-ink-800 border border-ink-600 rounded-xl px-3 py-2 text-sm text-ink-100 outline-none focus:border-ember-500 w-full">
              {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="smart-limit" className="block text-xs font-semibold text-ink-300 mb-1">Limit <span className="font-normal text-ink-500">(0 = no limit)</span></label>
            <input id="smart-limit" type="number" inputMode="numeric" min={0} max={1000} value={limit} onChange={(e) => setLimit(Math.max(0, Math.min(1000, parseNum(e.target.value) ?? 0)))} className={field} />
          </div>
        </div>

        <section aria-label="Live preview" className="mt-5 rounded-2xl border border-[var(--glass-border)] bg-[var(--tile)] p-3">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h3 className="text-sm font-bold">Live preview</h3>
            <span className="text-[11px] font-semibold text-ink-400" role="status" aria-live="polite">
              {preview.length} of {localTotal} local song{localTotal === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-[11px] text-ink-400 mb-2">{describeRules(rules, languageLabel)}</p>
          {preview.length ? (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {preview.slice(0, 30).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate"><b>{s.title}</b> <span className="text-ink-400">· {s.subtitle}</span></span>
                  <span className="tabular-nums text-ink-500 shrink-0">{formatDuration(s.duration)}</span>
                </li>
              ))}
              {preview.length > 30 && <li className="text-[11px] text-ink-500">…and {preview.length - 30} more</li>}
            </ul>
          ) : (
            <p className="text-xs text-ink-500">Nothing in your library matches these rules yet. Loosen a rule, or listen to more music.</p>
          )}
        </section>

        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm min-h-[44px]">Cancel</button>
          <button type="button" onClick={save} className="btn-primary px-4 py-2 text-sm min-h-[44px]">{existing ? 'Save changes' : 'Create smart collection'}</button>
        </div>
    </Sheet>
  );
}
