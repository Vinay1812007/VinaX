#!/usr/bin/env node
/**
 * Create (or update) the zone-edge rules that keep scraper traffic off the
 * Worker's daily request quota. Code in the Worker cannot do this: a request
 * on a Worker route is counted the moment it arrives, before any cache or
 * handler runs (see worker/functions/_lib/pageGuard.ts, which only makes such
 * requests cheap and useless). These rules run at the zone edge, in front of
 * the Worker, and a blocked or challenged request is never invoked.
 *
 * Two rules, both idempotent (matched by description, updated in place):
 *
 *  1. "VinaX entity pages: browser impostors" — BLOCK. A user agent that
 *     claims a Chromium browser on /song|album|artist|playlist/ but sends no
 *     `sec-ch-ua` header. Every real Chromium has sent it since 2020; a script
 *     with a copied user agent does not. Safari, Firefox and Chrome on iOS do
 *     not say "Chrome/" and are unaffected. Zero friction for people.
 *
 *  2. "VinaX entity pages: unverified automation" — MANAGED CHALLENGE on the
 *     same paths for anything that is not a verified bot (`cf.client.bot`) and
 *     not a link previewer. A person sees the interstitial once per browser
 *     and never again; a robot without a browser never gets through.
 *     Opt in with --challenge (off by default: it adds one interstitial for
 *     first-time human visitors arriving from a shared link).
 *
 * Needs an API token with the Zone → Firewall Services → Edit permission for
 * this zone (the Worker deploy token does not have it). Nothing else is read
 * or changed.
 *
 *   CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs --dry-run
 *   CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs
 *   CLOUDFLARE_ZONE_TOKEN=… node backend/scripts/cf-edge-rules.mjs --challenge
 *
 * CLOUDFLARE_ZONE_ID defaults to the production zone. Free-plan WAF custom
 * rules do not support regular expressions, so paths are matched with
 * starts_with(); the free plan allows five custom rules — this uses two.
 */
const ZONE = process.env.CLOUDFLARE_ZONE_ID || 'dce9a2b8fa46d9a7c809b00c9d591743';
const TOKEN = process.env.CLOUDFLARE_ZONE_TOKEN;
const DRY = process.argv.includes('--dry-run');
const CHALLENGE = process.argv.includes('--challenge');
const API = 'https://api.cloudflare.com/client/v4';

const PATHS = ['/song/', '/album/', '/artist/', '/playlist/'];
const onEntityPage = `(${PATHS.map((p) => `starts_with(http.request.uri.path, "${p}")`).join(' or ')})`;
const previewers = ['WhatsApp', 'facebookexternalhit', 'Twitterbot', 'TelegramBot', 'LinkedInBot', 'Slackbot', 'Discordbot', 'SkypeUriPreview']
  .map((ua) => `http.user_agent contains "${ua}"`)
  .join(' or ');

const RULES = [
  {
    description: 'VinaX entity pages: browser impostors',
    action: 'block',
    expression: `${onEntityPage} and http.user_agent contains "Chrome/" and not any(http.request.headers.names[*] == "sec-ch-ua") and not cf.client.bot`,
    enabled: true,
  },
  {
    description: 'VinaX entity pages: unverified automation',
    action: 'managed_challenge',
    expression: `${onEntityPage} and not cf.client.bot and not (${previewers})`,
    enabled: CHALLENGE,
  },
];

async function cf(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ') || `${res.status} ${res.statusText}`;
    throw new Error(`${init.method || 'GET'} ${path} → ${msg}`);
  }
  return body.result;
}

async function main() {
  console.log(`zone ${ZONE}${DRY ? ' (dry run)' : ''}`);
  for (const r of RULES) console.log(`\n${r.enabled ? 'ON ' : 'off'} ${r.action.padEnd(17)} ${r.description}\n    ${r.expression}`);
  if (DRY) return;
  if (!TOKEN) throw new Error('CLOUDFLARE_ZONE_TOKEN is not set (a token with Zone → Firewall Services → Edit for this zone)');

  // The zone's custom-rules ruleset (one per zone; created on first write).
  const rulesets = await cf(`/zones/${ZONE}/rulesets`);
  let ruleset = rulesets.find((s) => s.phase === 'http_request_firewall_custom' && s.kind === 'zone');
  if (!ruleset) {
    ruleset = await cf(`/zones/${ZONE}/rulesets`, { method: 'POST', body: JSON.stringify({ name: 'default', kind: 'zone', phase: 'http_request_firewall_custom', rules: [] }) });
  }
  const full = await cf(`/zones/${ZONE}/rulesets/${ruleset.id}`);
  const existing = full.rules || [];
  for (const r of RULES) {
    const have = existing.find((e) => e.description === r.description);
    const payload = { description: r.description, action: r.action, expression: r.expression, enabled: r.enabled };
    if (have) {
      await cf(`/zones/${ZONE}/rulesets/${ruleset.id}/rules/${have.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      console.log(`updated  ${r.description}`);
    } else {
      await cf(`/zones/${ZONE}/rulesets/${ruleset.id}/rules`, { method: 'POST', body: JSON.stringify(payload) });
      console.log(`created  ${r.description}`);
    }
  }
  console.log('\nDone. Check Security → WAF → Custom rules in the dashboard; the Workers request graph should flatten within the hour.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
