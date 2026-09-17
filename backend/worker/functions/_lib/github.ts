/**
 * Server-side GitHub helper for the (private) VinaX repo. The token lives ONLY
 * as a Cloudflare secret — never in the client. Lets us report the latest
 * release and stream its APK to users without exposing the repo.
 */
export interface GithubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
}

const DEFAULT_REPO = 'Vinay1812007/VinaX';
/** Outbound wait before a hung upstream is abandoned. */
const REQUEST_TIMEOUT_MS = 10_000;

function repo(env: GithubEnv): string {
  return env.GITHUB_REPO || DEFAULT_REPO;
}

export interface GhAsset { name: string; url: string; browser_download_url: string; }
export interface GhRelease { tag_name: string; name: string; body?: string | null; assets: GhAsset[]; }

export function githubConfigured(env: GithubEnv): boolean {
  return !!env.GITHUB_TOKEN;
}

function ghHeaders(env: GithubEnv, accept: string): Record<string, string> {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept,
    'user-agent': 'VinaX-Updater',
    'x-github-api-version': '2022-11-28',
  };
}

export async function latestRelease(env: GithubEnv): Promise<GhRelease | null> {
  if (!env.GITHUB_TOKEN) return null;
  // The small JSON body is read under the same leash as the headers.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo(env)}/releases/latest`, {
      headers: ghHeaders(env, 'application/vnd.github+json'),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as GhRelease;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a private release asset's bytes. GitHub 302-redirects the API asset URL
 * to storage; the cross-origin redirect strips our Authorization header, so the
 * storage request is unauthenticated (as required). Returns the final Response.
 */
export async function fetchAsset(env: GithubEnv, assetUrl: string): Promise<Response | null> {
  if (!env.GITHUB_TOKEN) return null;
  // Leash on time-to-headers only — cleared once the (redirected) response
  // arrives, so the multi-megabyte asset body streams without a deadline.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(assetUrl, {
      headers: ghHeaders(env, 'application/octet-stream'),
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
