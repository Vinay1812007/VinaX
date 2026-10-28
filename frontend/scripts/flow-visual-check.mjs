/* global localStorage, document, innerWidth, URL */
import { build } from 'esbuild';
const compiled = await build({entryPoints:['src/constants/changelog.ts'],bundle:true,write:false,format:'esm',platform:'neutral',logLevel:'silent'});
const { latestNotesFingerprint } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const base = process.env.FLOW_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_PATH ? {executablePath: process.env.E2E_CHROMIUM_PATH} : {}), args: ['--no-sandbox'] });
await mkdir('test-results/flow', { recursive: true });
const errors = [];
const songs = Array.from({length: 8}, (_, i) => ({kind:'song',id:`flow-${i}`,title:['Naa Favourite Melody','Evening in Hyderabad','A New Beginning'][i%3],subtitle:'VinaX Test Artist',artists:[{id:'flow-artist',name:'VinaX Test Artist'}],album:{id:'flow-album',name:'Evening melodies'},images:[{quality:'500x500',url:base+'/icons/icon.svg'}],audio:[{quality:'160kbps',url:base+'/fixture.mp4'}],duration:240,language:'telugu',year:'2026',explicit:false,hasLyrics:false,playCount:100}));
const catalog = songs.map(song => ({...song, name:song.title, artists:{primary:song.artists}, image:song.images, downloadUrl:song.audio}));
try {
  for (const [label, width, height, theme] of [['desktop',1440,1000,'dark'],['mobile',390,844,'dark'],['tablet-light',820,1180,'light'],['large-contrast',1920,1080,'dark'],['mobile-amoled',390,844,'amoled']]) {
    const context = await browser.newContext({viewport:{width,height}, reducedMotion:'reduce'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname.startsWith('/api/cat/search/songs')) return route.fulfill({json:{data:{results:catalog}}});
      if (url.pathname === '/api/cat/search') return route.fulfill({json:{data:{songs:{results:catalog},albums:{results:[]},artists:{results:[]},playlists:{results:[]}}}});
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:{}});
      return route.continue();
    });
    await context.addInitScript(({theme,songs,fingerprint,label}) => {
      localStorage.setItem('vinax.last-seen-version', JSON.stringify(fingerprint));
      localStorage.setItem('vinax.onboarded.v1','true');
      localStorage.setItem('vinax.user-handle',JSON.stringify('flow_test'));
      localStorage.setItem('vinax.user-name',JSON.stringify('Vinay'));
      localStorage.setItem('vinax.settings.v1',JSON.stringify({state:{theme,highContrast:label === 'large-contrast',accent:'crimson',reduceMotion:true,festivalSkins:false,pinnedLanguages:['telugu','hindi','tamil']},version:3}));
      localStorage.setItem('vinax.player.v1',JSON.stringify({state:{queue:songs,index:0,repeat:'off',shuffle:false,volume:.5,muted:true,rate:1},version:1}));
      localStorage.setItem('vinax.library.v1',JSON.stringify({state:{favorites:songs.slice(0,3),saved:[],collections:[],later:[],trash:[],hiddenArtists:[],hiddenSongIds:[]},version:0}));
      localStorage.setItem('vinax.history.v1',JSON.stringify({state:{entries:songs.map(song=>({song,ts:Date.now(),completed:true}))},version:0}));
    }, {theme,songs,label,fingerprint:latestNotesFingerprint()});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    for (const route of ['/', '/search', '/library', '/discover', '/settings', '/queue', '/now-playing']) {
      await page.goto(base+route);
      await page.locator('#main-content').waitFor();
      await page.locator(route === '/' ? '.vx-home' : route === '/search' ? '.search-experience' : route === '/now-playing' ? '.vx-now-playing' : '#main-content h1').first().waitFor();
      const dismiss = page.getByRole('button', {name: 'Nice — let’s go'});
      if (await dismiss.isVisible()) await dismiss.click();
      await page.screenshot({path:`test-results/flow/${label}-${route.slice(1)||'home'}.png`});
      if(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push(`${label} ${route}: document overflow`);
      if(width<768 && route !== '/now-playing' && await page.locator('.vx-dock a').count() !== 5) errors.push(`${label}: dock must have five destinations`);
    }
    console.log(`PASS ${label}: seven populated routes rendered`);
    await context.close();
  }
} finally { await browser.close(); }
if(errors.length) { console.error(errors.join('\n')); process.exitCode=1; }
