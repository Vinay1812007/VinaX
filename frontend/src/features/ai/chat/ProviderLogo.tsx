import { useId, type ReactNode } from 'react';
import type { ProviderId } from './types';

/**
 * 10.3 — the four provider marks, drawn inline (no remote images: the CSP
 * allows none, and the menu must not wait on the network). Simplified,
 * single-colour-capable versions of each provider's mark.
 *
 * `tone="brand"` (default) sets the mark in white or ink on a small tile of
 * the provider's colour, so it reads the same on the light and dark themes;
 * `tone="mono"` draws the bare mark in currentColor.
 *
 * Next to visible text (a menu heading, the composer chip, the answered-by
 * chip) the logo is decoration and hidden from assistive tech; pass `label`
 * when it stands alone and it becomes an image with that name.
 */
const BRAND: Record<ProviderId, { tile: string; ink: string }> = {
  nvidia: { tile: '#76B900', ink: '#0B0F02' },
  openrouter: { tile: '#6467F2', ink: '#FFFFFF' },
  groq: { tile: '#F55036', ink: '#FFFFFF' },
  gemini: { tile: '#3C7BEB', ink: '#FFFFFF' },
};

/** Each mark on a 24 grid, in the colour it is given. */
function Mark({ id, color }: { id: ProviderId; color: string }): ReactNode {
  switch (id) {
    case 'nvidia':
      // The eye: an almond outline around a spiral that opens to the right.
      return (
        <g fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 12c2.6-4.3 6-6.5 9.5-6.5s6.9 2.2 9.5 6.5c-2.6 4.3-6 6.5-9.5 6.5S5.1 16.3 2.5 12Z" />
          <path d="M15.2 12a3.2 3.2 0 1 1-3.2-3.2c1.2 0 2.1.5 2.7 1.3" />
        </g>
      );
    case 'openrouter':
      // One line in, routed to two arrows out.
      return (
        <g fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h3.5c3.2 0 3.8-5 7-5H19" />
          <path d="M6.5 12c3.2 0 3.8 5 7 5H19" />
          <path d="M16.5 4.5 19 7l-2.5 2.5M16.5 14.5 19 17l-2.5 2.5" />
        </g>
      );
    case 'groq':
      // The rounded q: a ring with a hooked tail.
      return (
        <g fill="none" stroke={color} strokeWidth={2.3} strokeLinecap="round">
          <circle cx="11.5" cy="10.5" r="5" />
          <path d="M16.5 10.5v4.2a4.8 4.8 0 0 1-4.8 4.8H9.5" />
        </g>
      );
    case 'gemini':
      // The four-point spark.
      return <path fill={color} d="M12 2.5c.6 5 4.4 8.9 9.5 9.5-5.1.6-8.9 4.5-9.5 9.5-.6-5-4.4-8.9-9.5-9.5 5.1-.6 8.9-4.5 9.5-9.5Z" />;
  }
}

export interface ProviderLogoProps {
  provider: ProviderId;
  /** Rendered size in px (square). */
  size?: number;
  tone?: 'brand' | 'mono';
  /** Names the logo for a screen reader when no visible text sits beside it. */
  label?: string;
  className?: string;
}

export function ProviderLogo({ provider, size = 16, tone = 'brand', label, className }: ProviderLogoProps): ReactNode {
  const titleId = useId();
  const a11y = label
    ? ({ role: 'img', 'aria-labelledby': titleId } as const)
    : ({ 'aria-hidden': true, focusable: 'false' } as const);
  const brand = BRAND[provider];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      data-provider={provider}
      style={{ flexShrink: 0, display: 'block' }}
      {...a11y}
    >
      {label && <title id={titleId}>{label}</title>}
      {tone === 'brand' ? (
        <>
          <rect width="24" height="24" rx="6" fill={brand.tile} />
          <g transform="translate(3.6 3.6) scale(0.7)">
            <Mark id={provider} color={brand.ink} />
          </g>
        </>
      ) : (
        <Mark id={provider} color="currentColor" />
      )}
    </svg>
  );
}
