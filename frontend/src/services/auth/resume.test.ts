import { describe, expect, it } from 'vitest';
import { safeNext } from './next';
import { keepResume, takeResume } from './resume';

describe('keepResume / takeResume', () => {
  it('gives the action back once, for the same page', () => {
    const run = () => undefined;
    keepResume('/explore', run);
    expect(takeResume('/explore')).toBe(run);
    expect(takeResume('/explore')).toBeNull();
  });

  it('drops it for another page or after 20 minutes', () => {
    keepResume('/explore', () => undefined);
    expect(takeResume('/library')).toBeNull();
    expect(takeResume('/explore')).toBeNull();
    keepResume('/explore', () => undefined);
    expect(takeResume('/explore', Date.now() + 21 * 60_000)).toBeNull();
  });

  it('matches the next a sign-in page reads for home', () => {
    const run = () => undefined;
    keepResume('/', run);
    expect(takeResume(safeNext(null))).toBe(run);
  });
});
