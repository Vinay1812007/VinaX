import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { EmptyState } from '@/components/States';
import { ImportPlaylistSheet } from '@/components/ImportPlaylistSheet';
import { shareAction } from '@/features/share/shareTarget';

/**
 * Round 8 — Share to VinaX. Text shared from another app lands here
 * (/share?text=…&title=…&url=…): the installed web app's share target on
 * Android Chrome and computers (not iPhone), and the Android app's entry in
 * the system share sheet. A VinaX link opens its page, one line is searched,
 * and a list opens Import a playlist with the songs already filled in.
 */
export default function SharePage() {
  usePageTitle('Share to VinaX');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const action = useMemo(
    () => shareAction({ title: params.get('title'), text: params.get('text'), url: params.get('url') }),
    [params],
  );

  useEffect(() => {
    if (action.kind === 'open') navigate(action.path, { replace: true });
    else if (action.kind === 'search') navigate(`/search/${encodeURIComponent(action.query)}`, { replace: true });
  }, [action, navigate]);

  if (action.kind === 'import') {
    // Saving (or closing) goes to Library, where the new playlist is.
    return <ImportPlaylistSheet initialText={action.text} onClose={() => navigate('/library', { replace: true })} />;
  }
  if (action.kind === 'none') {
    return (
      <EmptyState
        title="Nothing to look up"
        message="Share a song name, a list of songs or a VinaX link to open it here."
        action={(
          <Link to="/search" className="inline-flex items-center px-6 rounded-full btn-primary min-h-[44px]">
            Search
          </Link>
        )}
      />
    );
  }
  return null;
}
