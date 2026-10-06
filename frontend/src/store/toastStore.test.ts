// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, useToastStore } from './toastStore';

afterEach(() => {
  vi.useRealTimers();
  useToastStore.setState({ toasts: [] });
});

describe('keyed snackbars (10.1)', () => {
  it('liking the playing song shows ONE snackbar: the re-plan note replaces the like, keeping its cover and View', () => {
    vi.useFakeTimers();
    const view = { label: 'View', onClick: () => undefined };
    toast('Added to Liked songs', { key: 'like', image: 'cover.jpg', action: view });
    toast('Liked — more like this is coming up next', { key: 'like' });
    const shown = useToastStore.getState().toasts;
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ message: 'Liked — more like this is coming up next', image: 'cover.jpg', action: view });
  });

  it('different keys and unkeyed toasts still stack (up to the cap)', () => {
    vi.useFakeTimers();
    toast('Added to queue', { key: 'queue' });
    toast('Added to Liked songs', { key: 'like' });
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['Added to queue', 'Added to Liked songs']);
  });
});
