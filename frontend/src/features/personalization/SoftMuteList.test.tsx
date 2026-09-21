// @vitest-environment jsdom
/**
 * The Settings view of "Less like this": every muted artist is named with the
 * date it ends, each Unmute button says whose it is, unmuting moves focus to
 * the next row instead of dropping it, and the toast puts the mute back.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/storage/idb', () => ({ addEvent: vi.fn(async () => undefined), clearEvents: vi.fn(async () => undefined) }));

import { useToastStore } from '@/store/toastStore';
import { clearSoftMutes, listSoftMutes, muteArtist } from '@/services/personalization/softMutes';
import { makeSong } from '@/__fixtures__/songs';
import { SoftMuteList } from './SoftMuteList';

const sid = makeSong('s1', { artist: 'సిద్ శ్రీరామ్' });
const arijit = makeSong('s2', { artist: 'अरिजीत सिंह', language: 'hindi' });
const anirudh = makeSong('s3', { artist: 'அனிருத் ரவிச்சந்தர்', language: 'tamil' });

beforeEach(() => {
  localStorage.clear();
  clearSoftMutes();
  useToastStore.setState({ toasts: [] });
});
afterEach(cleanup);

const unmuteButtons = () => screen.getAllByRole('button', { name: /^Unmute (?!all\b)/ });

describe('<SoftMuteList />', () => {
  it('says what is muted and for how much longer, in the artist’s own script', () => {
    muteArtist(sid, 7);
    render(<SoftMuteList />);
    // The name is on the row and inside the button's accessible name.
    expect(screen.getAllByText('సిద్ శ్రీరామ్').length).toBeGreaterThan(0);
    expect(screen.getByText(/Back on .* · 7 days left/)).toBeTruthy();
    expect(unmuteButtons()[0].textContent).toBe('Unmute సిద్ శ్రీరామ్');
  });

  it('unmuting moves focus to the next row and offers an Undo that puts it back', () => {
    muteArtist(sid, 7);
    muteArtist(arijit, 14);
    muteArtist(anirudh, 30);
    render(<SoftMuteList />);
    expect(unmuteButtons()).toHaveLength(3);

    const first = unmuteButtons()[0];
    first.focus();
    fireEvent.click(first);
    expect(listSoftMutes().map((m) => m.name)).toEqual(['अरिजीत सिंह', 'அனிருத் ரவிச்சந்தர்']);
    // Focus did not fall to the body when the row it was on disappeared.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unmute अरिजीत सिंह' }));

    const toasts = useToastStore.getState().toasts;
    const toast = toasts[toasts.length - 1];
    expect(toast.message).toBe('సిద్ శ్రీరామ్ is back in your recommendations');
    toast.action!.onClick();
    expect(listSoftMutes()).toHaveLength(3);
  });

  it('"Unmute all" appears only with more than one, clears them and can be undone', () => {
    muteArtist(sid, 7);
    const { rerender } = render(<SoftMuteList />);
    expect(screen.queryByRole('button', { name: 'Unmute all' })).toBeNull();
    muteArtist(arijit, 14);
    rerender(<SoftMuteList />);
    fireEvent.click(screen.getByRole('button', { name: 'Unmute all' }));
    expect(listSoftMutes()).toEqual([]);
    expect(screen.getByText(/Nothing muted right now/)).toBeTruthy();
    const toasts = useToastStore.getState().toasts;
    toasts[toasts.length - 1].action!.onClick();
    expect(listSoftMutes()).toHaveLength(2);
  });

  it('says how to mute an artist when nothing is muted', () => {
    render(<SoftMuteList />);
    expect(screen.getByText(/Less like this/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
