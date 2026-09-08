/**
 * v5.19.0 — playlist tag UI: a comma-separated input that turns into chips
 * (× to remove), suggestions pulled from the listener's other playlists, and
 * the tiny read-only chips used on Library tiles and the collection header.
 */
import { useState } from 'react';
import { cn } from '@/utils/cn';
import { normalizeTags, TAG_MAX_LENGTH, TAG_MAX_PER_COLLECTION } from './tags';

const CHIP = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold leading-tight';

interface EditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Tags in use on other playlists, offered as one-tap additions. */
  suggestions?: string[];
}

export function TagEditor({ tags, onChange, suggestions = [] }: EditorProps) {
  const [draft, setDraft] = useState('');
  const full = tags.length >= TAG_MAX_PER_COLLECTION;
  const hints = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);

  const commit = (text: string) => {
    const next = normalizeTags([...tags, ...text.split(',')]);
    if (next.length !== tags.length || next.some((t, i) => t !== tags[i])) onChange(next);
    setDraft('');
  };
  const remove = (tag: string) => onChange(tags.filter((t) => t !== tag));

  return (
    <div>
      <input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(',')) commit(v);
          else setDraft(v);
        }}
        onBlur={() => draft.trim() && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            remove(tags[tags.length - 1]);
          }
        }}
        aria-label="Tags"
        placeholder={full ? `Up to ${TAG_MAX_PER_COLLECTION} tags` : 'Tags, comma-separated (chill, drive, telugu)'}
        disabled={full}
        maxLength={TAG_MAX_LENGTH * 4}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="glass-input w-full px-4 py-2 rounded-xl text-sm disabled:opacity-60"
      />
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Current tags">
          {tags.map((tag) => (
            <li key={tag} className={cn(CHIP, 'border-ember-500/40 bg-ember-500/10 text-ember-200')}>
              #{tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="ml-0.5 -mr-0.5 w-4 h-4 rounded-full grid place-items-center text-ink-300 hover:text-ink-100 hover:bg-ink-700"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {hints.length > 0 && !full && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-[11px] text-ink-500">Suggestions</span>
          {hints.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange(normalizeTags([...tags, h]))}
              className={cn(CHIP, 'border-ink-600 text-ink-300 hover:border-ink-400 hover:text-ink-100')}
            >
              + {h}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-500 mt-1">
        {tags.length}/{TAG_MAX_PER_COLLECTION} · press Enter or type a comma to add
      </p>
    </div>
  );
}

export function TagChips({ tags, className }: { tags?: string[]; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)} aria-label={`Tags: ${tags.join(', ')}`}>
      {tags.map((t) => (
        <span key={t} className="px-1.5 py-0.5 rounded-full bg-ink-800 border border-ink-700 text-[10px] font-semibold text-ink-300 leading-tight">
          #{t}
        </span>
      ))}
    </span>
  );
}
