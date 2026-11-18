/**
 * Where the Node server's settings come from:
 *
 * - The plain [vars] of worker/wrangler.toml, read at build time and baked
 *   into the bundle (build.mjs), so wrangler.toml stays the one place for them.
 * - The env file on the server (default ./.env, or VINAX_ENV_FILE): every
 *   secret that `wrangler secret put` held on the Worker, plus CF_AI_TOKEN and
 *   the VINAX_* server settings. A value there overrides a [vars] one.
 *
 * Plain JS-compatible TypeScript (no enums, no parameter properties) and
 * node: imports only, so build.mjs can import it directly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** The string values of the `[vars]` table in a wrangler.toml. */
export function readWranglerVars(toml: string): Record<string, string> {
  const vars: Record<string, string> = {};
  let inVars = false;
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inVars = line === '[vars]';
      continue;
    }
    if (!inVars) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (!m) continue;
    vars[m[1]] = m[2] !== undefined ? JSON.parse(`"${m[2]}"`) : m[3];
  }
  return vars;
}

/** Read an env file (KEY=value lines); missing file = {}. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
  return out;
}

export interface ServerSettings {
  host: string;
  port: number;
  /** Scheme for request.url when no x-forwarded-proto arrives. */
  protocol: 'http' | 'https';
  dataDir: string;
  /** Run the 5-minute jobs here (turn the Worker's cron off first). */
  cron: boolean;
  /** Log one line per request. */
  logRequests: boolean;
}

/** The server's own settings, from the env file then the process environment. */
export function serverSettings(fileEnv: Record<string, string>, processEnv: Record<string, string | undefined>): ServerSettings {
  const get = (k: string): string | undefined => processEnv[k] ?? fileEnv[k];
  const port = Number(get('PORT') ?? 8787);
  const on = (k: string): boolean => /^(1|on|true|yes)$/i.test(get(k) ?? '');
  return {
    host: get('HOST') ?? '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8787,
    protocol: get('VINAX_PROTO') === 'http' ? 'http' : 'https',
    dataDir: get('VINAX_DATA_DIR') ?? './data',
    cron: on('VINAX_CRON'),
    logRequests: on('VINAX_LOG_REQUESTS'),
  };
}
