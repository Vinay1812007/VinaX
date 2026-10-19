#!/usr/bin/env node
/**
 * 13.7 — content-stamp the owner console's script and stylesheet links.
 *
 * The console is un-hashed static files under /admin/. Pages serves them with
 * `Cache-Control: no-cache` (public/_headers), but the custom domains apply
 * the zone's Browser Cache TTL and hand browsers `max-age=14400`, so an owner
 * kept running a four-hour-old app.js against a new API. index.html itself
 * is not cached, so each link gets `?v=<first 10 hex of the file's sha256>`:
 * a changed file is a new URL at once; an unchanged one stays cached.
 *
 * Runs after `vite build` (which copied public/ into dist/). Rewrites only
 * dist/admin/index.html; the source file keeps plain links.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const INDEX = join(DIST, 'admin', 'index.html');

/** `<script src="/admin/…">` and `<link … href="/admin/…">` for .js/.css files. */
export const ADMIN_ASSET = /(\s(?:src|href)=")(\/admin\/[\w./-]+\.(?:js|css))(")/g;

export async function stampAdmin(html, readAsset) {
  const seen = new Map();
  let out = html;
  for (const m of html.matchAll(ADMIN_ASSET)) {
    const path = m[2];
    if (seen.has(path)) continue;
    const body = await readAsset(path);
    seen.set(path, createHash('sha256').update(body).digest('hex').slice(0, 10));
  }
  out = out.replace(ADMIN_ASSET, (_, pre, path, post) => `${pre}${path}?v=${seen.get(path)}${post}`);
  return { html: out, count: seen.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = await readFile(INDEX, 'utf8');
  const { html: stamped, count } = await stampAdmin(html, (p) => readFile(join(DIST, p.slice(1))));
  await writeFile(INDEX, stamped);
  console.log(`admin-stamp: ${count} console assets stamped`);
}
