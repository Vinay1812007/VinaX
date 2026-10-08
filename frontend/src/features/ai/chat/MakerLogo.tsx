import { useId, type ReactNode } from 'react';
import { BRAND_MARKS, type BrandMarkId } from './brandMarks';
import type { MakerFamily } from './chatStyle';
import { ProviderLogo } from './ProviderLogo';
import type { ProviderId } from './types';

/**
 * 11.3.2 — the logo of the company that MADE a model (Google, Meta, Mistral …),
 * next to its name in the model menu, the composer chip, the answered-by chip
 * and the reply's avatar. The provider that serves it (NVIDIA, OpenRouter,
 * Groq, Gemini, Cloudflare) keeps its own mark on the menu's section headings.
 *
 * Real outlines only (./brandMarks.ts). A maker with no published outline gets
 * a plain letter tile; an unknown maker falls back to the provider's logo.
 * Shown only to say which model answered — VinaX's own layout, colours and
 * name stay as they are.
 */
const MARK_OF: Partial<Record<MakerFamily, BrandMarkId>> = {
  google: 'google',
  meta: 'meta',
  mistral: 'mistral',
  deepseek: 'deepseek',
  qwen: 'qwen',
  moonshot: 'moonshot',
  anthropic: 'anthropic',
  nvidia: 'nvidia',
};
/** Makers without a published outline: a letter tile, never an imitation. */
const LETTER_OF: Partial<Record<MakerFamily, { letter: string; name: string }>> = {
  openai: { letter: 'O', name: 'OpenAI' },
  microsoft: { letter: 'M', name: 'Microsoft' },
  xai: { letter: 'x', name: 'xAI' },
  cohere: { letter: 'C', name: 'Cohere' },
};

/** Dark ink on a light tile, white on everything else. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#111111' : '#FFFFFF';
}

/** The maker's name for a family, when the logo stands for it. */
export function makerName(family: MakerFamily): string | null {
  const mark = MARK_OF[family];
  if (mark) return BRAND_MARKS[mark].title;
  return LETTER_OF[family]?.name ?? null;
}

/** True when a family has a logo or a letter tile of its own. */
export const hasMakerLogo = (family: MakerFamily): boolean => !!(MARK_OF[family] || LETTER_OF[family]);

export function MakerLogo({
  family,
  provider,
  size = 16,
  label,
  className,
}: {
  family: MakerFamily;
  /** Shown instead when the maker is unknown. */
  provider?: ProviderId | null;
  size?: number;
  /** Names the logo for a screen reader when no visible text sits beside it. */
  label?: string;
  className?: string;
}): ReactNode {
  const titleId = useId();
  const markId = MARK_OF[family];
  const letter = LETTER_OF[family];
  if (!markId && !letter) {
    return provider ? <ProviderLogo provider={provider} size={size} label={label} className={className} /> : null;
  }
  const a11y = label ? ({ role: 'img', 'aria-labelledby': titleId } as const) : ({ 'aria-hidden': true, focusable: 'false' } as const);
  const tile = markId ? BRAND_MARKS[markId].hex : '#2A2B33';
  const ink = inkFor(tile);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} data-maker={family} style={{ flexShrink: 0, display: 'block' }} {...a11y}>
      {label && <title id={titleId}>{label}</title>}
      <rect width="24" height="24" rx="6" fill={tile} />
      {markId ? (
        <g transform="translate(4.2 4.2) scale(0.65)">
          <path fill={ink} d={BRAND_MARKS[markId].path} />
        </g>
      ) : (
        <text x="12" y="16.6" textAnchor="middle" fontSize="13" fontWeight="700" fill={ink} fontFamily="inherit">
          {letter?.letter}
        </text>
      )}
    </svg>
  );
}
