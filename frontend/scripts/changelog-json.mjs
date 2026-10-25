// Writes dist/changelog.json from src/constants/changelog.ts so the admin
// console's Release Notes panel (and anyone else) can read the update cards
// without shipping the TS module. Runs after the Vite build.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(ROOT, 'src/constants/changelog.ts');
const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const mod = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
// V2 1.0 — the VinaX V2 line first, then the classic history (1.x–15.x); `line` tells the two apart.
const out = [
  ...Object.entries(mod.CHANGELOG_V2).map(([version, v]) => ({ version, line: 'v2', title: v.title ?? '', changes: v.changes })),
  ...Object.entries(mod.CHANGELOG_CLASSIC ?? {}).map(([version, v]) => ({ version, line: 'classic', title: v.title ?? '', changes: v.changes })),
];
writeFileSync(join(ROOT, 'dist/changelog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), releases: out }));
console.log(`changelog.json: ${out.length} releases`);
