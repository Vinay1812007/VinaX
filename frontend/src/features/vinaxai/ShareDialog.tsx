/**
 * VinaX AI — Share chat. A link anyone can open shows a snapshot of the
 * chat as it is now; later messages join only when the link is updated.
 * Stop sharing deletes the snapshot. Focus moves in, Tab stays inside,
 * Escape closes and focus goes back to the Share button.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { AiError, listShares, shareConversation, shareNotice, shareUrl, stopSharing } from './api';
import { copyText } from './CodeBlock';
import { CloseIcon, CopyIcon, LinkIcon, ShareIcon } from './icons';
import type { ShareSummary } from './types';

interface Props {
  conversationId: string;
  title: string | null;
  onClose(): void;
}

export const shareDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Copy, and the device's own share sheet where there is one. */
export function ShareActions({ link, title }: { link: string; title: string }): ReactNode {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <>
      <button type="button" className="vx-ai-chip is-primary" onClick={() => void copyText(link, 'Link copied')}>
        <CopyIcon className="w-4 h-4" /> Copy link
      </button>
      {canShare && (
        <button type="button" className="vx-ai-chip" onClick={() => void navigator.share({ title, url: link }).catch(() => undefined)}>
          <ShareIcon className="w-4 h-4" /> Share…
        </button>
      )}
    </>
  );
}

export function ShareDialog({ conversationId, title, onClose }: Props): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  useDismissOnBack(true, onClose);
  const key = ['vinaxai', 'shares', conversationId];
  const shares = useQuery({ queryKey: key, queryFn: () => listShares(conversationId), staleTime: 0, retry: 1 });
  const share: ShareSummary | null = shares.data?.items[0] ?? null;
  const [busy, setBusy] = useState<null | 'create' | 'update' | 'stop'>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button')?.focus();
    return () => back?.focus?.();
  }, []);
  // When the buttons change under it, focus goes to the first one in the body.
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = box.current;
    const active = document.activeElement;
    if (el && (!el.contains(active) || active === closeBtn.current)) el.querySelector<HTMLElement>('.vx-ai-share-body button:not([disabled])')?.focus();
  }, [share?.id, confirmStop, shares.isPending]);

  const done = (next: ShareSummary | null, said: string) => {
    qc.setQueryData(key, { items: next ? [next] : [] });
    void qc.invalidateQueries({ queryKey: ['vinaxai', 'shares', 'all'] });
    setStatus(said);
  };
  const run = async (what: 'create' | 'update' | 'stop') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'stop' && share) {
        await stopSharing(share.id);
        setConfirmStop(false);
        done(null, 'Sharing stopped. The link no longer works.');
      } else {
        const r = await shareConversation(conversationId);
        done(r.share, what === 'create' ? 'Link created.' : 'Link updated with the chat as it is now.');
      }
    } catch (e) {
      setError(shareNotice(e instanceof AiError ? e.code : 'network'));
    } finally {
      setBusy(null);
    }
  };

  const name = title?.trim() || 'this chat';
  const link = share ? shareUrl(share.id) : '';
  let body: ReactNode;
  if (shares.isPending) body = <p className="vx-ai-share-note" aria-busy="true">Checking for a link…</p>;
  else if (shares.isError) {
    body = (
      <>
        <p className="vx-ai-share-note">Couldn’t check whether this chat is shared.</p>
        <div className="vx-ai-dialog-row"><button type="button" className="vx-ai-chip" onClick={() => void shares.refetch()}>Try again</button></div>
      </>
    );
  } else if (confirmStop && share) {
    body = (
      <>
        <p className="vx-ai-share-note">Stop sharing “{name}”? The link stops working for everyone, and the snapshot is deleted. Your chat stays as it is.</p>
        <div className="vx-ai-dialog-row">
          <button type="button" className="vx-ai-chip" onClick={() => setConfirmStop(false)}>Keep sharing</button>
          <button type="button" className="vx-ai-chip is-danger" disabled={!!busy} onClick={() => void run('stop')}>Stop sharing</button>
        </div>
      </>
    );
  } else if (share) {
    body = (
      <>
        <label className="vx-ai-share-label" htmlFor="vx-ai-share-link">Anyone with this link can view the chat</label>
        <div className="vx-ai-share-link">
          <LinkIcon className="w-4 h-4" />
          <input id="vx-ai-share-link" type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
        <p className="vx-ai-share-note">
          Shows the chat as it was on {shareDate(share.updatedAt)} ({share.messageCount} message{share.messageCount === 1 ? '' : 's'}). Messages you send later aren’t included until you update the link.
        </p>
        <div className="vx-ai-share-row">
          <ShareActions link={link} title={share.title} />
        </div>
        <div className="vx-ai-share-row">
          <button type="button" className="vx-ai-chip" disabled={!!busy} onClick={() => void run('update')}>{busy === 'update' ? 'Updating…' : 'Update link'}</button>
          <button type="button" className="vx-ai-chip vx-ai-share-stop" disabled={!!busy} onClick={() => setConfirmStop(true)}>Stop sharing</button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <ul className="vx-ai-share-points">
          <li>Anyone with the link can view a snapshot of this chat as it is now: your messages and VinaX AI’s replies, with any artifacts.</li>
          <li>Files you added show by name only. Their contents, and VinaX AI’s reasoning, aren’t included. Your name isn’t shown.</li>
          <li>Messages you send after this aren’t included until you update the link. You can stop sharing at any time.</li>
        </ul>
        <div className="vx-ai-dialog-row">
          <button type="button" className="vx-ai-chip" onClick={onClose}>Cancel</button>
          <button type="button" className="vx-ai-chip is-primary" disabled={!!busy} onClick={() => void run('create')}>
            <LinkIcon className="w-4 h-4" /> {busy === 'create' ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="vx-ai-scrim" onClick={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vx-ai-share-title"
        className="vx-ai-dialog vx-ai-share"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (confirmStop) setConfirmStop(false);
            else onClose();
          }
          if (e.key === 'Tab') {
            const f = [...(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input') ?? [])];
            if (!f.length) return;
            const i = f.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
          }
        }}
      >
        <div className="vx-ai-share-head">
          <h2 id="vx-ai-share-title">{share ? 'Shared chat' : 'Share chat'}</h2>
          <button ref={closeBtn} type="button" className="vx-ai-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="vx-ai-share-body">{body}</div>
        {error && <p className="vx-ai-share-error" role="alert">{error}</p>}
        <p className="sr-only" role="status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
