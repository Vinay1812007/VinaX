// Writes public/admin/css/tokens.css from src/styles/tokens.css (see admin-tokens-core.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdminTokens } from './admin-tokens-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
writeFileSync(join(ROOT, 'public/admin/css/tokens.css'), buildAdminTokens(readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8'), readFileSync(join(ROOT, 'src/styles/index.css'), 'utf8')));
console.log('admin-tokens: public/admin/css/tokens.css');
