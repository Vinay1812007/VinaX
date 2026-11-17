// @vitest-environment jsdom
/**
 * 1.16 — Downloads in the web app: a browser that can save says how (not "get
 * the Android app"), real sizes and the browser's used space show, Remove all
 * clears everything after a confirm, and an iPhone outside the Home Screen is
 * told why it should add VinaX there.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  canSave: true,
  ios: false,
  standalone: false,
  info: null as { usage: number; quota: number } | null,
  removeDownload: vi.fn<(id: string) => Promise<void>>(),
}));
vi.mock('@/services/audio/engine', () => ({
  audioEngine: { load: vi.fn(), preloadNext: vi.fn(), pause: vi.fn(), play: vi.fn(), seek: vi.fn(), fadeIn: vi.fn(), fadeOut: vi.fn() },
  orderedSources: () => [],
}));
vi.mock('@/services/native', () => ({ checkNotificationOnFirstPlay: vi.fn(), haptic: vi.fn(), isNativePlatform: () => false, platformName: () => 'web' }));
vi.mock('@/utils/platform', () => ({ iosWeb: () => h.ios, standaloneWeb: () => h.standalone }));
vi.mock('@/services/downloads', () => ({ canSaveOffline: () => h.canSave, removeDownload: h.removeDownload }));
vi.mock('@/services/downloads/web', () => ({ storageInfo: () => Promise.resolve(h.info), WARN_BYTES: 1024 * 1024 * 1024 }));
vi.mock('@/components/VirtualChunks', () => ({
  VirtualChunks: ({ items, renderItem }: { items: unknown[]; renderItem: (x: unknown, i: number) => React.ReactNode }) => <>{items.map((x, i) => <div key={i}>{renderItem(x, i)}</div>)}</>,
}));

import { useDownloadsStore } from '@/store/downloadsStore';
import { makeSong } from '@/__fixtures__/songs';
import OfflinePage from './OfflinePage';

const MB = 1024 * 1024;
const renderPage = () =>
  render(
    <MemoryRouter>
      <OfflinePage />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.canSave = true;
  h.ios = false;
  h.standalone = false;
  h.info = null;
  h.removeDownload.mockReset().mockImplementation((id) => {
    const items = { ...useDownloadsStore.getState().items };
    delete items[id];
    useDownloadsStore.setState({ items });
    return Promise.resolve();
  });
  useDownloadsStore.setState({ items: {}, downloading: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const save = (id: string, bytes?: number) => {
  const song = makeSong(id, { title: `Song ${id}` });
  useDownloadsStore.setState((s) => ({ items: { ...s.items, [id]: { song, addedAt: Date.now(), ...(bytes ? { bytes } : {}) } } }));
};

describe('OfflinePage on the web', () => {
  it('tells a browser that can save how to save, not to get the Android app', () => {
    renderPage();
    expect(screen.getByText(/choose Download to save it for offline listening/)).toBeTruthy();
    expect(screen.queryByText('Get the app')).toBeNull();
  });

  it('still points a browser that cannot save to the Android app', () => {
    h.canSave = false;
    renderPage();
    expect(screen.getByText(/This browser can’t save songs/)).toBeTruthy();
    expect(screen.getByText('Get the app')).toBeTruthy();
  });

  it('shows real sizes and what the browser stores', async () => {
    h.info = { usage: 30 * MB, quota: 1000 * MB };
    save('a', 10 * MB);
    save('b', 15 * MB);
    renderPage();
    expect(screen.getByText('25 MB on this device')).toBeTruthy();
    expect(await screen.findByText('30 MB used · 970 MB free for VinaX')).toBeTruthy();
    expect(screen.queryByText(/over 1 GB/)).toBeNull();
  });

  it('warns once saved songs pass 1 GB', async () => {
    h.info = { usage: 1100 * MB, quota: 4000 * MB };
    save('a', 1100 * MB);
    renderPage();
    expect(await screen.findByText(/Saved songs use over 1 GB/)).toBeTruthy();
  });

  it('Remove all clears every download after a confirm', async () => {
    save('a', MB);
    save('b', MB);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(confirm).toHaveBeenCalledWith('Remove all 2 downloads from this device?');
    expect(h.removeDownload).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    });
    expect(h.removeDownload.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b']);
    expect(screen.getByText('No downloads yet')).toBeTruthy();
  });

  it('asks an iPhone outside the Home Screen to add VinaX there, and not once it is installed', () => {
    save('a', MB);
    h.ios = true;
    renderPage();
    expect(screen.getByText(/Safari can clear them if VinaX isn’t opened for a week/)).toBeTruthy();
    cleanup();
    h.standalone = true;
    renderPage();
    expect(screen.queryByText(/Safari can clear them/)).toBeNull();
  });
});
