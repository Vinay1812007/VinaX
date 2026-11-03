#!/usr/bin/env node
/**
 * Console rebuild — robots.txt follows the admin console's "Bots allowed to read the
 * site" choices (backend/worker/functions/_lib/robots.ts).
 *
 * robots.txt must stay a static file (a Worker-served one answered 429 when
 * the daily quota ran out and Google stopped crawling the domain), so the
 * website build writes it: on Cloudflare Pages (CF_PAGES=1) this fetches
 * GET /api/robots and, when the answer looks like a robots file, writes it to
 * dist/robots.txt. Anywhere else, or on any failure, the committed
 * public/robots.txt (already copied into dist) stays. A save in the console
 * triggers a Pages rebuild through its deploy hook.
 */
/* global fetch, AbortSignal */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const API = (process.env.VINAX_ROBOTS_URL || 'https://www.vinaxmusic.online/api/robots').trim();

/** A body that is safe to publish as robots.txt. */
export function looksLikeRobots(text) {
  return typeof text === 'string' && text.length > 40 && text.length < 20000 && /^User-agent:\s*\*/m.test(text) && /^Sitemap:\s*https:\/\//m.test(text) && !/<html/i.test(text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.CF_PAGES !== '1' && process.env.VINAX_ROBOTS_URL === undefined) {
    console.log('robots: not a Pages build — keeping public/robots.txt');
  } else {
    try {
      const res = await fetch(API, { signal: AbortSignal.timeout(8000) });
      const text = res.ok ? await res.text() : '';
      if (looksLikeRobots(text)) {
        await writeFile(join(DIST, 'robots.txt'), text);
        console.log('robots: wrote dist/robots.txt from the console settings');
      } else {
        console.log(`robots: ${API} answered ${res.status} without a robots file — keeping public/robots.txt`);
      }
    } catch (e) {
      console.log(`robots: could not read ${API} (${e && e.message}) — keeping public/robots.txt`);
    }
  }
}
