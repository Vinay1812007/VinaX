// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';
import { closeTopOverlay } from '@/hooks/useDismissOnBack';

afterEach(cleanup);

function Harness({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="page">
      <button onClick={() => setOpen(true)}>Open sheet</button>
      {open && (
        <Sheet
          labelledBy="sheet-title"
          onClose={() => {
            setOpen(false);
            onClosed?.();
          }}
        >
          <h2 id="sheet-title">Sleep timer</h2>
          <button>First</button>
          <button>Last</button>
        </Sheet>
      )}
    </div>
  );
}

describe('Sheet', () => {
  it('portals into <body>, outside the page that rendered it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open sheet'));
    const dialog = screen.getByRole('dialog');
    expect(screen.getByTestId('page').contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('carries dialog semantics and its accessible name', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open sheet'));
    const dialog = screen.getByRole('dialog', { name: 'Sleep timer' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('sheet-title');
    expect(dialog.hasAttribute('aria-label')).toBe(false);
  });

  it('falls back to aria-label when there is no heading to point at', () => {
    render(<Sheet label="Notifications" onClose={() => {}}><button>Ok</button></Sheet>);
    expect(screen.getByRole('dialog', { name: 'Notifications' }).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('moves focus in, closes on Escape and returns focus to the opener', () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    const opener = screen.getByText('Open sheet');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText('First'));

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab at both ends and recaptures focus that escaped the dialog', () => {
    render(<Harness />);
    const opener = screen.getByText('Open sheet');
    fireEvent.click(opener);
    const first = screen.getByText('First');
    const last = screen.getByText('Last');

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    opener.focus();
    fireEvent.keyDown(opener, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('closes on a backdrop click but not on a click inside the panel', () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    fireEvent.click(screen.getByText('Open sheet'));
    fireEvent.click(screen.getByText('Sleep timer'));
    expect(onClosed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('honours closeOnBackdrop={false}', () => {
    const onClose = vi.fn();
    render(<Sheet label="Update" closeOnBackdrop={false} onClose={onClose}><button>Ok</button></Sheet>);
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('registers with the hardware-back stack while open', () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    expect(closeTopOverlay()).toBe(false);
    fireEvent.click(screen.getByText('Open sheet'));
    let consumed = false;
    act(() => {
      consumed = closeTopOverlay();
    });
    expect(consumed).toBe(true);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open — ref-counted across stacked sheets', () => {
    document.body.style.overflow = '';
    const a = render(<Sheet label="A" onClose={() => {}}><button>A</button></Sheet>);
    const b = render(<Sheet label="B" onClose={() => {}}><button>B</button></Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    a.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    b.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('renders nothing while open={false}', () => {
    render(<Sheet open={false} label="Closed" onClose={() => {}}><button>x</button></Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
