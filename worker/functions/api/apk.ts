/** Streams the latest private-release APK to anyone (token stays server-side). */
import { fetchAsset, githubConfigured, latestRelease, type GithubEnv } from '../_lib/github';

type Env = GithubEnv;

export const onRequestGet = async (context: { env: Env }): Promise<Response> => {
  const { env } = context;
  if (!githubConfigured(env)) return new Response('Updates not configured', { status: 503 });

  const rel = await latestRelease(env);
  const apk = (rel?.assets ?? []).find((a) => a.name.endsWith('.apk'));
  if (!apk) return new Response('No APK published', { status: 404 });

  const res = await fetchAsset(env, apk.url);
  if (!res || !res.ok || !res.body) return new Response('Download failed', { status: 502 });

  return new Response(res.body, {
    status: 200,
    headers: {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': 'attachment; filename="vinax.apk"',
      'cache-control': 'no-store',
    },
  });
};
