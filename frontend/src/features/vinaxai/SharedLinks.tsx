/** VinaX AI settings — the listener's shared links: open, copy, stop sharing. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/store/toastStore';
import { AiError, listShares, shareNotice, shareUrl, stopSharing } from './api';
import { copyText } from './CodeBlock';
import { shareDate } from './ShareDialog';
import { CopyIcon, TrashIcon } from './icons';
import type { ShareSummary } from './types';

export function SharedLinks({ onNavigate }: { onNavigate(): void }): ReactNode {
  const qc = useQueryClient();
  const shares = useQuery({ queryKey: ['vinaxai', 'shares', 'all'], queryFn: () => listShares(), staleTime: 0, retry: 1 });
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Focus follows the row's buttons as they change, so it never drops out of the dialog.
  const lastAsked = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (asking) el.querySelector<HTMLElement>('.vx-ai-links-ask button')?.focus();
    else if (lastAsked.current) (el.querySelector<HTMLElement>(`[data-share="${lastAsked.current}"] .vx-ai-links-tools button`) ?? el).focus();
    lastAsked.current = asking;
  }, [asking, shares.data]);

  const stop = async (id: string) => {
    setBusy(true);
    try {
      await stopSharing(id);
      toast('Sharing stopped');
      qc.setQueryData<{ items: ShareSummary[] }>(['vinaxai', 'shares', 'all'], (d) => (d ? { items: d.items.filter((x) => x.id !== id) } : d));
      setAsking(null);
      void qc.invalidateQueries({ queryKey: ['vinaxai', 'shares'] });
    } catch (e) {
      toast(shareNotice(e instanceof AiError ? e.code : 'network'));
    } finally {
      setBusy(false);
    }
  };

  const items = shares.data?.items ?? [];
  return (
    <div className="vx-ai-links" ref={box} tabIndex={-1}>
      <h4>Shared links</h4>
      {shares.isPending && <p className="vx-ai-settings-note" aria-busy="true">Loading…</p>}
      {shares.isError && <p className="vx-ai-settings-note">Couldn’t load your shared links.</p>}
      {shares.isSuccess && !items.length && <p className="vx-ai-settings-note">You haven’t shared any chats. Use Share at the top of a chat to make a link.</p>}
      {items.length > 0 && (
        <ul className="vx-ai-links-list">
          {items.map((s) => (
            <li key={s.id} data-share={s.id}>
              <div className="vx-ai-links-text">
                <Link to={`/vinaxai/share/${s.id}`} onClick={onNavigate} className="vx-ai-links-title">{s.title}</Link>
                <span className="vx-ai-opt-sub">Updated {shareDate(s.updatedAt)}</span>
              </div>
              {asking === s.id ? (
                <span className="vx-ai-links-ask" role="group" aria-label={`Stop sharing ${s.title}?`}>
                  <button type="button" className="vx-ai-chip" onClick={() => setAsking(null)}>Keep</button>
                  <button type="button" className="vx-ai-chip is-danger" disabled={busy} onClick={() => void stop(s.id)}>Stop sharing</button>
                </span>
              ) : (
                <span className="vx-ai-links-tools">
                  <button type="button" className="vx-ai-act" onClick={() => void copyText(shareUrl(s.id), 'Link copied')} aria-label={`Copy link to ${s.title}`} title="Copy link">
                    <CopyIcon className="w-4 h-4" />
                  </button>
                  <button type="button" className="vx-ai-act" onClick={() => setAsking(s.id)} aria-label={`Stop sharing ${s.title}`} title="Stop sharing">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="vx-ai-settings-note">Anyone with a link can view that chat as it was when you shared or last updated it. Deleting a chat stops its link too.</p>
    </div>
  );
}
