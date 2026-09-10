// @vitest-environment jsdom
/**
 * The public VinaX CLI documentation route.
 *
 * Locks the contract the docs page is supposed to keep: it is reachable at
 * exactly /VinaXAI/cli/docs, it is lazy (so it costs the player shell
 * nothing), it covers the subjects a user needs, it carries its own SEO head,
 * and it is usable by keyboard and by a screen reader.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Repo-relative read: import.meta.url is not a file URL under the vite transform. */
const repoFile = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
import { MemoryRouter } from 'react-router-dom';
import CliDocsPage from './CliDocsPage';
import { DOC_SECTIONS, docGroups } from '@/features/cli/docsContent';

const ENGINES = {
  engines: [
    { id: 'auto', label: 'VinaX AUTO', hint: 'Picks the seat from the task', acceptsModel: false, available: true },
    { id: 'menu', label: 'VinaX Menu', hint: 'Free-model marketplace', acceptsModel: true, available: true },
    { id: 'power', label: 'VinaX Power', hint: 'Premium backstop', acceptsModel: false, available: false },
  ],
};

beforeEach(() => {
  // jsdom has no IntersectionObserver; the scroll-spy must not need one to render.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    },
  );
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ENGINES }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/VinaXAI/cli/docs']}>
      <CliDocsPage />
    </MemoryRouter>,
  );

