/**
 * VinaX AI — a preview in the sandbox runner: a page on its own origin
 * (sandbox.vinaxmusic.online), framed with sandbox="allow-scripts
 * allow-modals" and no allow-same-origin, sent the artifact by postMessage.
 * Nothing it runs can reach this app, its storage or its session. When the
 * runner does not answer (the sandbox site is not set up yet), the panel
 * says so and Code, Copy and Download still work.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ArtifactType } from './artifacts';

export const SANDBOX_ORIGIN: string = (import.meta.env.VITE_AI_SANDBOX_ORIGIN as string | undefined) || 'https://sandbox.vinaxmusic.online';
/** How long the runner has to say it is ready. */
export const READY_MS = 8_000;

const theme = (): 'dark' | 'light' => (document.documentElement.classList.contains('light') ? 'light' : 'dark');

export function RunnerFrame({ kind, content, title }: { kind: ArtifactType; content: string; title: string }): ReactNode {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // The runner's origin is opaque ("null") inside the sandbox: trust the frame, not the origin.
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { source?: string; type?: string; message?: string } | null;
      if (!d || d.source !== 'vinax-runner') return;
      if (d.type === 'ready') setState('ready');
      else if (d.type === 'error') setError(String(d.message ?? 'The preview failed.').slice(0, 300));
      else if (d.type === 'rendered') setError(null);
    };
    window.addEventListener('message', onMessage);
    const t = setTimeout(() => setState((s) => (s === 'loading' ? 'missing' : s)), READY_MS);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (state !== 'ready') return;
    setError(null);
    frame.current?.contentWindow?.postMessage({ type: 'render', kind, content, theme: theme() }, '*');
  }, [state, kind, content]);

  return (
    <div className="vx-ai-runner">
      {state === 'missing' ? (
        <div className="vx-ai-runner-missing" role="status">
          <p>Preview needs the sandbox host.</p>
          <p className="vx-ai-opt-sub">Code, Copy and Download still work.</p>
        </div>
      ) : (
        <iframe
          ref={frame}
          className="vx-ai-runner-frame"
          src={`${SANDBOX_ORIGIN}/`}
          title={`Preview: ${title}`}
          sandbox="allow-scripts allow-modals"
          referrerPolicy="no-referrer"
          allow=""
        />
      )}
      {error && <p className="vx-ai-runner-error" role="alert">{error}</p>}
    </div>
  );
}
