// Writes dist/changelog.json from src/constants/changelog.ts so the admin
// console's Release Notes panel (and anyone else) can read the update cards
// without shipping the TS module. Runs after the Vite build.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const entry = fileURLToPath(new URL('../src/constants/changelog.ts', import.meta.url));
const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
const mod = await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
const out = Object.entries(mod.CHANGELOG_V2).map(([version, v]) => ({ version, title: v.title ?? '', changes: v.changes }));
writeFileSync(new URL('../dist/changelog.json', import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), releases: out }));
console.log(`changelog.json: ${out.length} releases`);
