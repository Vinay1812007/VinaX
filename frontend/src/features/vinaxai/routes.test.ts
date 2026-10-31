// @vitest-environment jsdom
/**
 * /vinaxai opens VinaX AI; the old /VinaXAI spelling lands there. The
 * router ignores case unless told otherwise, so these routes are
 * case-sensitive: without that, /VinaXAI's redirect would also catch
 * /vinaxai and loop.
 */
import { describe, expect, it } from 'vitest';
import { matchRoutes, type RouteObject } from 'react-router-dom';
import { router } from '@/router';

const leaf = (path: string): RouteObject | undefined => {
  const m = matchRoutes(router.routes, path);
  return m ? m[m.length - 1].route : undefined;
};

describe('VinaX AI routes', () => {
  it('/vinaxai and /vinaxai/c/:id are the chat page', () => {
    expect(leaf('/vinaxai')?.path).toBe('vinaxai');
    expect(leaf('/vinaxai/c/abc')?.path).toBe('vinaxai/c/:id');
  });
  it('/VinaXAI is a redirect to /vinaxai, and only that exact spelling', () => {
    const r = leaf('/VinaXAI');
    expect(r?.path).toBe('/VinaXAI');
    expect((r?.element as { props?: { to?: string } })?.props?.to).toBe('/vinaxai');
    expect(leaf('/VinaXAI/old/link')?.path).toBe('/VinaXAI/*');
  });
});
