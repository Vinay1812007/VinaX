/* global localStorage, document, innerWidth, URL */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--no-sandbox'] });
await mkdir('test-results/flow', { recursive: true });
const errors = [];
for (const [label, width, height, theme] of [['desktop',1440,1000,'dark'],['mobile',390,844,'dark'],['tablet-light',820,1180,'light'],['mobile-amoled',390,844,'amoled']]) {
  const context = await browser.newContext({viewport:{width,height}, reducedMotion:'reduce'});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5173') return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
    return route.continue();
  });
  await context.addInitScript(({theme}) => {
    localStorage.setItem('vinax.onboarded.v1','true');
    localStorage.setItem('vinax.user-handle',JSON.stringify('flow_test'));
    localStorage.setItem('vinax.user-name',JSON.stringify('Vinay'));
    localStorage.setItem('vinax.settings.v1',JSON.stringify({state:{theme,accent:'crimson',reduceMotion:true,pinnedLanguages:['telugu','hindi','tamil']},version:2}));
  }, {theme});
  const page = await context.newPage();

  page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
  for (const route of ['/', '/search', '/library', '/discover', '/settings', '/queue']) {
    await page.goto('http://127.0.0.1:5173'+route);
    try { await page.locator('#main-content').waitFor(); } catch(e) { console.log(errors, await page.locator('body').innerText()); await page.screenshot({path:'test-results/flow/boot-error.png'}); await browser.close(); throw e; }
    await page.locator(route === '/' ? '.vx-home' : route === '/search' ? '.search-experience' : route === '/queue' ? '#main-content p' : '#main-content h1').first().waitFor();
    const dismiss = page.getByRole('button', {name: 'Nice — let’s go'});
    if (await dismiss.isVisible()) await dismiss.click();
    await page.screenshot({path:`test-results/flow/${label}-${route.slice(1)||'home'}.png`});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if(overflow) errors.push(`${label} ${route}: document overflow`);
    if(width<768 && await page.locator('.vx-dock a').count() !== 5) errors.push(`${label}: dock must have five destinations`);
  }
  console.log(`PASS ${label}: six routes rendered`);
  await context.close();
}
await browser.close();
if(errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
