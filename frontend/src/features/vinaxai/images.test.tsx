// @vitest-environment jsdom
/**
 * VinaX AI — Create image: the + menu entry and the composer's image mode,
 * the store's request and its saved turn, the picture in the reply (open
 * full size, download), and the listener's words for each refusal.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from './Composer';
import { AssistantMessage } from './Message';
import { chatReducer, initialChat, isImageReply, LOCAL_REPLY } from './chatState';
import { createImage, IMAGE_REQUEST_PREFIX, resetChat, stopReply, useChatStore } from './store';
import { imageNotice } from './api';
import type { ChatMessage, ServerMessage } from './types';

const user: ServerMessage = { id: 'u1', parentId: null, role: 'user', content: [{ type: 'text', text: 'Create an image: a red fox' }], thinking: null, thinkingMs: null, model: null, stopReason: null, createdAt: '2026-11-17T10:00:00.000Z' };
const reply: ServerMessage = {
  id: 'a1', parentId: 'u1', role: 'assistant', thinking: null, thinkingMs: null, stopReason: 'end', createdAt: '2026-11-17T10:00:00.001Z',
  content: [{ type: 'text', text: 'Here’s your image.' }, { type: 'attachment', id: 'f1', name: 'a-red-fox.jpg', kind: 'image', mime: 'image/jpeg', size: 1234 }],
  model: { id: 'cloudflare:@cf/black-forest-labs/flux-1-schnell', name: 'FLUX.1 schnell', provider: 'Cloudflare' },
};
const conversation = { id: 'c1', title: 'a red fox', starred: false, activeLeafId: 'a1', createdAt: 'x', updatedAt: 'x' };

beforeEach(() => resetChat());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the composer', () => {
  const props = { value: '', onChange: vi.fn(), onSend: vi.fn(), onStop: vi.fn(), streaming: false };

  it('offers Create image in the + menu only when it is on', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Composer {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.queryByRole('menuitem', { name: /Create image/ })).toBeNull();
    rerender(<Composer {...props} image={{ on: false, maxPrompt: 1000, onChange }} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /Create image/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('in image mode asks for a description, sends it as a picture and can be left', () => {
    const onChange = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(<Composer {...props} onSend={onSend} onLive={vi.fn()} image={{ on: true, maxPrompt: 10, onChange }} />);
    const box = screen.getByRole('textbox', { name: 'Describe the image you want' });
    expect(box.getAttribute('maxlength')).toBe('10');
    // No Live voice button in its place: Send stays, held until there is a description.
    expect(screen.getByRole('button', { name: 'Create image' })).toHaveProperty('disabled', true);
    rerender(<Composer {...props} value="a fox" onSend={onSend} onLive={vi.fn()} sendBlocked image={{ on: true, maxPrompt: 10, onChange }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create image' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop creating an image' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('the chat state', () => {
  it('shows a placeholder, then the saved turn in place of the local pair', () => {
    let s = chatReducer(initialChat(), { type: 'send', text: `${IMAGE_REQUEST_PREFIX}a red fox`, parentId: null, now: 'n', image: true });
    expect(s.messages[LOCAL_REPLY]).toMatchObject({ imaging: true });
    expect(isImageReply(s.messages[LOCAL_REPLY])).toBe(true);
    s = chatReducer(s, { type: 'image-done', conversation, user, reply });
    expect(s).toMatchObject({ conversationId: 'c1', title: 'a red fox', leafId: 'a1', streaming: false, replyId: null });
    expect(Object.keys(s.messages).sort()).toEqual(['a1', 'u1']);
    expect(s.messages.a1.files).toEqual([{ id: 'f1', name: 'a-red-fox.jpg', kind: 'image', mime: 'image/jpeg', size: 1234 }]);
    expect(isImageReply(s.messages.a1)).toBe(true);
    expect(isImageReply({ role: 'user', files: s.messages.a1.files })).toBe(false);
  });
});

describe('createImage', () => {
  it('posts the prompt and keeps the saved turn', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ conversation, userMessage: user, assistantMessage: reply }), { status: 200 });
    }));
    await expect(createImage('  a red fox ')).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ url: '/api/ai/images', body: { prompt: 'a red fox', conversationId: null } }]);
    expect(useChatStore.getState()).toMatchObject({ conversationId: 'c1', leafId: 'a1', streaming: false });
  });

  it('a refusal removes the turn, hands the text back and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'image_daily_limit', limit: 10 }), { status: 429 })));
    await expect(createImage('a fox', { perDay: 10 })).resolves.toEqual({ ok: false, code: 'image_daily_limit', beforeStart: true });
    const s = useChatStore.getState();
    expect(Object.keys(s.messages)).toEqual([]);
    expect(s.notice?.message).toBe('You’ve made today’s 10 images. Try again tomorrow.');
  });

  it('Stop drops the placeholder at once', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError'))))));
    const pending = createImage('a fox');
    expect(useChatStore.getState().streaming).toBe(true);
    stopReply();
    await expect(pending).resolves.toEqual({ ok: false, code: 'aborted', beforeStart: true });
    expect(useChatStore.getState()).toMatchObject({ streaming: false, messages: {} });
  });

  it('an answer that is not a saved turn is a failed image, not a broken chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(createImage('a fox')).resolves.toEqual({ ok: false, code: 'image_failed', beforeStart: true });
    expect(useChatStore.getState()).toMatchObject({ streaming: false, messages: {} });
    expect(useChatStore.getState().notice?.message).toBe('The image didn’t come out. Try again.');
  });

  it('Stop while the answer is still being read drops the placeholder too', async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: () => new Promise((resolve) => { release = () => resolve({ conversation, userMessage: user, assistantMessage: reply }); }),
    })));
    const pending = createImage('a fox');
    await waitFor(() => expect(release).toBeDefined());
    stopReply();
    release?.();
    await expect(pending).resolves.toEqual({ ok: false, code: 'aborted', beforeStart: true });
    expect(useChatStore.getState()).toMatchObject({ streaming: false, messages: {}, conversationId: null });
  });

  it('does nothing for an empty prompt', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(createImage('   ')).resolves.toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the reply', () => {
  it('shows the picture with Open full size and Download, and no Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { status: 200 })));
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fox');
    onTestFinished(() => { URL.createObjectURL = original; });
    useChatStore.setState({ messages: { u1: { id: 'u1', parentId: null, role: 'user', text: 'Create an image: a red fox', thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: 'x' } } });
    const message: ChatMessage = { id: 'a1', parentId: 'u1', role: 'assistant', text: 'Here’s your image.', files: [{ id: 'f1', name: 'a-red-fox.jpg', kind: 'image', mime: 'image/jpeg', size: 3 }], thinking: '', thinkingMs: null, model: reply.model, stopReason: 'end', error: null, createdAt: 'x' };
    render(<AssistantMessage message={message} live={false} models={[]} onRetry={vi.fn()} canReadAloud />);
    await waitFor(() => expect(screen.getByRole('link', { name: /Download/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /Download/ }).getAttribute('download')).toBe('a-red-fox.jpg');
    expect(screen.getByRole('link', { name: /Open full size/ }).getAttribute('href')).toBe('blob:fox');
    expect(screen.getByRole('img', { name: 'Image: a red fox' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull();
  });

  it('shows Creating image… while it is made', () => {
    const message: ChatMessage = { id: LOCAL_REPLY, parentId: 'local-user', role: 'assistant', text: '', imaging: true, thinking: '', thinkingMs: null, model: null, stopReason: null, error: null, createdAt: 'x', local: true };
    render(<AssistantMessage message={message} live models={[]} />);
    expect(screen.getByRole('status').textContent).toBe('Creating image…');
    expect(screen.queryByText(/Thinking/)).toBeNull();
  });
});

describe('the words', () => {
  it('says plainly what went wrong', () => {
    expect(imageNotice('images_busy')).toBe('Image making is used up for today. Try again tomorrow.');
    expect(imageNotice('prompt_refused')).toBe('VinaX AI can’t make that image. Try describing something else.');
    expect(imageNotice('image_daily_limit')).toBe('You’ve made all your images for today. Try again tomorrow.');
    expect(imageNotice('signed_out')).toBe('Your sign-in has expired. Sign in again to keep chatting.');
  });
});
