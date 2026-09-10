// Make the built entry point executable and confirm it kept its shebang.
// npm sets the bit itself on install, but a developer running the binary
// straight out of dist/ (and the e2e suite, which does exactly that) needs it.
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const entry = join('dist', 'cli.js');
const head = readFileSync(entry, 'utf8').slice(0, 32);
if (!head.startsWith('#!/usr/bin/env node')) {
  console.error(`postbuild: ${entry} lost its shebang — the vinax binary would not run.`);
  process.exit(1);
}
chmodSync(entry, 0o755);
// stderr, not stdout: this now runs as a `prepack` lifecycle script, and
// `npm pack --json` / `npm publish --json` emit machine-readable JSON on
// stdout. A progress line printed there corrupts the very output that CI and
// the package tests parse.
console.error(`postbuild: ${entry} is executable`);
