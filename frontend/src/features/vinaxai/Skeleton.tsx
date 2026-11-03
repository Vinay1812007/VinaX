/**
 * VinaX AI — loading placeholders: the shape of what is coming (a chat, a
 * new chat's greeting and composer, a grid of cards, the chat list) with a
 * soft shimmer, instead of an empty pane. Purely visual: one status with a
 * spoken label, the shapes hidden from screen readers. The shimmer stops
 * under reduced motion (vinaxai.css).
 */
import type { ReactNode } from 'react';

type Kind = 'chat' | 'welcome' | 'cards';

const Bar = ({ w, className = '' }: { w: string; className?: string }) => (
  <span className={`vx-ai-skel ${className}`} style={{ width: w }} />
);

/** Stands in for the chat pane (`.vx-ai-loading`) while a chat, the page or a project loads. */
export function PaneSkeleton({ kind = 'chat', label = 'Loading' }: { kind?: Kind; label?: string }): ReactNode {
  return (
    <div className={`vx-ai-loading is-${kind}`} role="status" aria-busy="true" aria-label={label}>
      <div className="vx-ai-column" aria-hidden>
        {kind === 'chat' && (
          <div className="vx-ai-skel-thread">
            <Bar w="min(46%, 280px)" className="is-bubble" />
            <div className="vx-ai-skel-lines">
              <Bar w="92%" /><Bar w="86%" /><Bar w="64%" />
            </div>
            <Bar w="min(34%, 220px)" className="is-bubble" />
            <div className="vx-ai-skel-lines">
              <Bar w="88%" /><Bar w="74%" /><Bar w="81%" /><Bar w="40%" />
            </div>
          </div>
        )}
        {kind === 'welcome' && (
          <div className="vx-ai-skel-welcome">
            <span className="vx-ai-skel is-orb" />
            <Bar w="min(60%, 320px)" className="is-title" />
            <span className="vx-ai-skel is-composer" />
            <div className="vx-ai-skel-chips"><Bar w="96px" /><Bar w="120px" /><Bar w="88px" /><Bar w="110px" /></div>
          </div>
        )}
        {kind === 'cards' && (
          <div className="vx-ai-skel-cards">
            <Bar w="min(40%, 220px)" className="is-title" />
            <div className="vx-ai-skel-grid"><span className="vx-ai-skel is-card" /><span className="vx-ai-skel is-card" /><span className="vx-ai-skel is-card" /></div>
          </div>
        )}
      </div>
    </div>
  );
}

const ROWS = ['72%', '88%', '64%', '80%', '56%', '76%'];

/** Stands in for the sidebar's chat list while it loads. */
export function ListSkeleton({ label }: { label: string }): ReactNode {
  return (
    <div className="vx-ai-side-skel" role="status" aria-label={label}>
      <span className="vx-ai-skel is-head" aria-hidden />
      {ROWS.map((w, i) => <span key={i} className="vx-ai-skel is-row" style={{ width: w }} aria-hidden />)}
    </div>
  );
}
