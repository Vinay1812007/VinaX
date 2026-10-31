/**
 * The owner console's server-secrets checklist (/api/admin/envcheck): names
 * only, never values; required names that are missing are listed; and the
 * VinaX AI provider keys are listed, all optional.
 */
import { describe, expect, it } from 'vitest';
import { ENV_ITEMS, onRequestGet } from '../functions/api/admin/envcheck';

const TOKEN = 'owner-password-for-tests';
const req = (token?: string) => new Request('https://example.test/api/admin/envcheck', { headers: token ? { 'x-admin-token': token, 'cf-connecting-ip': '198.51.100.7' } : { 'cf-connecting-ip': '198.51.100.8' } });

describe('/api/admin/envcheck', () => {
  it('needs the owner token', async () => {
    expect((await onRequestGet({ request: req(), env: { ADMIN_LOGIN_PASSWORD: TOKEN } })).status).toBe(401);
  });

  it('says which names are set and which required ones are missing, never a value', async () => {
    const env = { ADMIN_LOGIN_PASSWORD: TOKEN, SUPABASE_URL: 'https://db.test', DEVICE_ID_SECRET: '   ' };
    const res = await onRequestGet({ request: req(TOKEN), env });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ name: string; set: boolean }>; missingRequired: string[] };
    const set = Object.fromEntries(body.items.map((i) => [i.name, i.set]));
    expect(set.ADMIN_LOGIN_PASSWORD).toBe(true);
    expect(set.SUPABASE_URL).toBe(true);
    expect(set.DEVICE_ID_SECRET).toBe(false); // blank counts as missing
    expect(body.missingRequired).toEqual(expect.arrayContaining(['DEVICE_ID_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'ASSETS_HOST', 'HANDOFF']));
    expect(JSON.stringify(body)).not.toContain('https://db.test');
  });

  it('lists the VinaX AI provider keys, none of them required', () => {
    const ai = ENV_ITEMS.filter((i) => i.group === 'VinaX AI');
    expect(ai.map((i) => i.name)).toEqual(['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'AI']);
    expect(ai.every((i) => !i.required)).toBe(true);
    // The old build's names stay gone.
    expect(ENV_ITEMS.map((i) => i.name).join(' ')).not.toMatch(/MAESTRO|RESEARCH/);
  });

  it('counts a bound Workers AI binding as set', async () => {
    const res = await onRequestGet({ request: req(TOKEN), env: { ADMIN_LOGIN_PASSWORD: TOKEN, AI: { run: () => null }, GROQ_API_KEY: 'gsk_test' } });
    const body = (await res.json()) as { items: Array<{ name: string; set: boolean }> };
    const set = Object.fromEntries(body.items.map((i) => [i.name, i.set]));
    expect(set.AI).toBe(true);
    expect(set.GROQ_API_KEY).toBe(true);
    expect(set.GEMINI_API_KEY).toBe(false);
    expect(JSON.stringify(body)).not.toContain('gsk_test');
  });
});
