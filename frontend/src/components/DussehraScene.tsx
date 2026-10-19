import type { CSSProperties } from 'react';
import {
  DS_ARROW, DS_DEFS, DS_JAMMI, DS_RAMA, DS_RAVANA, DS_SCARF, DS_SKYLINE,
  DS_STRING_DRAWN, DS_STRING_REST, DS_VIEWBOX,
} from '@/constants/dussehraScene';
import '@/styles/dussehra-scene.css';

/** Cracker bursts over the effigy after the arrow lands: [left %, top %, colour variant]. */
const BURSTS: Array<[number, number, number]> = [[70, 14, 0], [93, 10, 1], [82, 3, 2]];

/** Flames at the effigy's feet, as [left %, scale]. */
const FLAMES: Array<[number, number]> = [[76.4, 0.8], [79.6, 1.15], [82.8, 0.9], [85.4, 0.7]];

/**
 * One layer of the stage: the same viewBox over the same box, so a layer can
 * be moved as a whole element and still line up with the art beneath it.
 * Static, in-repo markup (constants/dussehraScene.ts) — never user content.
 */
function Layer({ className, markup }: { className: string; markup: string }) {
  return (
    <svg
      className={`ds-layer ${className}`}
      viewBox={DS_VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
      focusable="false"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/**
 * Dussehra's own living backdrop (13.7.1): Rama, the arrow, Ravanasura,
 * fire and crackers on one stage above the player, and Jammi leaves falling
 * through the whole sky. Mounted by FestBackdrop only when motion is allowed;
 * pausing with the tab is handled by `.fest-sky.is-paused`.
 *
 * Leaf positions are arithmetic on the index, not random, like the other set
 * pieces: the same sky on every open, and the tests can assert it.
 */
export function DussehraScene({ leaves }: { leaves: number }) {
  return (
    <>
      <div className="ds-scene" data-testid="ds-scene">
        <Layer className="ds-art" markup={DS_DEFS + DS_SKYLINE + DS_RAMA} />
        <Layer className="ds-scarf" markup={DS_SCARF} />
        <Layer className="ds-string-drawn" markup={DS_STRING_DRAWN} />
        <Layer className="ds-string-rest" markup={DS_STRING_REST} />
        <Layer className="ds-ravana" markup={DS_RAVANA} />
        <div className="ds-fire">
          {FLAMES.map(([left, s], i) => (
            <i key={i} style={{ left: `${left}%`, ['--ds-s' as string]: s, animationDelay: `${-i * 0.37}s` } as CSSProperties} />
          ))}
        </div>
        <i className="ds-hit" />
        {BURSTS.map(([left, top, v], i) => (
          <i key={i} className={`ds-burst ds-burst-${v}`} style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${i * 0.28}s` }} />
        ))}
        <Layer className="ds-arrow" markup={DS_ARROW} />
      </div>
      {leaves > 0 && (
        <div className="ds-leaves">
          {Array.from({ length: leaves }, (_, i) => (
            <i
              key={i}
              className="ds-leaf"
              style={{
                left: `${(i * 61 + 7) % 94}%`,
                // Step and modulus coprime so the sway widths, sizes and
                // speeds do not fall into step with each other.
                ['--ds-sway' as string]: `${(i % 2 ? 1 : -1) * (14 + ((i * 7) % 23))}px`,
                ['--ds-size' as string]: `${18 + ((i * 5) % 13)}px`,
                animationDelay: `${-((i * 2.3) % 14)}s`,
                animationDuration: `${12 + (i % 6) * 2.2}s`,
              } as CSSProperties}
            >
              <svg viewBox="0 0 24 32" aria-hidden focusable="false" dangerouslySetInnerHTML={{ __html: DS_JAMMI }} />
            </i>
          ))}
        </div>
      )}
    </>
  );
}
