import { findModel } from './models';
import { readPref, writePref } from './storage';
import type { ModelChoice, Provider, ProviderId } from './types';

/**
 * 11.0 — chat styles. The chat surface re-dresses itself to suit the family
 * of the selected model. Every style is VinaX's own drawing: the VinaX mark,
 * name and icons stay; only layout, shape, type, motion and colour
 * temperature change. The CSS lives in styles/ai-styles.css.
 */
export const CHAT_STYLE_IDS = ['vinax', 'mono', 'spectrum', 'paper', 'loop', 'void', 'forge', 'circuit', 'deep'] as const;
export type ChatStyleId = (typeof CHAT_STYLE_IDS)[number];

export type MakerFamily =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'meta'
  | 'xai'
  | 'mistral'
  | 'nvidia'
  | 'deepseek'
  | 'qwen'
  | 'moonshot'
  | 'microsoft'
  | 'cohere'
  | 'other';

/** Layout facts: what the screen is built like, apart from its paint. Stamped
 *  as `data-cs-*` attributes on `.ai-root`; the CSS keys off these. */
export interface ChatLayout {
  composer: 'card' | 'pill' | 'bar' | 'terminal';
  dock: 'center' | 'low';
  greeting: 'center' | 'left';
  starters: 'grid' | 'chips' | 'row' | 'list';
  user: 'bubble' | 'pill' | 'block' | 'outline';
  assistant: 'plain' | 'bubble';
  avatar: boolean;
  modelChip: 'inside' | 'start' | 'above';
  density: 'roomy' | 'regular' | 'compact';
  engine: 'chip' | 'tag';
}
export const CHAT_LAYOUT_KEYS = ['composer', 'dock', 'greeting', 'starters', 'user', 'assistant', 'avatar', 'modelChip', 'density', 'engine'] as const satisfies ReadonlyArray<keyof ChatLayout>;
const ATTR: Record<keyof ChatLayout, string> = { composer: 'composer', dock: 'dock', greeting: 'greeting', starters: 'starters', user: 'user', assistant: 'assistant', avatar: 'avatar', modelChip: 'chip', density: 'density', engine: 'engine' };
export const layoutAttrName = (key: keyof ChatLayout): string => `data-cs-${ATTR[key]}`;

export interface ChatStyle {
  id: ChatStyleId;
  /** Who it is drawn for, as the settings card says it. */
  audience: string;
  layout: ChatLayout;
  label: string;
  description: string;
  /** Maker families that land on this style under "Match the model". */
  families: readonly MakerFamily[];
}

export const CHAT_STYLES: readonly ChatStyle[] = [
  { id: 'vinax', label: 'VinaX', description: 'The VinaX look, in your app style and theme.', families: [], audience: 'For Auto', layout: { composer: 'card', dock: 'center', greeting: 'center', starters: 'grid', user: 'bubble', assistant: 'plain', avatar: true, modelChip: 'inside', density: 'regular', engine: 'chip' } },
  { id: 'mono', label: 'Mono', description: 'Quiet monochrome, lots of space, replies without bubbles.', families: ['openai'], audience: 'For OpenAI models', layout: { composer: 'pill', dock: 'center', greeting: 'center', starters: 'chips', user: 'pill', assistant: 'plain', avatar: false, modelChip: 'inside', density: 'roomy', engine: 'chip' } },
  { id: 'spectrum', label: 'Spectrum', description: 'A gradient greeting, tonal cards and a tall rounded composer.', families: ['google'], audience: 'For Google models', layout: { composer: 'card', dock: 'center', greeting: 'left', starters: 'row', user: 'bubble', assistant: 'plain', avatar: true, modelChip: 'inside', density: 'roomy', engine: 'chip' } },
  { id: 'paper', label: 'Paper', description: 'Warm paper, serif headings and a book-like reading width.', families: ['anthropic'], audience: 'For Anthropic models', layout: { composer: 'card', dock: 'center', greeting: 'center', starters: 'chips', user: 'block', assistant: 'plain', avatar: false, modelChip: 'start', density: 'roomy', engine: 'chip' } },
  { id: 'loop', label: 'Loop', description: 'Messenger bubbles on both sides with springy motion.', families: ['meta'], audience: 'For Meta models', layout: { composer: 'pill', dock: 'low', greeting: 'center', starters: 'grid', user: 'bubble', assistant: 'bubble', avatar: true, modelChip: 'inside', density: 'compact', engine: 'chip' } },
  { id: 'void', label: 'Void', description: 'Pure black or stark white, sharp corners, monospace labels.', families: ['xai'], audience: 'For xAI models', layout: { composer: 'terminal', dock: 'center', greeting: 'left', starters: 'list', user: 'outline', assistant: 'plain', avatar: false, modelChip: 'above', density: 'regular', engine: 'chip' } },
  { id: 'forge', label: 'Forge', description: 'Squared corners, bold small caps and warm stepped bars.', families: ['mistral'], audience: 'For Mistral models', layout: { composer: 'bar', dock: 'center', greeting: 'left', starters: 'list', user: 'block', assistant: 'plain', avatar: true, modelChip: 'inside', density: 'regular', engine: 'chip' } },
  { id: 'circuit', label: 'Circuit', description: 'Technical and compact, with a fine grid and a lime accent.', families: ['nvidia'], audience: 'For NVIDIA models', layout: { composer: 'card', dock: 'center', greeting: 'left', starters: 'grid', user: 'block', assistant: 'plain', avatar: true, modelChip: 'inside', density: 'compact', engine: 'tag' } },
  { id: 'deep', label: 'Deep', description: 'Calm deep blue, compact, with thinking set aside.', families: ['deepseek', 'qwen', 'moonshot', 'microsoft', 'cohere', 'other'], audience: 'For DeepSeek, Qwen, Moonshot and other models', layout: { composer: 'card', dock: 'center', greeting: 'center', starters: 'grid', user: 'bubble', assistant: 'plain', avatar: true, modelChip: 'inside', density: 'compact', engine: 'chip' } },
];

