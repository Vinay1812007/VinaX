/**
 * VinaX AI — a finished html, svg, diagram or React artifact shown as a live
 * preview inside the reply, the way a chart or page appears in place. It is
 * the same sandbox runner the artifact panel uses (its own origin, no access
 * to the app), mounted only once the reply scrolls near the screen, so a long
 * chat does not start a runner for every reply. Full screen shows it at the
 * screen's whole size (3-D scenes draw at its full resolution); Open puts it
 * in the side panel with its code.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExpandIcon, OpenExternalIcon } from './icons';
import { RunnerFrame } from './RunnerFrame';
import type { Artifact } from './artifacts';

export function InlinePreview({ artifact, onFix, onOpen }: { artifact: Artifact; onFix?(error: string): void; onOpen?(): void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.current?.requestFullscreen?.().catch(() => undefined);
  };
  return (
    <div ref={box} className={`vx-ai-inline-preview${full ? ' is-full' : ''}`} data-kind={artifact.type}>
      {/* Its own frame name: the panel's frame is "Preview: <title>". */}
      {near && <RunnerFrame kind={artifact.type} content={artifact.content} title={`${artifact.title || 'Artifact'} (in the reply)`} onFix={onFix} />}
      {(canFull || onOpen) && (
        <div className="vx-ai-inline-tools">
          {canFull && (
            <button type="button" className="vx-ai-inline-btn" onClick={toggleFull} aria-label={full ? 'Exit full screen' : `Full screen: ${artifact.title || 'preview'}`} title={full ? 'Exit full screen' : 'Full screen'}>
              <ExpandIcon className="w-4 h-4" />
            </button>
          )}
          {onOpen && !full && (
            <button type="button" className="vx-ai-inline-btn" onClick={onOpen} aria-label={`Open ${artifact.title || 'it'} with its code`} title="Open with code">
              <OpenExternalIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
