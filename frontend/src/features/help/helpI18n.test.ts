import { describe, expect, it } from 'vitest';
import { FAQ, GUIDES, SHORTCUTS } from './helpContent';
import { helpUi, loadHelpTranslation, localFaq, localGuide, localShortcut, localStep, localTour } from './helpI18n';
import { TUTORIALS } from '@/features/tutorials/tutorials';
import { HELP_UI_KEYS, type HelpTranslation } from '@/i18n/help/types';
import TE from '@/i18n/help/te';
import HI from '@/i18n/help/hi';
import TA from '@/i18n/help/ta';

/**
 * The Telugu, Hindi and Tamil Help files must cover every guide, question,
 * group, shortcut and tour step English has, one for one, so a listener never
 * reads half a guide in one language and half in another, and a renamed or
 * removed English entry cannot leave a stale translation behind.
 */
const LANGS: Array<[string, HelpTranslation]> = [['te', TE], ['hi', HI], ['ta', TA]];
const sorted = (xs: Iterable<string>): string[] => [...xs].sort();
const placeholders = (s: string): string[] => sorted(s.match(/\{\w+\}/g) ?? []);

describe('English help ids', () => {
  it('every guide, question and tour has a unique id', () => {
    for (const ids of [GUIDES.map((g) => g.id), FAQ.map((f) => f.id), TUTORIALS.map((t) => t.id)]) {
      expect(ids.every((id) => /^[a-z0-9-]+$/.test(id)), ids.join()).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe.each(LANGS)('%s help translation', (_lang, tr) => {
  it('has every guide, step for step, and nothing English no longer has', () => {
    expect(sorted(Object.keys(tr.guides))).toEqual(sorted(GUIDES.map((g) => g.id)));
    for (const g of GUIDES) {
      const t = tr.guides[g.id];
      expect(t.title.trim(), g.id).not.toBe('');
      expect(t.steps.length, `${g.id} steps`).toBe(g.steps.length);
      for (const s of t.steps) expect(s.trim(), g.id).not.toBe('');
    }
  });

  it('has every guide group and every question', () => {
    expect(sorted(Object.keys(tr.groups))).toEqual(sorted(new Set(GUIDES.map((g) => g.group))));
    expect(sorted(Object.keys(tr.faq))).toEqual(sorted(FAQ.map((f) => f.id)));
    for (const f of FAQ) {
      expect(tr.faq[f.id].q.trim(), f.id).not.toBe('');
      expect(tr.faq[f.id].a.trim(), f.id).not.toBe('');
    }
  });

  it('has every shortcut description', () => {
    expect(sorted(Object.keys(tr.shortcuts))).toEqual(sorted(new Set(SHORTCUTS.map(([, v]) => v))));
  });

  it('has every tour, step for step, with a tip where English has one', () => {
    expect(sorted(Object.keys(tr.tutorials))).toEqual(sorted(TUTORIALS.map((t) => t.id)));
    for (const t of TUTORIALS) {
      const l = tr.tutorials[t.id];
      expect(l.title.trim() && l.blurb.trim(), t.id).toBeTruthy();
      expect(!!l.needs, `${t.id} needs`).toBe(!!t.needs);
      expect(l.steps.length, `${t.id} steps`).toBe(t.steps.length);
      t.steps.forEach((s, i) => {
        const ls = l.steps[i];
        expect(ls.title.trim() && ls.body.trim(), `${t.id} #${i + 1}`).toBeTruthy();
        expect(!!ls.tip, `${t.id} #${i + 1} tip`).toBe(!!s.tip);
        expect(`${ls.title} ${ls.body} ${ls.tip ?? ''}`, `${t.id} #${i + 1}`).not.toContain('!');
      });
    }
  });

  it('has every page and card word, with the same placeholders', () => {
    expect(sorted(Object.keys(tr.ui))).toEqual(sorted(HELP_UI_KEYS));
    for (const k of HELP_UI_KEYS) {
      expect(tr.ui[k].trim(), k).not.toBe('');
      expect(placeholders(tr.ui[k]), k).toEqual(placeholders(k));
    }
  });

  it('keeps VinaX, Listen Together and Flow in English', () => {
    const pairs: Array<[string, string]> = [
      ...GUIDES.flatMap((g) => [[g.title, tr.guides[g.id].title], ...g.steps.map((s, i) => [s, tr.guides[g.id].steps[i]])] as Array<[string, string]>),
      ...FAQ.flatMap((f) => [[f.q, tr.faq[f.id].q], [f.a, tr.faq[f.id].a]] as Array<[string, string]>),
      ...TUTORIALS.flatMap((t) => [
        [t.title, tr.tutorials[t.id].title], [t.blurb, tr.tutorials[t.id].blurb],
        ...t.steps.flatMap((s, i) => [[s.title, tr.tutorials[t.id].steps[i].title], [s.body, tr.tutorials[t.id].steps[i].body]]),
      ] as Array<[string, string]>),
      ...HELP_UI_KEYS.map((k) => [k, tr.ui[k]] as [string, string]),
    ];
    for (const [en, local] of pairs) {
      for (const name of ['VinaX', 'Listen Together', 'Flow']) {
        if (new RegExp(`\\b${name}\\b`).test(en)) expect(local, `${name} in “${en.slice(0, 50)}…”`).toContain(name);
      }
    }
  });
});

describe('help translation helpers', () => {
  const tour = { id: 'x', title: 'Tour', blurb: 'Blurb', steps: [{ title: 'One', body: 'First.', tip: 'Tip.' }, { title: 'Two', body: 'Second.' }] };
  const tr = {
    ...TE,
    groups: { G: 'జి' },
    guides: { a: { title: 'ఏ', steps: ['ఒకటి', 'రెండు'] }, b: { title: 'బి', steps: ['ఒకటి'] } },
    faq: { q1: { q: 'ప్ర', a: 'జ' } },
    shortcuts: { 'Play / pause': 'ప్లే / పాజ్' },
    tutorials: { x: { title: 'టూర్', blurb: 'వివరం', needs: 'ముందు రూమ్', steps: [{ title: 'ఒకటి', body: 'మొదటిది.', tip: 'చిట్కా.' }, { title: 'రెండు', body: 'రెండోది.' }] } },
  } satisfies HelpTranslation;

  it('swaps a guide only when its steps line up, and keeps the id', () => {
    expect(localGuide({ id: 'a', group: 'G', title: 'A', steps: ['1', '2'] }, tr)).toEqual({ id: 'a', group: 'జి', title: 'ఏ', steps: ['ఒకటి', 'రెండు'] });
    // English grew a step: the whole guide stays English (the group name still translates).
    expect(localGuide({ id: 'b', group: 'G', title: 'B', steps: ['1', '2'] }, tr)).toEqual({ id: 'b', group: 'జి', title: 'B', steps: ['1', '2'] });
    const en = { id: 'c', group: 'H', title: 'C', steps: ['1'] };
    expect(localGuide(en, tr)).toBe(en);
    expect(localGuide(en, null)).toBe(en);
  });

  it('falls back to English for a question, a shortcut or a language with no file', () => {
    expect(localFaq({ id: 'q1', q: 'Q', a: 'A' }, tr)).toEqual({ id: 'q1', q: 'ప్ర', a: 'జ' });
    expect(localFaq({ id: 'nope', q: 'Q', a: 'A' }, tr)).toEqual({ id: 'nope', q: 'Q', a: 'A' });
    expect(localShortcut('Play / pause', tr)).toBe('ప్లే / పాజ్');
    expect(localShortcut('Mute / unmute', tr)).toBe('Mute / unmute');
    expect(localShortcut('Play / pause', null)).toBe('Play / pause');
  });

  it('translates a tour step’s words only, and only while the steps line up', () => {
    expect(localTour(tour, tr)).toEqual({ title: 'టూర్', blurb: 'వివరం', needs: null });
    expect(localTour(tour, tr, 'Start a room first.').needs).toBe('ముందు రూమ్');
    expect(localTour(tour, null, 'Start a room first.')).toEqual({ title: 'Tour', blurb: 'Blurb', needs: 'Start a room first.' });
    expect(localStep(tour, 0, tr)).toEqual({ title: 'ఒకటి', body: 'మొదటిది.', tip: 'చిట్కా.' });
    expect(localStep(tour, 1, tr)).toEqual({ title: 'రెండు', body: 'రెండోది.', tip: undefined });
    const longer = { ...tour, steps: [...tour.steps, { title: 'Three', body: 'Third.' }] };
    expect(localStep(longer, 0, tr)).toEqual({ title: 'One', body: 'First.', tip: 'Tip.' });
    expect(localStep(tour, 0, null)).toEqual({ title: 'One', body: 'First.', tip: 'Tip.' });
  });

  it('fills placeholders and falls back to the English words', () => {
    expect(helpUi(tr)('{done} of {total} done', { done: 2, total: 7 })).toBe('7లో 2 పూర్తి');
    expect(helpUi(null)('{done} of {total} done', { done: 2, total: 7 })).toBe('2 of 7 done');
    expect(helpUi(null)('Next')).toBe('Next');
  });

  it('loads a language’s file once and never for English', async () => {
    expect(await loadHelpTranslation('en')).toBeNull();
    const a = await loadHelpTranslation('hi');
    expect(a?.ui.Next).toBe(HI.ui.Next);
    expect(await loadHelpTranslation('hi')).toBe(a);
  });
});
