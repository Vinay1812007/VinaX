/**
 * Configuration precedence, and the rule that a repository cannot widen its
 * own access to the machine that cloned it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyProjectConfig, DEFAULTS, resolveConfig, type VinaxConfig } from '../src/config/config.js';
import { paths, vinaxHome } from '../src/config/paths.js';
import { cleanup, tempDir } from './helpers.js';

let root = '';
beforeEach(async () => { root = await tempDir('vinax-config-'); });
afterEach(async () => { await cleanup(root); });

async function projectConfig(body: unknown): Promise<void> {
  await mkdir(join(root, '.vinax'), { recursive: true });
  await writeFile(join(root, '.vinax', 'config.json'), JSON.stringify(body), 'utf8');
}

describe('project config cannot escalate privileges', () => {
  it('REFUSES a project asking for full-auto, and says so', async () => {
    await projectConfig({ approval: 'full-auto' });
    const { config, notes } = await resolveConfig({ root, userConfigFile: null });
    expect(config.approval).toBe('ask');
    expect(notes.some((n) => n.level === 'warn' && /cannot widen/i.test(n.message))).toBe(true);
  });

  it('refuses auto-edit when the user is on ask', async () => {
    await projectConfig({ approval: 'auto-edit' });
    const { config } = await resolveConfig({ root, userConfigFile: null });
    expect(config.approval).toBe('ask');
  });

  it('ACCEPTS a project making things stricter', () => {
    const config: VinaxConfig = { ...DEFAULTS, approval: 'full-auto' };
    const notes = applyProjectConfig(config, { approval: 'ask' });
    expect(config.approval).toBe('ask');
    expect(notes.some((n) => n.level === 'info')).toBe(true);
  });

  it('lets a project lower a ceiling but never raise one', () => {
    const config: VinaxConfig = { ...DEFAULTS };
    applyProjectConfig(config, { maxSteps: 10, commandTimeoutMs: 5000 });
    expect(config.maxSteps).toBe(10);
    expect(config.commandTimeoutMs).toBe(5000);

    const other: VinaxConfig = { ...DEFAULTS, maxSteps: 20 };
    const notes = applyProjectConfig(other, { maxSteps: 500 });
    expect(other.maxSteps).toBe(20);
    expect(notes.some((n) => n.level === 'warn' && n.message.includes('maxSteps'))).toBe(true);
  });

  it('lets a project switch web OFF but never ON', () => {
    const off: VinaxConfig = { ...DEFAULTS, web: true };
    applyProjectConfig(off, { web: false });
    expect(off.web).toBe(false);

    const on: VinaxConfig = { ...DEFAULTS, web: false };
    const notes = applyProjectConfig(on, { web: true });
    expect(on.web).toBe(false);
    expect(notes.some((n) => n.level === 'warn')).toBe(true);
  });

  it('never lets a project redirect the CLI at another service', () => {
    const config: VinaxConfig = { ...DEFAULTS };
    const notes = applyProjectConfig(config, { apiBase: 'https://not-vinax.example' });
    expect(config.apiBase).toBe(DEFAULTS.apiBase);
    expect(notes.some((n) => /apiBase/.test(n.message) && n.level === 'warn')).toBe(true);
  });

  it('never lets a project switch .gitignore filtering off', () => {
    const config: VinaxConfig = { ...DEFAULTS };
    applyProjectConfig(config, { useGitignore: false });
    expect(config.useGitignore).toBe(true);
  });

  it('ignores an approval value that is not a mode at all', () => {
    const config: VinaxConfig = { ...DEFAULTS };
    const notes = applyProjectConfig(config, { approval: 'root' });
    expect(config.approval).toBe('ask');
    expect(notes.some((n) => n.level === 'warn')).toBe(true);
  });

  it('accepts an engine preference, which grants nothing', () => {
    const config: VinaxConfig = { ...DEFAULTS };
    applyProjectConfig(config, { engine: 'deep' });
    expect(config.engine).toBe('deep');
  });
});

describe('precedence', () => {
  it('puts flags above the environment, the user file and the project file', async () => {
    await projectConfig({ engine: 'fast' });
    const userFile = join(root, 'user-config.json');
    await writeFile(userFile, JSON.stringify({ engine: 'deep', approval: 'auto-edit' }), 'utf8');
    const { config } = await resolveConfig({
      root,
      userConfigFile: userFile,
      env: { VINAX_ENGINE: 'power' },
      flags: { engine: 'balanced' },
    });
    expect(config.engine).toBe('balanced');
  });

  it('lets the environment override the user file, and the user file the project file', async () => {
    await projectConfig({ engine: 'fast' });
    const userFile = join(root, 'user-config.json');
    await writeFile(userFile, JSON.stringify({ engine: 'deep' }), 'utf8');
    const withEnv = await resolveConfig({ root, userConfigFile: userFile, env: { VINAX_ENGINE: 'power' } });
    expect(withEnv.config.engine).toBe('power');
    const withoutEnv = await resolveConfig({ root, userConfigFile: userFile, env: {} });
    expect(withoutEnv.config.engine).toBe('deep');
  });

  it('keeps a project tightening even when the user file is more permissive', async () => {
    await projectConfig({ approval: 'ask' });
    const userFile = join(root, 'user-config.json');
    await writeFile(userFile, JSON.stringify({ approval: 'full-auto' }), 'utf8');
    const { config } = await resolveConfig({ root, userConfigFile: userFile, env: {} });
    expect(config.approval).toBe('ask');
  });

  it('honours VINAX_API_BASE for development, and strips a trailing slash', async () => {
    const { config, sources } = await resolveConfig({
      root,
      userConfigFile: null,
      env: { VINAX_API_BASE: 'http://127.0.0.1:8787/' },
    });
    expect(config.apiBase).toBe('http://127.0.0.1:8787');
    expect(sources).toContain('VINAX_API_BASE');
  });

  it('turns colour off for NO_COLOR and TERM=dumb', async () => {
    expect((await resolveConfig({ root, userConfigFile: null, env: { NO_COLOR: '1' } })).config.color).toBe(false);
    expect((await resolveConfig({ root, userConfigFile: null, env: { TERM: 'dumb' } })).config.color).toBe(false);
  });

  it('survives a project config that is not valid JSON', async () => {
    await mkdir(join(root, '.vinax'), { recursive: true });
    await writeFile(join(root, '.vinax', 'config.json'), '{ not json', 'utf8');
    const { config } = await resolveConfig({ root, userConfigFile: null });
    expect(config.approval).toBe('ask');
  });

  it('defaults to asking, with web off', async () => {
    const { config } = await resolveConfig({ root, userConfigFile: null, env: {} });
    expect(config.approval).toBe('ask');
    expect(config.web).toBe(false);
    expect(config.apiBase).toBe('https://www.sirimillavinay.online');
  });
});

describe('configuration directory', () => {
  it('honours VINAX_HOME', () => {
    expect(vinaxHome({ VINAX_HOME: '/tmp/custom-vinax' })).toBe('/tmp/custom-vinax');
  });

  it('falls back to a dot directory in the home directory', () => {
    const home = vinaxHome({ HOME: '/home/someone' });
    expect(home.endsWith('.vinax')).toBe(true);
  });

  it('puts sessions, logs, cache and MCP config under one directory', () => {
    const p = paths({ VINAX_HOME: '/tmp/custom-vinax' });
    expect(p.sessions.startsWith(p.home)).toBe(true);
    expect(p.logs.startsWith(p.home)).toBe(true);
    expect(p.cache.startsWith(p.home)).toBe(true);
    expect(p.mcp.startsWith(p.home)).toBe(true);
  });
});
