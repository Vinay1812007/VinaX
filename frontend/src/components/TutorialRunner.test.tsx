// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/router', () => ({ router: { navigate: vi.fn(async () => undefined) } }));
vi.mock('@/features/tutorials/tutorials', () => {
  const T = {
    id: 't', title: 'Test tour', blurb: '', minutes: 1, emoji: '',
    steps: [
      { title: 'One', body: 'First.' },
      { title: 'Gone', body: 'Never shown.', target: '[data-tour="not-there"]' },
      { title: 'Three', body: 'Third.' },
    ],
  };
  return { tutorialById: (id: string | null) => (id === 't' ? T : null) };
});

import TutorialRunner from './TutorialRunner';
import { useTutorialStore } from '@/store/tutorialStore';

const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });

afterEach(() => {
  cleanup();
  act(() => useTutorialStore.getState().stop());
  act(() => useTutorialStore.setState({ done: [] }));
  localStorage.clear();
});

describe('TutorialRunner', () => {
  it('announces the step, moves with the arrow keys and skips a step whose anchor is missing', async () => {
    act(() => useTutorialStore.getState().start('t'));
    render(<TutorialRunner />);
    expect(screen.getByRole('dialog', { name: 'Tutorial: Test tour' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Step 1 of 3. One. First.'));
    key('ArrowLeft'); // no step before the first
    expect(useTutorialStore.getState().step).toBe(0);
    key('ArrowRight');
    // Step 2's anchor is not in the document: the runner moves on by itself.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Step 3 of 3. Three. Third.'), { timeout: 5000 });
    expect(screen.queryByText('Never shown.')).toBeNull();
    key('ArrowLeft'); // going back skips it the other way
    await waitFor(() => expect(useTutorialStore.getState().step).toBe(0), { timeout: 5000 });
  }, 15000);

  it('Enter on Back is Back, Tab stays in the card, Done records the tour', async () => {
    act(() => { useTutorialStore.getState().start('t'); useTutorialStore.getState().go(2); });
    render(<TutorialRunner />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Three'));
    const [close, back, done] = ['Close', 'Back', 'Done'].map((n) => screen.getByRole('button', { name: n }));
    done.focus();
    key('Tab', done);
    expect(document.activeElement).toBe(close);
    key('Tab', close);
    expect(document.activeElement).toBe(back);
    key('Enter', back); // must not be read as "next"
    expect(useTutorialStore.getState().activeId).toBe('t');
    key('Enter', document.body);
    expect(useTutorialStore.getState().activeId).toBeNull();
    expect(useTutorialStore.getState().done).toContain('t');
  });

  it('Escape closes without recording, and focus returns to the opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    act(() => useTutorialStore.getState().start('t'));
    const view = render(<TutorialRunner />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('One'));
    expect(document.activeElement).not.toBe(opener);
    key('Escape');
    expect(useTutorialStore.getState().activeId).toBeNull();
    expect(useTutorialStore.getState().done).not.toContain('t');
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
