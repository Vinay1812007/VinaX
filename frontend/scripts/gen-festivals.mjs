// Regenerates every artefact derived from the festival calendar + skins:
//   src/styles/festivals.css, the FW pre-paint table in index.html (and the
//   backend shell copy when present), and public/admin/festivals.js.
// Run: npm run gen:festivals   (src/constants/festivals.test.ts fails on drift)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { buildCss, buildWindowJs, buildAdminJs, FW_RE } from './festivals-gen-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadTs(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { FESTIVALS } = await loadTs('src/constants/festivals.ts');
const { FESTIVAL_THEMES } = await loadTs('src/constants/festivalThemes.ts');

writeFileSync(join(ROOT, 'src/styles/festivals.css'), buildCss(FESTIVALS, FESTIVAL_THEMES));
writeFileSync(join(ROOT, 'public/admin/festivals.js'), buildAdminJs(FESTIVALS, FESTIVAL_THEMES));

const fw = buildWindowJs(FESTIVALS);
for (const html of [join(ROOT, 'index.html'), join(ROOT, '..', 'backend', 'index.html')]) {
  if (!existsSync(html)) continue;
  const s = readFileSync(html, 'utf8');
  if (!FW_RE.test(s)) { console.warn(`gen-festivals: no FW table in ${html}`); continue; }
  writeFileSync(html, s.replace(FW_RE, fw));
}
console.log(`gen-festivals: ${FESTIVALS.length} festivals → festivals.css, admin/festivals.js, index.html`);
