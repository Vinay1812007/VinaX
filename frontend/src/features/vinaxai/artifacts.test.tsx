// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { artifactsOf, codeLanguage, collectVersions, downloadName, hasPreview, parseArtifacts } from './artifacts';
import { ArtifactCard, ArtifactPanel } from './ArtifactPanel';
import { usePanel } from './artifactStore';
import { READY_MS } from './RunnerFrame';
import type { ChatMessage } from './types';

afterEach(cleanup);

const reply = (id: string, text: string): ChatMessage => ({ id, parentId: null, role: 'assistant', text, thinking: '', thinkingMs: null, model: null, stopReason: 'end', error: null, createdAt: id });

describe('artifacts on the page', () => {
  it('parses like the server: unclosed artifacts close at the end; tags in code stay code', () => {
    expect(artifactsOf('<artifact id="a" type="react" title="Counter">export default () => null')[0]).toMatchObject({ id: 'a', type: 'react', incomplete: true });
    expect(parseArtifacts('```\n<artifact id="x" type="html">\n```')).toHaveLength(1);
  });

  it('collects versions by id across the replies, oldest first', () => {
    const v = collectVersions([
      reply('m1', '<artifact id="page" type="html" title="Page">v1</artifact>'),
      { ...reply('u', 'make it blue'), role: 'user' },
      reply('m2', 'Updated. <artifact id="page" type="html" title="Page">v2</artifact> <artifact id="notes" type="markdown" title="Notes">x</artifact>'),
    ]);
    expect(v.get('page')!.map((x) => [x.messageId, x.artifact.content])).toEqual([['m1', 'v1'], ['m2', 'v2']]);
    expect(v.get('notes')).toHaveLength(1);
  });

  it('names downloads and picks a highlighter by type', () => {
    expect(downloadName({ id: 'x', type: 'code', title: 'Fizz Buzz!', language: 'python' })).toEqual({ name: 'fizz-buzz.py', mime: 'text/plain' });
    expect(downloadName({ id: 'x', type: 'react', title: 'Counter', language: null })).toEqual({ name: 'counter.jsx', mime: 'text/javascript' });
    expect(downloadName({ id: 'x', type: 'html', title: '', language: null }).name).toBe('x.html');
    expect(codeLanguage({ type: 'react', language: null })).toBe('javascript');
    expect(hasPreview('code')).toBe(false);
    expect(hasPreview('markdown')).toBe(true);
  });
});

describe('<ArtifactCard />', () => {
  it('says Creating… while it is written, and shows its version', () => {
    const onOpen = vi.fn();
    const a = artifactsOf('<artifact id="p" type="html" title="Landing page">x')[0];
    const { rerender } = render(<ArtifactCard artifact={a} version={1} live onOpen={onOpen} />);
    expect(screen.getByRole('button').textContent).toContain('Creating Landing page…');
    rerender(<ArtifactCard artifact={{ ...a, incomplete: false }} version={2} live={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^Landing page.*v2.*Open$/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('<ArtifactPanel />', () => {
  const versions = [
    { messageId: 'm1', artifact: artifactsOf('<artifact id="page" type="html" title="Page"><h1>One</h1></artifact>')[0] },
    { messageId: 'm2', artifact: artifactsOf('<artifact id="page" type="html" title="Page"><h1>Two</h1></artifact>')[0] },
  ];
  beforeEach(() => usePanel.setState({ open: { id: 'page', version: null }, tab: 'code', following: false, width: 48 }));

  it('shows the newest version, steps through versions, and switches Preview / Code', () => {
    render(<ArtifactPanel versions={versions} live={false} sheet={false} />);
    expect(screen.getByText('v2 of 2')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Artifact: Page' }).textContent).toContain('<h1>Two</h1>');
    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(screen.getByText('v1 of 2')).toBeTruthy();
    expect(screen.getByRole('complementary').textContent).toContain('<h1>One</h1>');
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByTitle('Preview: Page').getAttribute('sandbox')).toBe('allow-scripts allow-modals');
    expect(screen.getByTitle('Preview: Page').getAttribute('src')).toBe('https://sandbox.vinaxmusic.online/');
  });

  it('without the sandbox site, Preview says so after a wait', () => {
    vi.useFakeTimers();
    usePanel.setState({ tab: 'preview' });
    render(<ArtifactPanel versions={versions} live={false} sheet={false} />);
    act(() => { vi.advanceTimersByTime(READY_MS + 10); });
    expect(screen.getByRole('status').textContent).toContain('Preview needs the sandbox host');
    vi.useRealTimers();
  });

  it('while it is written: Code only, no Download, "writing…"', () => {
    const live = [{ messageId: 'm3', artifact: artifactsOf('<artifact id="page" type="html" title="Page"><h1>Th')[0] }];
    usePanel.setState({ tab: 'preview' });
    render(<ArtifactPanel versions={live} live sheet={false} />);
    expect(screen.getByText(/writing…/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Download artifact' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('complementary').textContent).toContain('<h1>Th');
  });

  it('the resize handle keeps the panel between 40% and 60%', () => {
    render(<ArtifactPanel versions={versions} live={false} sheet={false} />);
    const sep = screen.getByRole('separator', { name: 'Resize the artifact panel' });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(usePanel.getState().width).toBe(60);
    for (let i = 0; i < 20; i++) fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(usePanel.getState().width).toBe(40);
  });

  it('on a phone it is a full-screen sheet that Escape closes', () => {
    render(<ArtifactPanel versions={versions} live={false} sheet />);
    const sheet = screen.getByRole('dialog', { name: 'Artifact: Page' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(usePanel.getState().open).toBeNull();
  });
});