describe('the CLI documentation page', () => {
  it('renders with a single top-level heading', () => {
    renderPage();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('VinaX CLI');
  });

  it('gives every section a heading with a matching anchor id', () => {
    const { container } = renderPage();
    for (const section of DOC_SECTIONS) {
      const el = container.querySelector(`#${section.id}`);
      expect(el, `${section.id} should exist`).not.toBeNull();
      expect(within(el as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(section.title);
    }
  });

  it('documents installation', () => {
    const { container } = renderPage();
    const install = container.querySelector('#installation') as HTMLElement;
    expect(install.textContent).toContain('npm install -g vinax-cli');
    expect(install.textContent).toContain('vinax doctor');
  });

  it('documents the requirements, including that no provider key is needed', () => {
    const { container } = renderPage();
    expect((container.querySelector('#requirements') as HTMLElement).textContent).toContain('Node.js 22');
    expect((container.querySelector('#requirements') as HTMLElement).textContent).toContain('No AI provider keys');
  });

  it('documents all three permission modes and what full-auto still refuses', () => {
    const { container } = renderPage();
    const perms = (container.querySelector('#permission-modes') as HTMLElement).textContent ?? '';
    expect(perms).toContain('ask');
    expect(perms).toContain('auto-edit');
    expect(perms).toContain('full-auto');
    expect(perms).toContain('not unrestricted control');
    expect(perms).toContain('Privilege escalation');
    expect(perms).toContain('credential stores');
  });

  it('documents Git, commits and pushes', () => {
    const { container } = renderPage();
    expect((container.querySelector('#git') as HTMLElement).textContent).toContain('never asks for a Git password');
    expect((container.querySelector('#commits') as HTMLElement).textContent).toContain('--no-verify');
    const pushes = (container.querySelector('#pushes') as HTMLElement).textContent ?? '';
    expect(pushes).toContain('Remote');
    expect(pushes).toContain('will not force it through');
  });

  it('documents security and privacy', () => {
    const { container } = renderPage();
    const security = (container.querySelector('#security') as HTMLElement).textContent ?? '';
    expect(security).toContain('Workspace boundaries');
    expect(security).toContain('Credential files');
    expect(security).toContain('never executed twice');
    const privacy = (container.querySelector('#privacy') as HTMLElement).textContent ?? '';
    expect(privacy).toContain('Sessions are stored locally');
    expect(privacy).toContain('no AI provider credentials');
  });

  it('documents non-interactive use, JSON output and every exit code', () => {
    const { container } = renderPage();
    expect((container.querySelector('#non-interactive') as HTMLElement).textContent).toContain('does not hang');
    expect((container.querySelector('#json-output') as HTMLElement).textContent).toContain('vinax-cli-json/1');
    const exits = (container.querySelector('#exit-codes') as HTMLElement).textContent ?? '';
    for (const code of ['0', '2', '3', '4', '5', '130']) expect(exits).toContain(code);
  });

  it('documents project instructions and that they cannot widen access', () => {
    const { container } = renderPage();
    const text = (container.querySelector('#project-instructions') as HTMLElement).textContent ?? '';
    expect(text).toContain('VINAX.md');
    expect(text).toContain('cannot relax');
  });

  it('documents configuration precedence and refuses project escalation', () => {
    const { container } = renderPage();
    const text = (container.querySelector('#configuration') as HTMLElement).textContent ?? '';
    expect(text).toContain('most important first');
    expect(text).toContain('never make VinaX more permissive');
  });

  it('documents sessions, compaction, undo, slash commands, @file and MCP', () => {
    const { container } = renderPage();
    for (const id of ['sessions', 'context', 'undo', 'slash-commands', 'file-references', 'mcp']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
    expect((container.querySelector('#mcp') as HTMLElement).textContent).toContain('same permission system');
  });

  it('carries a complete command reference', () => {
    const { container } = renderPage();
    const ref = (container.querySelector('#command-reference') as HTMLElement).textContent ?? '';
    for (const cmd of ['vinax models', 'vinax sessions', 'vinax doctor', 'vinax mcp', '--approval', '--add-dir', '--json']) {
      expect(ref, cmd).toContain(cmd);
    }
  });

  it('offers a copy button for every command example', () => {
    renderPage();
    const buttons = screen.getAllByRole('button', { name: /copy to clipboard/i });
    const codeBlocks = DOC_SECTIONS.flatMap((s) => s.blocks).filter((b) => b.kind === 'code');
    expect(buttons.length).toBe(codeBlocks.length);
  });

  it('shows the LIVE engine list rather than a hard-coded one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('menu')).toBeInTheDocument());
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText(/not configured right now/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/vinaxcli/meta', expect.anything());
  });

  it('says so honestly when the engine list cannot be loaded, instead of inventing one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not be loaded right now/)).toBeInTheDocument());
  });

  it('hard-codes no engine count that would drift', () => {
    const source = repoFile('src/features/cli/docsContent.ts');
    expect(source).not.toMatch(/\b(19|18|17|16)\s+engines\b/i);
  });
});

describe('navigation and accessibility', () => {
  it('has a labelled contents navigation covering every section', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: /documentation contents/i });
    for (const section of DOC_SECTIONS) {
      expect(within(nav).getByRole('link', { name: section.title })).toBeInTheDocument();
    }
  });

  it('groups the contents the same way the page is ordered', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: /documentation contents/i });
    // A group name can also be a section title ("Security"), so assert presence
    // rather than uniqueness.
    for (const g of docGroups()) expect(within(nav).getAllByText(g.group).length).toBeGreaterThan(0);
  });

  it('offers a skip link and a main landmark', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /skip to documentation/i })).toHaveAttribute('href', '#cli-docs-main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'cli-docs-main');
  });

  it('has a mobile contents toggle that reports its own state', () => {
    renderPage();
    const toggle = screen.getByRole('button', { name: /contents/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'cli-docs-nav');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('every contents link is a real anchor, so it works without JavaScript', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: /documentation contents/i });
    for (const section of DOC_SECTIONS) {
      expect(within(nav).getByRole('link', { name: section.title })).toHaveAttribute('href', `#${section.id}`);
    }
  });

  it('links back to VinaX AI and to the music app', () => {
    renderPage();
    expect(screen.getAllByRole('link', { name: 'VinaX AI' })[0]).toHaveAttribute('href', '/VinaXAI');
    expect(screen.getAllByRole('link', { name: 'Music' })[0]).toHaveAttribute('href', '/');
  });

  it('uses design-system tokens, so it themes with the rest of VinaX', () => {
    const { container } = renderPage();
    const html = container.innerHTML;
    expect(html).toContain('bg-ink-950');
    expect(html).toContain('text-ink-100');
    expect(html).toContain('border-glass');
    // No hard-coded hex colours that would ignore the theme.
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe('SEO and routing contract', () => {
  it('sets the title, description and canonical for the route', async () => {
    renderPage();
    await waitFor(() => expect(document.title).toBe('VinaX CLI Documentation · VinaX'));
    const desc = document.head.querySelector('meta[name="description"]');
    expect(desc?.getAttribute('content')).toContain('Install and use VinaX CLI');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.sirimillavinay.online/VinaXAI/cli/docs',
    );
  });

  it('is registered at exactly /VinaXAI/cli/docs and is lazily loaded', () => {
    const router = repoFile('src/router/index.tsx');
    expect(router).toContain("path: '/VinaXAI/cli/docs'");
    expect(router).toContain("lazy(() => import('@/pages/CliDocsPage'))");
    // Lazy means it must never be a static import in the router.
    expect(router).not.toContain("import CliDocsPage from");
  });

  it('is prerendered, so a direct request and a refresh both serve real content', () => {
    const prerender = repoFile('scripts/prerender.mjs');
    expect(prerender).toContain("p: '/VinaXAI/cli/docs'");
    expect(prerender).toContain('VinaX CLI Documentation');
    expect(prerender).toContain('Install and use VinaX CLI');
  });

  it('is reachable from the VinaX AI surface', () => {
    const ai = repoFile('src/pages/VinaXAIPage.tsx');
    expect(ai).toContain('/VinaXAI/cli/docs');
  });

  it('needs no Worker route: the Pages fallback already serves it', () => {
    const redirects = repoFile('public/_redirects');
    expect(redirects).toContain('/*    /index.html   200');
  });

  it('names no third-party AI product anywhere in the documentation', () => {
    const source = repoFile('src/features/cli/docsContent.ts');
    for (const brand of ['OpenAI', 'ChatGPT', 'Claude', 'Anthropic', 'Gemini', 'Copilot', 'Cursor', 'Codex', 'Groq', 'NVIDIA', 'OpenRouter', 'GitHub', 'Spotify']) {
      expect(source, brand).not.toContain(brand);
    }
  });
});
