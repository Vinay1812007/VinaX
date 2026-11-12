// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInNewTab, SANDBOX_ORIGIN } from './RunnerFrame';

vi.mock('@/store/toastStore', () => ({ toast: vi.fn() }));
import { toast } from '@/store/toastStore';

afterEach(() => vi.restoreAllMocks());

describe('Open in new tab', () => {
  it('opens the sandbox and sends the artifact only after that tab says it is ready', () => {
    const tab = { postMessage: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(tab);
    openInNewTab('html', '<p>Hi</p>', 'Page');
    expect(window.open).toHaveBeenCalledWith(`${SANDBOX_ORIGIN}/`, '_blank');
    // Someone else's message changes nothing.
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'vinax-runner', type: 'ready' }, source: window }));
    expect(tab.postMessage).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'vinax-runner', type: 'ready' }, source: tab as unknown as MessageEventSource }));
    expect(tab.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'render', kind: 'html', content: '<p>Hi</p>', title: 'Page' }), SANDBOX_ORIGIN);
    // Once only.
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'vinax-runner', type: 'ready' }, source: tab as unknown as MessageEventSource }));
    expect(tab.postMessage).toHaveBeenCalledTimes(1);
  });

  it('says how to allow it when the browser blocks the new tab', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    openInNewTab('react', 'x', 'App');
    expect(toast).toHaveBeenCalledWith('Allow pop-ups for VinaX to open it in a new tab');
  });
});
