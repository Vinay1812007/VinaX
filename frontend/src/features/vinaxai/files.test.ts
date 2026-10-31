// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fitWithin, kindOf, refuse, uploadError } from './files';
import { usePendingFiles } from './usePendingFiles';

afterEach(() => vi.unstubAllGlobals());

const f = (name: string, type: string, size = 10) => ({ name, type, size });
const none = { images: 0, files: 0, inConversation: 0 };

describe('which files', () => {
  it('kinds: images, PDFs, text and code by type or extension', () => {
    expect(kindOf(f('a.png', 'image/png'))).toBe('image');
    expect(kindOf(f('a.gif', 'image/gif'))).toBe('image');
    expect(kindOf(f('paper.pdf', ''))).toBe('pdf');
    expect(kindOf(f('main.rs', ''))).toBe('text');
    expect(kindOf(f('data.json', 'application/json'))).toBe('text');
    expect(kindOf(f('a.svg', 'image/svg+xml'))).toBeNull();
    expect(kindOf(f('a.zip', 'application/zip'))).toBeNull();
  });
  it('the limits: 5 images and 10 files a message, 20 a chat, PDFs 20 MB, text 1 MB', () => {
    expect(refuse(f('a.png', 'image/png'), { ...none, images: 5, files: 5 })).toMatch(/5 images/);
    expect(refuse(f('a.txt', 'text/plain'), { ...none, files: 10 })).toMatch(/10 files/);
    expect(refuse(f('a.txt', 'text/plain'), { ...none, inConversation: 20 })).toMatch(/20 files/);
    expect(refuse(f('a.pdf', 'application/pdf', 21 * 1024 * 1024), none)).toMatch(/20 MB/);
    expect(refuse(f('a.md', 'text/markdown', 2 * 1024 * 1024), none)).toMatch(/1 MB/);
    expect(refuse(f('a.exe', 'application/x-msdownload'), none)).toMatch(/can’t be added/);
    expect(refuse(f('a.png', 'image/png', 8 * 1024 * 1024), none)).toBeNull(); // shrunk before upload
  });
  it('images shrink to 1568 px on the long edge, never grow', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(1000, 3136)).toEqual({ width: 500, height: 1568 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('upload failures in words', () => {
    expect(uploadError('too_many_pages', 'big.pdf')).toBe('big.pdf has more than 100 pages.');
    expect(uploadError('unsupported_type', 'x.png')).toBe('x.png isn’t a file VinaX AI can read.');
  });
});

describe('usePendingFiles', () => {
  it('uploads a text file as soon as it is added, then hands it to the message', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'att-1', name: 'notes.md', mime: 'text/markdown', size: 5, kind: 'text' }), { status: 200 });
    }));
    const { result } = renderHook(() => usePendingFiles('c1', 0));
    act(() => result.current.add([new File(['# hi'], 'notes.md', { type: 'text/markdown' })]));
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.files[0].status).toBe('ready'));
    expect(calls[0].url).toBe('/api/ai/attachments?name=notes.md&conversationId=c1');
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe('text/markdown');
    let taken: ReturnType<typeof result.current.take> = [];
    act(() => { taken = result.current.take(); });
    expect(taken).toEqual([{ id: 'att-1', name: 'notes.md', mime: 'text/markdown', size: 5, kind: 'text' }]);
    expect(result.current.files).toEqual([]);
  });

  it('refuses what cannot be added with a notice, and removing an upload deletes it', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
      return new Response(JSON.stringify({ id: 'att-2', name: 'a.txt', mime: 'text/plain', size: 1, kind: 'text' }), { status: 200 });
    }));
    const { result } = renderHook(() => usePendingFiles(null, 0));
    act(() => result.current.add([new File(['x'], 'a.zip', { type: 'application/zip' }), new File(['x'], 'a.txt', { type: 'text/plain' })]));
    expect(result.current.notice).toMatch(/can’t be added/);
    expect(result.current.files).toHaveLength(1);
    await waitFor(() => expect(result.current.files[0].status).toBe('ready'));
    act(() => result.current.remove(result.current.files[0].key));
    await waitFor(() => expect(calls[calls.length - 1]).toEqual({ url: '/api/ai/attachments/att-2', method: 'DELETE' }));
  });

  it('an upload the server refuses shows why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'unsupported_type' }), { status: 415 })));
    const { result } = renderHook(() => usePendingFiles(null, 0));
    act(() => result.current.add([new File(['x'], 'weird.txt', { type: 'text/plain' })]));
    await waitFor(() => expect(result.current.files[0].status).toBe('error'));
    expect(result.current.files[0].error).toBe('weird.txt isn’t a file VinaX AI can read.');
    expect(result.current.busy).toBe(false);
  });
});
