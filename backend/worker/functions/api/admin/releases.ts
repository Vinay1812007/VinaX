/**
 * v5.13.0 — Releases & CI: the latest GitHub release (what the Android
 * updater serves), the newest workflow runs, and whether the live site is
 * on the version the repo says it should be. Read-only; needs the same
 * GITHUB_TOKEN the APK updater already uses, and says so when it is absent.
 */
import { isAdmin, unauthorized, type AdminEnv } from '../../_lib/admin';
import { githubConfigured, latestRelease, type GithubEnv } from '../../_lib/github';

type Env = AdminEnv & GithubEnv;

interface RunRow { id: number; name: string; display_title?: string; status: string; conclusion: string | null; head_branch: string; head_sha: string; event: string; created_at: string; updated_at: string; html_url: string; run_number: number; }
interface CommitRow { sha: string; commit: { message: string; author: { name: string; date: string } }; html_url: string; }

const json = (o: unknown, status = 200): Response =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function gh<T>(env: GithubEnv, path: string): Promise<T | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO || 'Vinay1812007/VinaX'}${path}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'VinaX-Admin', 'x-github-api-version': '2022-11-28' },
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  if (!isAdmin(request, env)) return unauthorized();
  if (!githubConfigured(env)) return json({ configured: false });
  const origin = new URL(request.url).origin.replace('admin.', 'www.');

  const [release, runs, commits, live] = await Promise.all([
    latestRelease(env),
    gh<{ workflow_runs: RunRow[] }>(env, '/actions/runs?per_page=20'),
    gh<CommitRow[]>(env, '/commits?per_page=10&sha=main'),
    fetch(`${origin}/api/version`, { headers: { 'cache-control': 'no-cache' } }).then((r) => r.json()).catch(() => null) as Promise<Record<string, unknown> | null>,
  ]);

  return json({
    configured: true,
    release: release
      ? { tag: release.tag_name, name: release.name, notes: (release.body ?? '').slice(0, 1200), assets: release.assets.map((a) => ({ name: a.name, url: a.browser_download_url })) }
      : null,
    runs: (runs?.workflow_runs ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      title: r.display_title ?? r.name,
      status: r.status,
      conclusion: r.conclusion,
      branch: r.head_branch,
      sha: r.head_sha.slice(0, 7),
      event: r.event,
      started: r.created_at,
      finished: r.updated_at,
      number: r.run_number,
      url: r.html_url,
    })),
    commits: (commits ?? []).map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0].slice(0, 120), author: c.commit.author.name, at: c.commit.author.date, url: c.html_url })),
    live,
  });
};
