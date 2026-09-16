import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME } from '@/services/recommendation/homeDesign';
import { composeHomeLayout, ownerLayout } from './homeLayout';

const ALL = DEFAULT_HOME.order;

describe('composeHomeLayout', () => {
  it('missing configuration → default order, nothing hidden', () => {
    const c = composeHomeLayout(null, undefined);
    expect(c.source).toBe('default');
    expect(c.visible).toEqual(ALL);
    expect(c.ownerHidden).toEqual([]);
    expect(c.design.title).toBe(DEFAULT_HOME.title);
  });

  it('an empty or malformed owner payload counts as missing', () => {
    expect(ownerLayout({})).toBeNull();
    expect(ownerLayout({ order: [], hidden: [], title: '' })).toBeNull();
    expect(ownerLayout('nope')).toBeNull();
    expect(composeHomeLayout(null, { order: ['bogus'] }).source).toBe('default');
  });

  it('the experiment default order is honoured when nobody customised', () => {
    const swapped = ALL.map((k) => (k === 'personal' ? 'discovery' : k === 'discovery' ? 'personal' : k));
    const c = composeHomeLayout(null, null, swapped);
    expect(c.visible).toEqual(swapped);
  });

  it('owner layout applies when the listener has none: order, text and disabled shelves', () => {
    const c = composeHomeLayout(null, { title: 'Festival week', description: 'd', order: ['charts', 'quick'], hidden: ['moods', 'albums'] });
    expect(c.source).toBe('owner');
    expect(c.design.title).toBe('Festival week');
    expect(c.visible.slice(0, 2)).toEqual(['charts', 'quick']);
    expect(c.visible).not.toContain('moods');
    expect(c.visible).not.toContain('albums');
    expect(c.ownerHidden).toEqual(['moods', 'albums']);
    // Every other shelf still appears (validation appends the missing ones).
    expect(c.visible).toHaveLength(ALL.length - 2);
  });

  it('owner hides only (no order) keeps the default order', () => {
    const c = composeHomeLayout(null, { hidden: ['feed'] });
    expect(c.visible).toEqual(ALL.filter((k) => k !== 'feed'));
  });

  it('listener order wins, but owner-disabled shelves stay disabled', () => {
    const local = { title: 'Mine', description: 'me', order: ['feed', 'moods', 'quick'] as never[], hidden: ['charts'] as never[] };
    const c = composeHomeLayout(local, { order: ['charts', 'personal'], hidden: ['moods'] });
    expect(c.source).toBe('listener');
    expect(c.design.title).toBe('Mine');
    expect(c.visible[0]).toBe('feed');
    expect(c.visible).not.toContain('moods'); // owner-disabled even though the listener listed it
    expect(c.visible).not.toContain('charts'); // listener-hidden
    expect(c.design.hidden).toEqual(['moods', 'charts']);
    expect(c.ownerHidden).toEqual(['moods']);
  });

  it('a newly published owner disable is enforced over an older local layout', () => {
    const local = { ...DEFAULT_HOME, hidden: [] };
    const before = composeHomeLayout(local, { order: [] , hidden: [] });
    expect(before.visible).toContain('artists');
    const after = composeHomeLayout(local, { hidden: ['artists'] });
    expect(after.visible).not.toContain('artists');
    expect(after.source).toBe('listener');
  });

  it('never yields an empty Home: listener hides are dropped if they would hide everything', () => {
    const local = { ...DEFAULT_HOME, hidden: ALL.slice(1) as never[] };
    const c = composeHomeLayout(local, { hidden: ['quick'] });
    expect(c.visible.length).toBeGreaterThan(0);
    expect(c.visible).not.toContain('quick');
  });
});
