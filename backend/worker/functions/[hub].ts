/**
 * Top-level single-segment router hook: serves edge-rendered SEO for the
 * mood × language hub pages (/telugu-romantic-songs …) and passes EVERY
 * other single-segment path straight through to static assets / the SPA
 * shell via next(). matchHub() is a strict allow-list (known languages ×
 * known moods), so /about, /queue, /telugu-songs etc. are untouched.
 */
import { matchHub, renderHub } from './_lib/render';

interface Ctx {
  request: Request;
  env: {
    ASSETS: { fetch: (req: Request | string | URL) => Promise<Response> };
  };
  next: () => Promise<Response>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const onRequestGet = async (context: Ctx): Promise<Response> => {
  const hub = matchHub(new URL(context.request.url).pathname);
  if (!hub) return context.next();
  return renderHub(hub.lang, hub.mood, context.request, context.env, context.waitUntil);
};
