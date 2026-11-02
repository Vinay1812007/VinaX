/**
 * Console rebuild — which crawlers may read the website, as the owner sets it on
 * Google Search → "Bots allowed to read the site" (the `robots` setting:
 * `{ bots: { "<bot>": true | false } }`, true = allow, false = block).
 *
 * robots.txt itself stays a STATIC file on the website host, never a Worker
 * route: when the Worker's daily quota ran out, a Worker-served robots.txt
 * answered 429 and Google stopped crawling the whole domain (wrangler.toml,
 * 11.0.3). Instead GET /api/robots answers the text this module builds, and
 * the website build (frontend/scripts/robots-from-api.mjs, on Cloudflare
 * Pages only) writes it into dist/robots.txt. A save in the console asks the
 * host to rebuild (the PAGES_DEPLOY_HOOK secret) so it is live in minutes.
 *
 * With no setting the text is exactly today's policy: search engines welcome,
 * AI-training scrapers and SEO-tool crawlers blocked.
 */

export type BotGroup = 'search' | 'ai' | 'seo';

export interface BotSpec {
  /** The User-agent token robots.txt names. */
  id: string;
  /** Plain name for the console. */
  name: string;
  /** Who runs it, in plain words. */
  about: string;
  group: BotGroup;
  /** Allowed when the owner has not chosen. */
  allowByDefault: boolean;
}

export const BOT_GROUPS: Record<BotGroup, string> = { search: 'Search engines', ai: 'AI bots', seo: 'SEO tools' };

export const BOTS: readonly BotSpec[] = [
  { id: 'Googlebot', name: 'Google', about: 'Google Search', group: 'search', allowByDefault: true },
  { id: 'Bingbot', name: 'Bing', about: 'Microsoft Bing (also feeds Yahoo and DuckDuckGo)', group: 'search', allowByDefault: true },
  { id: 'DuckDuckBot', name: 'DuckDuckGo', about: 'DuckDuckGo search', group: 'search', allowByDefault: true },
  { id: 'YandexBot', name: 'Yandex', about: 'Yandex search', group: 'search', allowByDefault: true },
  { id: 'Applebot', name: 'Apple', about: 'Siri and Spotlight suggestions', group: 'search', allowByDefault: true },
  { id: 'GPTBot', name: 'GPTBot', about: 'OpenAI, for training ChatGPT', group: 'ai', allowByDefault: false },
  { id: 'ChatGPT-User', name: 'ChatGPT browsing', about: 'OpenAI, when a ChatGPT user asks it to open a page', group: 'ai', allowByDefault: false },
  { id: 'OAI-SearchBot', name: 'ChatGPT search', about: 'OpenAI search results (can send visitors)', group: 'ai', allowByDefault: true },
  { id: 'ClaudeBot', name: 'ClaudeBot', about: 'Anthropic, for training Claude', group: 'ai', allowByDefault: false },
  { id: 'Claude-Web', name: 'Claude browsing', about: 'Anthropic, when a Claude user asks it to open a page', group: 'ai', allowByDefault: false },
  { id: 'anthropic-ai', name: 'Anthropic (older name)', about: 'Anthropic', group: 'ai', allowByDefault: false },
  { id: 'PerplexityBot', name: 'PerplexityBot', about: 'Perplexity answers', group: 'ai', allowByDefault: false },
  { id: 'Google-Extended', name: 'Google AI training', about: 'Google Gemini training (does not affect Google Search)', group: 'ai', allowByDefault: false },
  { id: 'Applebot-Extended', name: 'Apple AI training', about: 'Apple Intelligence training (does not affect Siri suggestions)', group: 'ai', allowByDefault: false },
  { id: 'CCBot', name: 'Common Crawl', about: 'A public web copy many AI models train on', group: 'ai', allowByDefault: false },
  { id: 'Bytespider', name: 'Bytespider', about: 'ByteDance (TikTok) AI', group: 'ai', allowByDefault: false },
  { id: 'Amazonbot', name: 'Amazonbot', about: 'Amazon Alexa and AI', group: 'ai', allowByDefault: false },
  { id: 'meta-externalagent', name: 'Meta AI', about: 'Meta AI training', group: 'ai', allowByDefault: false },
  { id: 'FacebookBot', name: 'FacebookBot', about: 'Meta language models', group: 'ai', allowByDefault: false },
  { id: 'cohere-ai', name: 'Cohere', about: 'Cohere AI', group: 'ai', allowByDefault: false },
  { id: 'YouBot', name: 'You.com', about: 'You.com AI search', group: 'ai', allowByDefault: false },
  { id: 'Diffbot', name: 'Diffbot', about: 'Data extraction for AI', group: 'ai', allowByDefault: false },
  { id: 'PetalBot', name: 'PetalBot', about: 'Huawei Petal search', group: 'ai', allowByDefault: false },
  { id: 'omgili', name: 'Webz.io', about: 'Data resold for AI training', group: 'ai', allowByDefault: false },
  { id: 'Timpibot', name: 'Timpi', about: 'Data for AI', group: 'ai', allowByDefault: false },
  { id: 'AhrefsBot', name: 'Ahrefs', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'SemrushBot', name: 'Semrush', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'MJ12bot', name: 'Majestic', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'DotBot', name: 'Moz', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'DataForSeoBot', name: 'DataForSEO', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'BLEXBot', name: 'BLEXBot', about: 'SEO tool', group: 'seo', allowByDefault: false },
  { id: 'ZoominfoBot', name: 'ZoomInfo', about: 'Business data', group: 'seo', allowByDefault: false },
] as const;

