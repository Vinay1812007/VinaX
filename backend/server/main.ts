/**
 * Entry of the Node build (server/dist/vinax-api.mjs, made by build.mjs):
 * the same API as the Cloudflare Worker, on one server, with no daily
 * request limit. README.md (Operations), "Running the API on a server".
 *
 *   node vinax-api.mjs        reads ./.env (or VINAX_ENV_FILE)
 */
import { resolve } from 'node:path';
import worker from '../worker/index';
import { buildEnv, createApp, startCron, type WorkerLike } from './app';
import { readEnvFile, serverSettings } from './env';

declare const __VINAX_VARS__: Record<string, string>;
declare const __VINAX_BUILD__: string;

const envPath = resolve(process.env.VINAX_ENV_FILE ?? '.env');
const fileEnv = readEnvFile(envPath);
const settings = serverSettings(fileEnv, process.env);

// [vars] from wrangler.toml, then the env file over them. Only the server's
// own settings come from the process environment; the rest of it (PATH,
// HOME, …) never reaches the handlers.
const values: Record<string, string> = { ...__VINAX_VARS__, ...fileEnv };
const env = buildEnv(values, resolve(settings.dataDir));
const app = createApp({ worker: worker as unknown as WorkerLike, env, protocol: settings.protocol, logRequests: settings.logRequests });
const stopCron = settings.cron ? startCron(worker as unknown as WorkerLike, env, app.ctx) : () => undefined;

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));

app.server.listen(settings.port, settings.host, () => {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !values[k]);
  console.log(
    `vinax-api ${__VINAX_BUILD__} on http://${settings.host}:${settings.port}` +
      ` (env file ${envPath}${Object.keys(fileEnv).length ? '' : ': not found or empty'};` +
      ` cron ${settings.cron ? 'on' : 'off'}; Workers AI ${env.AI ? 'on' : 'off'})`,
  );
  if (missing.length) console.warn(`[warn] not set: ${missing.join(', ')}; database routes answer "not configured"`);
});

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping`);
  stopCron();
  app.server.close();
  app.server.closeIdleConnections();
  // Give open replies and waitUntil work up to 10 s, then go.
  const hard = setTimeout(() => process.exit(0), 10_000);
  hard.unref();
  void app.drain(9_000).then(() => {
    app.server.closeAllConnections();
    process.exit(0);
  });
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
