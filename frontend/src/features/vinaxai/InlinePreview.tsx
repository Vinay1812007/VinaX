/**
 * VinaX AI — a finished html, svg, diagram or React artifact shown as a live
 * preview inside the reply, the way a chart or page appears in place. It is
 * the same sandbox runner the artifact panel uses (its own origin, no access
 * to the app), mounted only once the reply scrolls near the screen, so a long
 * chat does not start a runner for every reply.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RunnerFrame } from './RunnerFrame';
import type { Artifact } from './artifacts';

export function InlinePreview({ artifact }: { artifact: Artifact }): ReactNode {
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
  return (
    <div ref={box} className="vx-ai-inline-preview" data-kind={artifact.type}>
      {/* Its own frame name: the panel's frame is "Preview: <title>". */}
      {near && <RunnerFrame kind={artifact.type} content={artifact.content} title={`${artifact.title || 'Artifact'} (in the reply)`} />}
    </div>
  );
}
