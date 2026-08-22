/**
 * Public update manifest for the Android app. Reads the latest release of the
 * private repo via the server-side token and returns the build number, version
 * name, the (proxied) APK url, and the APK's SHA-256. No auth needed by callers.
 */
import { fetchAsset, githubConfigured, latestRelease, type GithubEnv } from '../_lib/github';

type Env = GithubEnv;

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(body: unknown, status = 200, cache = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': cache, ...CORS },
  });
}

/**
 * The build number the installed app must compare against — it MUST equal the
 * APK's Android versionCode, or the update check silently never fires.
 *
 * Root cause of the "no in-app updates" outage: CI builds APKs with
 * versionCode = BASE + run_number (H-OPS-2 disjoint ranges) but tagged
 * releases "-build<run_number>" (the RAW run number). Parsing the tag gave
 * e.g. 106 while installed devices carried 1106 — every device looked "up to
 * date" forever. CI now writes an explicit "VersionCode: NNN" line into the
 * release body, which is authoritative; the tag parse remains as a fallback
 * for the pre-fix releases. Exported for tests.
 */
export function buildFromRelease(tagName: string, body?: string | null): number {
  const fromBody = parseInt(/versioncode[:\s]+(\d+)/i.exec(body ?? '')?.[1] ?? '0', 10);
  if (fromBody > 0) return fromBody;
  return parseInt(/build(\d+)/i.exec(tagName)?.[1] ?? '0', 10);
}

export const onRequestOptions = async (): Promise<Response> =>
  new Response(null, { status: 204, headers: CORS });

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!githubConfigured(env)) return json({ error: 'not_configured' }, 503);

  const rel = await latestRelease(env);
  if (!rel || !rel.tag_name) return json({ error: 'no_release' }, 502);

  const build = buildFromRelease(rel.tag_name, rel.body);
  const version = rel.tag_name.replace(/^v/, '').split('-build')[0];

  let sha256: string | undefined;
  const shaAsset = (rel.assets ?? []).find((a) => a.name.endsWith('.sha256'));
  if (shaAsset) {
    const shaRes = await fetchAsset(env, shaAsset.url);
    if (shaRes && shaRes.ok) {
      const hex = (await shaRes.text()).trim().split(/\s+/)[0];
      if (/^[a-f0-9]{64}$/i.test(hex)) sha256 = hex.toLowerCase();
    }
  }

  const origin = new URL(request.url).origin;
  return json({ build, version, apkUrl: `${origin}/api/apk`, sha256 }, 200, 'public, max-age=60');
};
