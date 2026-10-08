import { useId, type ReactNode } from 'react';
import type { ProviderId } from './types';
import { BRAND_MARKS } from './brandMarks';

/**
 * 10.3 — the provider marks (11.2: five, with Cloudflare's cloud), drawn inline (no remote images: the CSP
 * allows none, and the menu must not wait on the network). 11.3.2 — the real
 * outlines (./brandMarks.ts) for NVIDIA, OpenRouter, Gemini and Cloudflare;
 * Groq keeps its simple drawn q (no published outline to use).
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
  cloudflare: { tile: '#F38020', ink: '#FFFFFF' },
};

/** Each mark on a 24 grid, in the colour it is given. */
function Mark({ id, color }: { id: ProviderId; color: string }): ReactNode {
  switch (id) {
    case 'nvidia':
      return <path fill={color} d={BRAND_MARKS.nvidia.path} />;
    case 'openrouter':
      return <path fill={color} d={BRAND_MARKS.p_openrouter.path} />;
    case 'groq':
      // The rounded q: a ring with a hooked tail.
      return (
        <g fill="none" stroke={color} strokeWidth={2.3} strokeLinecap="round">
          <circle cx="11.5" cy="10.5" r="5" />
          <path d="M16.5 10.5v4.2a4.8 4.8 0 0 1-4.8 4.8H9.5" />
        </g>
      );
    case 'gemini':
      return <path fill={color} d={BRAND_MARKS.p_gemini.path} />;
    case 'cloudflare':
      return <path fill={color} d={BRAND_MARKS.p_cloudflare.path} />;
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