/** Allowed or blocked for every bot: the owner's choice, else the built-in rule. */
export function botChoices(raw: unknown): Record<string, boolean> {
  const src = raw && typeof raw === 'object' && (raw as { bots?: unknown }).bots && typeof (raw as { bots: unknown }).bots === 'object'
    ? ((raw as { bots: Record<string, unknown> }).bots)
    : {};
  const out: Record<string, boolean> = {};
  for (const b of BOTS) out[b.id] = typeof src[b.id] === 'boolean' ? (src[b.id] as boolean) : b.allowByDefault;
  return out;
}

/** Paths no crawler needs (the private app screens and the API). */
export const PRIVATE_PATHS = ['/api/', '/search', '/library', '/favorites', '/history', '/queue', '/now-playing', '/stats', '/settings', '/taste-profile', '/handoff', '/offline', '/collection/', '/cache-info'];

/** The robots.txt text for these choices. Pure. */
export function robotsTxt(raw: unknown, origin = 'https://www.vinaxmusic.online'): string {
  const allow = botChoices(raw);
  const blocked = BOTS.filter((b) => !allow[b.id]);
  // A search engine the owner blocked is named with the others; a normally
  // blocked bot the owner allowed simply falls through to the `*` rules.
  const lines = [
    '# VinaX crawl policy (set in the admin console → Google Search → Bots allowed to read the site).',
    '# Search engines that send listeners are welcome on the public catalogue.',
    '',
  ];
  for (const g of ['search', 'ai', 'seo'] as BotGroup[]) {
    const list = blocked.filter((b) => b.group === g);
    if (!list.length) continue;
    lines.push(`# ---- Blocked: ${BOT_GROUPS[g]} ----`);
    for (const b of list) lines.push(`User-agent: ${b.id}`);
    lines.push('Disallow: /', '');
  }
  lines.push('# ---- Everyone else ----', 'User-agent: *', 'Allow: /');
  for (const p of PRIVATE_PATHS) lines.push(`Disallow: ${p}`);
  lines.push('# Politeness hint (Bing/Yandex honor it; Google uses Search Console settings)', 'Crawl-delay: 5', '', `Sitemap: ${origin}/sitemap.xml`, '');
  return lines.join('\n');
}

/** The user-agents a robots.txt blocks from the whole site. Pure. */
export function readRobotsBlocked(text: string): string[] {
  const blocked: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(v);
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (key === 'disallow' && v === '/') for (const a of agents) if (a !== '*') blocked.push(a);
    }
  }
  return [...new Set(blocked)];
}
