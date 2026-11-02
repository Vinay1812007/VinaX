// @vitest-environment jsdom
/**
 * VinaX AI — the artifacts gallery on the page: cards from the list, the kind
 * chips and the title search sent to the Worker, Load more, and a card opening
 * the artifact panel with its versions and Open chat.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ArtifactsGallery } from './ArtifactsGallery';
import { usePanel } from './artifactStore';
import { chatLink, galleryDate, kindLabel, panelVersions } from './gallery';
import type { GalleryArtifact, GalleryItem } from './types';

const C1 = '11111111-1111-4111-8111-111111111111';
const M1 = '22222222-2222-4222-8222-222222222221';
const M2 = '22222222-2222-4222-8222-222222222222';
const item = (over: Partial<GalleryItem> = {}): GalleryItem => ({
  conversationId: C1, conversationTitle: 'Sorting', artifactId: 'sort', messageId: M2, kind: 'code', title: 'Quick sort',
  language: 'python', incomplete: false, versions: 2, createdAt: '2026-11-01T10:00:00Z', ...over,
});
const ARTIFACT: GalleryArtifact = {
  conversationId: C1, conversationTitle: 'Sorting', artifactId: 'sort',
  versions: [
    { messageId: M1, createdAt: '2026-11-01T09:00:00Z', type: 'code', title: 'Quick sort', language: 'python', content: 'def v1(): pass', incomplete: false },
    { messageId: M2, createdAt: '2026-11-01T10:00:00Z', type: 'code', title: 'Quick sort', language: 'python', content: 'def v2(): pass', incomplete: false },
  ],
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  usePanel.getState().close();
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}{l.search}</p>;
}

function mount(fetchFn: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return fetchFn(url); }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/vinaxai/artifacts']}>
        <Routes>
          <Route path="/vinaxai/artifacts" element={<ArtifactsGallery />} />
          <Route path="/vinaxai/c/:id" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return urls;
}

describe('the gallery helpers', () => {
  it('names kinds, dates and links', () => {
    expect(kindLabel({ kind: 'code', language: 'python' })).toBe('Code · Python');
    expect(kindLabel({ kind: 'code', language: 'sql' })).toBe('Code · SQL');
    expect(kindLabel({ kind: 'code', language: null })).toBe('Code');
    expect(kindLabel({ kind: 'html', language: null })).toBe('HTML page');
    expect(kindLabel({ kind: 'react', language: null })).toBe('React component');
    expect(kindLabel({ kind: 'mermaid', language: null })).toBe('Diagram');
    expect(kindLabel({ kind: 'markdown', language: null })).toBe('Document');
    const now = new Date(2026, 10, 2, 15);
    expect(galleryDate(new Date(2026, 10, 2, 9).toISOString(), now)).toBe('Today');
    expect(galleryDate(new Date(2026, 10, 1, 23).toISOString(), now)).toBe('Yesterday');
    expect(galleryDate('nonsense', now)).toBe('');
    expect(chatLink(C1, M2, 'sort')).toBe(`/vinaxai/c/${C1}?m=${M2}&a=sort`);
    expect(panelVersions(ARTIFACT).map((v) => [v.messageId, v.artifact.id, v.artifact.content])).toEqual([[M1, 'sort', 'def v1(): pass'], [M2, 'sort', 'def v2(): pass']]);
    expect(panelVersions(undefined)).toEqual([]);
  });
});

describe('<ArtifactsGallery />', () => {
  it('lists cards with kind, versions and the chat they came from', async () => {
    mount(() => reply({ items: [item(), item({ artifactId: 'flow', kind: 'mermaid', title: 'Login flow', language: null, versions: 1, conversationTitle: null })], nextCursor: null }));
    const card = await screen.findByRole('button', { name: /Quick sort/ });
    expect(card.textContent).toContain('Code · Python · 2 versions');
    expect(card.textContent).toContain('Sorting');
    expect(screen.getByRole('button', { name: /Login flow/ }).textContent).toContain('Diagram');
    expect(screen.getByRole('button', { name: /Login flow/ }).textContent).toContain('Untitled chat');
    expect(screen.getByRole('heading', { level: 1, name: 'Artifacts' })).toBeTruthy();
  });

  it('sends the kind chip and the title search to the Worker', async () => {
    const urls = mount(() => reply({ items: [], nextCursor: null }));
    await screen.findByText('No artifacts yet');
    fireEvent.click(screen.getByRole('button', { name: 'Diagrams' }));
    await waitFor(() => expect(urls.some((u) => u.includes('/api/ai/artifacts?kind=mermaid'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Diagrams' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search artifacts' }), { target: { value: '  login ' } });
    await waitFor(() => expect(urls.some((u) => u.includes('kind=mermaid&q=login'))).toBe(true));
    expect(await screen.findByText('No artifacts match that.')).toBeTruthy();
  });

  it('Load more asks for the next page with the cursor', async () => {
    const urls = mount((url) => (url.includes('cursor=') ? reply({ items: [item({ artifactId: 'older', title: 'Older one' })], nextCursor: null }) : reply({ items: [item()], nextCursor: 'CURSOR~x' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('button', { name: /Older one/ })).toBeTruthy();
    expect(urls.some((u) => u.includes('cursor=CURSOR%7Ex'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('a card opens the panel on the newest version; versions step; Open chat goes to that reply', async () => {
    const urls = mount((url) => (url.includes(`/api/ai/artifacts/${C1}/sort`) ? reply({ artifact: ARTIFACT }) : reply({ items: [item()], nextCursor: null })));
    fireEvent.click(await screen.findByRole('button', { name: /Quick sort/ }));
    expect(await screen.findByText('v2 of 2')).toBeTruthy();
    const sheet = screen.getByRole('dialog', { name: 'Artifact: Quick sort' });
    expect(sheet.textContent).toContain('def v2(): pass');
    expect(sheet.textContent).toContain('Sorting');
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(screen.getByText('v1 of 2')).toBeTruthy();
    expect(screen.getByRole('dialog').textContent).toContain('def v1(): pass');
    expect(urls.filter((u) => u.includes(`/api/ai/artifacts/${C1}/sort`))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
    expect((await screen.findByTestId('where')).textContent).toBe(`/vinaxai/c/${C1}?m=${M1}&a=sort`);
  });

  it('closing the panel hands focus back to the card; a gone artifact says so', async () => {
    mount((url) => (url.includes('/api/ai/artifacts/') ? reply({ error: 'not_found' }, 404) : reply({ items: [item()], nextCursor: null })));
    const card = await screen.findByRole('button', { name: /Quick sort/ });
    fireEvent.click(card);
    expect(await screen.findByText(/isn’t available any more/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close the artifact' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Quick sort/ }));
  });

  it('a list that fails offers Try again', async () => {
    mount(() => reply({ error: 'unavailable' }, 503));
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load your artifacts.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
