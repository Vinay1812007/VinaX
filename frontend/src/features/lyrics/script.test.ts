import { expect, it } from 'vitest';
import { hasIndicScript } from './script';

it('spots Indian scripts and Urdu, not English letters', () => {
  expect(hasIndicScript(['நான் பாக்குறேன்'])).toBe(true);
  expect(hasIndicScript(['Pehle bhi', 'पहले भी'])).toBe(true);
  expect(hasIndicScript(['دل'])).toBe(true);
  expect(hasIndicScript(['Naan paakkuren paakkuren', ''])).toBe(false);
  expect(hasIndicScript([])).toBe(false);
});
