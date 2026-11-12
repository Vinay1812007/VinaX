/**
 * VinaX AI Live voice — where an open call lives: mounted by AppLayout while
 * a call is open (liveCall.ts), so the call survives moving between pages.
 * When it ends, the chat it was saved into is refreshed; if the listener is
 * in VinaX AI, that chat opens (as it did before the call could go to the
 * background); elsewhere they stay where they are.
 */
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import '@/styles/pages/vinaxai.css';
import LiveView from './LiveView';
import { useLiveCall } from './liveCall';
import { resetChat } from '../store';

export default function LiveHost(): ReactNode {
  const call = useLiveCall((s) => s.call);
  const key = useLiveCall((s) => s.key);
  const minimized = useLiveCall((s) => s.minimized);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  if (!call) return null;
  const onClose = (savedTo: string | null) => {
    useLiveCall.getState().close();
    if (!savedTo) return;
    void qc.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] });
    // Reload the chat so the spoken turns show in the thread (not from a cached copy of it).
    qc.removeQueries({ queryKey: ['vinaxai', 'conversation', savedTo] });
    if (pathname === '/vinaxai' || pathname.startsWith('/vinaxai/c/')) {
      resetChat();
      navigate(`/vinaxai/c/${savedTo}`, { replace: pathname === `/vinaxai/c/${savedTo}` });
    }
  };
  return (
    <LiveView
      key={key}
      {...call}
      minimized={minimized}
      onMinimize={() => useLiveCall.getState().minimize()}
      onExpand={() => useLiveCall.getState().expand()}
      onClose={onClose}
    />
  );
}
