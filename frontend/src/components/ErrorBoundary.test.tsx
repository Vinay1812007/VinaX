// @vitest-environment jsdom
/**
 * A page chunk that went missing after a deploy: the app reloads itself, and
 * Vite resolves the cancelled import with `undefined`, so the lazy page throws
 * "reading 'default'" on the way out. That must not flash an error screen or
 * land in App Errors.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const reportError = vi.fn();
vi.mock('@/services/analytics/telemetry', () => ({ reportError }));

afterEach(() => {
  cleanup();
  vi.resetModules();
  reportError.mockClear();
});

function Broken(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'default')");
}

describe('ErrorBoundary', () => {
  it('shows the error screen and reports a real crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ErrorBoundary } = await import('./ErrorBoundary');
    render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(screen.getByText('Something hit a wrong note')).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith('react', "Cannot read properties of undefined (reading 'default')");
  });

  it('stays blank and quiet while the app reloads itself for a new build', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const { reloadPage } = await import('@/utils/pageReload');
    const { ErrorBoundary } = await import('./ErrorBoundary');
    reloadPage();
    const { container } = render(<ErrorBoundary><Broken /></ErrorBoundary>);
    expect(reload).toHaveBeenCalled();
    expect(container.textContent).toBe('');
    expect(reportError).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1); // no second reload from the boundary
    vi.unstubAllGlobals();
  });
});
