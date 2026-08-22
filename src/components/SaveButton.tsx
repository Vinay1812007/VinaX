import { useLibraryStore, type SavedEntity } from '@/store/libraryStore';
import { toast } from '@/store/toastStore';
import { cn } from '@/utils/cn';

interface Props {
  entity: Omit<SavedEntity, 'savedAt'>;
  className?: string;
}

const LABEL: Record<SavedEntity['kind'], string> = {
  album: 'album',
  artist: 'artist',
  playlist: 'playlist',
};

/** Save/follow an album, artist, or playlist to the local library. */
export function SaveButton({ entity, className }: Props) {
  const saved = useLibraryStore((s) => s.saved.some((e) => e.id === entity.id && e.kind === entity.kind));
  const toggle = useLibraryStore((s) => s.toggleSaved);
  const verb = entity.kind === 'artist' ? (saved ? 'Following' : 'Follow') : saved ? 'Saved' : 'Save';
  return (
    <button
      onClick={() => {
        toggle(entity);
        toast(saved ? `Removed ${LABEL[entity.kind]}` : `${entity.kind === 'artist' ? 'Following' : 'Saved'} ${LABEL[entity.kind]}`);
      }}
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
