/**
 * Where VinaX CLI keeps its own state.
 *
 * One directory, permissions tightened wherever the OS supports them, and no
 * provider credentials in any of it — the CLI has none to store. What lives
 * here is the user's own material: their config, their session transcripts,
 * their MCP server list, and a cache that can be deleted at any time.
 */
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface VinaxPaths {
  home: string;
  config: string;
  sessions: string;
  logs: string;
  cache: string;
  mcp: string;
}

/**
 * Resolve the VinaX home directory.
 *
 * `VINAX_HOME` wins, then the platform convention, then `~/.vinax`. Windows
 * gets APPDATA because scattering dotfiles through a Windows profile is not
 * what anyone there expects.
 */
export function vinaxHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env.VINAX_HOME && env.VINAX_HOME.trim()) return env.VINAX_HOME.trim();
  if (process.platform === 'win32' && env.APPDATA) return join(env.APPDATA, 'vinax');
  return join(env.HOME || homedir(), '.vinax');
}

export function paths(env: NodeJS.ProcessEnv = process.env): VinaxPaths {
  const home = vinaxHome(env);
  return {
    home,
    config: join(home, 'config.json'),
    sessions: join(home, 'sessions'),
    logs: join(home, 'logs'),
    cache: join(home, 'cache'),
    mcp: join(home, 'mcp.json'),
  };
}

/**
 * Create the directories, owner-only.
 *
 * Session transcripts contain whatever the user's project contains, so on a
 * shared machine they are nobody else's business. chmod is a no-op on
 * Windows, which is why it is allowed to fail quietly there.
 */
export async function ensureDirs(p: VinaxPaths = paths()): Promise<VinaxPaths> {
  for (const dir of [p.home, p.sessions, p.logs, p.cache]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await chmod(dir, 0o700);
    } catch {
      /* filesystem without POSIX modes — nothing to tighten */
    }
  }
  return p;
}

/** Tighten a file VinaX wrote. Best-effort, for the same reason. */
export async function restrict(file: string): Promise<void> {
  try {
    await chmod(file, 0o600);
  } catch {
    /* nothing to tighten here */
  }
}
