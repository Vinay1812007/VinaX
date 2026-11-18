// Build the Node server: one self-contained file, server/dist/vinax-api.mjs,
// with wrangler.toml's [vars] baked in. The backend has no runtime
// dependencies, so the server needs only Node (22+) and that file.
//
//   npm run server:build
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readWranglerVars } from './env.ts';

const here = dirname(fileURLToPath(import.meta.url));
const vars = readWranglerVars(readFileSync(join(here, '../worker/wrangler.toml'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  // Not a git checkout.
}

await build({
  entryPoints: [join(here, 'main.ts')],
  outfile: join(here, 'dist/vinax-api.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  define: {
    __VINAX_VARS__: JSON.stringify(vars),
    __VINAX_BUILD__: JSON.stringify(`${pkg.version}+${commit}`),
  },
  logLevel: 'info',
});
