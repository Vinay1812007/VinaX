import { useLibraryStore, type SavedEntity } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';
import { CheckIcon, PlusIcon } from './Icons';

interface Props {
  entity: Omit<SavedEntity, 'savedAt'>;
  className?: string;
  /**
   * `pill` (default): the outlined text button ("Save" / "Follow").
   * `icon`: the round glyph used in entity action rows — a plus ring that
   * becomes a filled check once saved. Same accessible name either way.
   */
  variant?: 'pill' | 'icon';
}

const LABEL: Record<SavedEntity['kind'], string> = {
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
};

/** Save/follow an album, artist, or playlist to the local library. */
export function SaveButton({ entity, className, variant = 'pill' }: Props) {
  const saved = useLibraryStore((s) => s.saved.some((e) => e.id === entity.id && e.kind === entity.kind));
  const toggle = useLibraryStore((s) => s.toggleSaved);
  const verb = entity.kind === 'artist' ? (saved ? 'Following' : 'Follow') : saved ? 'Saved' : 'Save';
  const onClick = () => {
    toggle(entity);
    toast(saved ? `Removed ${LABEL[entity.kind]}` : `${entity.kind === 'artist' ? 'Following' : 'Saved'} ${LABEL[entity.kind]}`);
  };
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={saved}
        aria-label={verb}
        title={saved ? 'Remove from your library' : 'Save to your library'}
        className={cn('vx-save-icon', saved && 'is-saved', className)}
      >
        <span aria-hidden>{saved ? <CheckIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      aria-pressed={saved}
      className={cn(
        'px-4 py-2.5 rounded-full text-sm font-semibold border transition-colors min-h-touch',
        saved ? 'border-ember-500 text-ember-400' : 'border-ink-600 text-ink-200 hover:border-ink-400',
        className,
      )}
    >
      {verb}
    </button>
  );
}
