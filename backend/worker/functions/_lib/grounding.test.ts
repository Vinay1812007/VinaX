/** 8.5.0 — the DJ's spoken lines keep to what the pool says. */
import { describe, expect, it } from 'vitest';
import { buildFacts, groundedLine } from './grounding';
import { parsePicks } from '../api/dj';

const POOL = [
  { id: 'p1', title: 'Samajavaragamana', artist: 'Sid Sriram', album: 'Ala Vaikunthapurramuloo', year: '2020', language: 'telugu' },
  { id: 'p2', title: 'Butta Bomma', artist: 'Armaan Malik', album: 'Ala Vaikunthapurramuloo', year: '2020', language: 'telugu' },
  { id: 'p3', title: 'Kaathalae Kaathalae', artist: 'Chinmayi', album: '96', year: '2018', language: 'tamil' },
  { id: 'p4', title: 'Roja Jaaneman', artist: 'A. R. Rahman', album: 'Roja', year: '1992', language: 'tamil' },
];
const facts = buildFacts(POOL.flatMap((p) => [p.title, p.artist, p.album, p.year, p.language]));

describe('groundedLine keeps what the pool backs', () => {
  it.each([
    'Here’s Samajavaragamana by Sid Sriram, a warm Telugu melody to settle in.',
    'Keeping the groove going with Butta Bomma.',
    'Sid Sriram’s voice glides in over soft strings.',
    'From the 96 album, Chinmayi slows everything down.',
    'Now a 1992 gem from A. R. Rahman: Roja Jaaneman.',
    'Easing into something gentler for the late hours.',
    'Let’s lift the tempo a notch. Here comes Butta Bomma!',
    'Straight into The groove of Roja Jaaneman.',
  ])('keeps: %s', (line) => {
    expect(groundedLine(line, facts)).toBe(line);
  });
});

describe('groundedLine drops what it cannot back', () => {
  it.each([
    ['an award', 'Sid Sriram’s National Award-winning voice opens the set.'],
    ['a chart claim', 'The chart-topping Butta Bomma, straight after.'],
    ['a stream count', 'Butta Bomma crossed a billion views, and here it is.'],
    ['box office', 'From the blockbuster Ala Vaikunthapurramuloo.'],
    ['a biography', 'Chinmayi, who was born in Chennai, takes it from here.'],
    ['a year not in the pool', 'A 2016 favourite from Sid Sriram.'],
    ['a name not in the pool', 'Composed by Thaman, Samajavaragamana floats in.'],
    ['a made-up collaborator', 'Armaan Malik teams up with Shreya Ghoshal on this one.'],
  ])('drops %s', (_what, line) => {
    expect(groundedLine(line, facts)).toBe('');
  });

  it('empty in, empty out', () => {
    expect(groundedLine('   ', facts)).toBe('');
  });
});

describe('parsePicks applies it to the intro, reasons and segues', () => {
  it('keeps the picks, removes only the ungrounded lines', () => {
    const content = JSON.stringify({
      intro: 'Tonight’s set opens with a chart-topper that won everything.',
      songs: [
        { songId: 'p1', title: 'Samajavaragamana', artist: 'Sid Sriram', reason: 'same warm Telugu vocals', segue: 'Here’s Samajavaragamana by Sid Sriram.' },
        { songId: 'p2', title: 'Butta Bomma', artist: 'Armaan Malik', reason: 'a 2015 superhit', segue: 'Armaan Malik won hearts with this one in 2019.' },
      ],
    });
    const out = parsePicks(content, POOL, 5);
    expect(out.intro).toBe('');
    expect(out.songs.map((s) => s.songId)).toEqual(['p1', 'p2']);
    expect(out.songs[0]).toMatchObject({ reason: 'same warm Telugu vocals', segue: 'Here’s Samajavaragamana by Sid Sriram.' });
    expect(out.songs[1]).toMatchObject({ reason: '', segue: '' });
  });

  it('a discovery may name itself in its own lines', () => {
    const content = JSON.stringify({ songs: [{ title: 'Inkem Inkem', artist: 'Sid Sriram', reason: 'fresh pick, same voice', segue: 'Something new: Inkem Inkem.', fromPool: false }] });
    const out = parsePicks(content, POOL, 5, 2);
    expect(out.songs[0]).toMatchObject({ songId: null, fromPool: false, segue: 'Something new: Inkem Inkem.' });
  });
});

describe('/api/ai/dj', () => {
  it('routes to the DJ handler: POST-only, GET answers 405', async () => {
    const { default: worker } = await import('../../index');
    const ctx = { waitUntil: () => undefined };
    const get = await worker.fetch(new Request('https://vinax.test/api/ai/dj'), {}, ctx);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toContain('POST');
    // No AI key configured → the DJ's own honest 503 (or 400 for the empty body), never the SPA shell.
    const post = await worker.fetch(new Request('https://vinax.test/api/ai/dj', { method: 'POST', headers: { 'cf-connecting-ip': '10.9.0.1' }, body: '{}' }), {}, ctx);
    expect([400, 503]).toContain(post.status);
    expect(post.headers.get('content-type')).toContain('application/json');
  });
});
