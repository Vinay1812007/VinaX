/**
 * Listen Together's live line and the app's headers: the page may open a
 * secure WebSocket to Supabase Realtime (the room's live line), and nothing
 * else of Supabase: the database is the Worker's alone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
const csp = /Content-Security-Policy: (.+)/.exec(headers)![1];
const connect = (/(?:^|; )connect-src ([^;]+)/.exec(csp)?.[1] ?? '').split(/\s+/);

describe('the live line in the app CSP', () => {
  it('connects to Supabase Realtime over a secure WebSocket only', () => {
    expect(connect).toContain('wss://*.supabase.co');
    expect(connect.some((h) => h.startsWith('https://') && h.includes('supabase'))).toBe(false);
    expect(connect.some((h) => h.startsWith('ws://'))).toBe(false);
  });
});