/** The `data-cs-*` attributes for a style, ready to spread on an element. */
export function layoutAttrs(id: ChatStyleId): Record<string, string> {
  const layout = chatStyle(id).layout;
  const out: Record<string, string> = {};
  for (const key of CHAT_LAYOUT_KEYS) out[layoutAttrName(key)] = String(layout[key]);
  return out;
}

export const isChatStyleId = (v: unknown): v is ChatStyleId => typeof v === 'string' && (CHAT_STYLE_IDS as readonly string[]).includes(v);

export const chatStyle = (id: ChatStyleId): ChatStyle => CHAT_STYLES.find((s) => s.id === id) ?? CHAT_STYLES[0];

/** Ordered: the first pattern that matches wins, so a distilled or fine-tuned
 *  model is filed under the maker named first in its slug. */
const PATTERNS: ReadonlyArray<[MakerFamily, RegExp]> = [
  ['nvidia', /\bnvidia\b|nemotron/],
  ['deepseek', /deepseek/],
  ['openai', /\bopenai\b|\bgpt\b|gpt-|^o[1-9]\b|whisper/],
  ['google', /\bgoogle\b|gemini|gemma/],
  ['anthropic', /anthropic/],
  ['xai', /\bx-ai\b|\bxai\b|grok/],
  ['mistral', /mistral|mixtral|codestral|ministral|pixtral|devstral|magistral/],
  ['qwen', /qwen|alibaba|\bqwq\b/],
  ['moonshot', /moonshot|kimi/],
  ['microsoft', /microsoft|\bphi-?\d/],
  ['cohere', /cohere|command-[ar]/],
  ['meta', /\bmeta\b|meta-llama|llama/],
];

const match = (text: string): MakerFamily | null => {
  for (const [family, re] of PATTERNS) if (re.test(text)) return family;
  return null;
};

/** The maker family of a model: the slug's maker prefix first, then the
 *  catalogue's maker string, then the rest of the slug, then the provider. */
export function makerFamily(slug: string, maker: string | null | undefined, provider: ProviderId | null | undefined): MakerFamily {
  const id = (slug || '').toLowerCase();
  const slash = id.indexOf('/');
  const prefix = slash > 0 ? id.slice(0, slash) : '';
  const name = slash > 0 ? id.slice(slash + 1) : id;
  const found = (prefix && match(prefix)) || (maker && match(maker.toLowerCase())) || match(name);
  if (found) return found;
  if (provider === 'gemini') return 'google';
  if (provider === 'nvidia') return 'nvidia';
  return 'other';
}

export const styleForFamily = (family: MakerFamily): ChatStyleId => CHAT_STYLES.find((s) => s.families.includes(family))?.id ?? 'deep';

/** The style a pick asks for: Auto is VinaX's own; a model follows its maker. */
export function styleForChoice(choice: ModelChoice | null | undefined, providers: readonly Provider[] = []): ChatStyleId {
  if (!choice || choice.mode !== 'model') return 'vinax';
  const maker = findModel(providers, choice.provider, choice.model)?.maker ?? null;
  return styleForFamily(makerFamily(choice.model, maker, choice.provider));
}

/** Stored preference: follow the model, always VinaX, or one fixed style. */
export type ChatStylePref = 'match' | ChatStyleId;
export const CHAT_STYLE_KEY = 'vinax.ai.chatStyle';

export const parseChatStylePref = (raw: unknown): ChatStylePref => (raw === 'match' || isChatStyleId(raw) ? raw : 'match');
export const loadChatStylePref = (): ChatStylePref => parseChatStylePref(readPref(CHAT_STYLE_KEY, 'match'));
export const saveChatStylePref = (pref: ChatStylePref): void => writePref(CHAT_STYLE_KEY, pref);

export const resolveChatStyle = (pref: ChatStylePref, choice: ModelChoice | null | undefined, providers: readonly Provider[] = []): ChatStyleId =>
  pref === 'match' ? styleForChoice(choice, providers) : pref;
