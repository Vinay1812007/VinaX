/**
 * VinaX AI files (phase 4) in a real browser against the built app, with
 * /api/ai/* answered by the test: an image is shrunk on the device and
 * uploaded, a PDF is read by pdf.js (its worker loads under the app's CSP)
 * and its text sent, files go with the message and show in it, a model
 * that cannot see is caught before sending, files can be dropped on the
 * page, and the tray passes an accessibility scan.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './support/test';
import { latestNotesFingerprint } from '../src/constants/changelog';

const C1 = '0b6c2f6e-1c1e-4b51-9a57-3d1f3e2a9b10';
const MODEL = { id: 'groq:openai/gpt-oss-120b', name: 'GPT-OSS 120B', provider: 'Groq' };
const MODELS = {
  enabled: true, configured: true, search: false, groups: ['balanced', 'vision'],
  models: [
    { ...MODEL, group: 'balanced', description: '', flags: { vision: false, web: false, thinking: true, code: false }, available: true },
    { id: 'nvidia:vl', name: 'Nemotron 3.5 Super VL', provider: 'NVIDIA', group: 'vision', description: '', flags: { vision: true, web: false, thinking: true, code: false }, available: true },
  ],
};
const sse = (events: Array<[string, unknown]>): string => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

/** A one-page PDF with real text (correct xref offsets). */
function makePdf(text: string): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '', // contents, below
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A 2400×1200 PNG drawn in the page (so the browser has to shrink it). */
async function bigPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400; c.height = 1200;
    const x = c.getContext('2d')!;
    x.fillStyle = '#c00'; x.fillRect(0, 0, 2400, 1200);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

interface Server { uploads: Array<{ name: string; type: string; bytes: Buffer }>; patches: Array<Record<string, unknown>>; posted: Array<Record<string, unknown>>; deleted: string[] }

async function setup(page: Page): Promise<Server> {
  const server: Server = { uploads: [], patches: [], posted: [], deleted: [] };
  await page.addInitScript((fp) => {
    localStorage.setItem('vinax.settings.v1', JSON.stringify({ state: { theme: 'dark', pinnedLanguages: ['telugu'] }, version: 5 }));
    localStorage.setItem('vinax.onboarded.v1', 'true');
    localStorage.setItem('vinax.analytics-consent', 'false');
    localStorage.setItem('vinax.last-seen-version', JSON.stringify(fp));
  }, latestNotesFingerprint());
  await page.route('**/*', async (route) => {
    const r = route.request();
    const url = new URL(r.url());
    if (!url.origin.startsWith('http://localhost')) return route.abort();
    if (url.pathname === '/api/appconfig' && url.searchParams.get('key') === 'festival') return route.fulfill({ json: { festival: { mode: 'off' } } });
    if (url.pathname === '/api/ai/models') return route.fulfill({ json: MODELS });
    if (url.pathname === '/api/ai/conversations') return route.fulfill({ json: { items: [], nextCursor: null } });
    if (url.pathname === '/api/ai/attachments' && r.method() === 'POST') {
      const bytes = r.postDataBuffer() ?? Buffer.alloc(0);
      const name = url.searchParams.get('name') ?? 'file';
      const type = r.headers()['content-type'];
      server.uploads.push({ name, type, bytes });
      const kind = type.startsWith('image/') ? 'image' : type === 'application/pdf' ? 'pdf' : 'text';
      return route.fulfill({ json: { id: `att-${server.uploads.length}`, name, mime: type, size: bytes.length, kind } });
    }
    const m = /^\/api\/ai\/attachments\/([^/]+)$/.exec(url.pathname);
    if (m && r.method() === 'PATCH') { server.patches.push(r.postDataJSON() as Record<string, unknown>); return route.fulfill({ json: { ok: true } }); }
    if (m && r.method() === 'DELETE') { server.deleted.push(m[1]); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/ai/chat') {
      server.posted.push(r.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([['meta', { conversationId: C1, userMessageId: 'u1', assistantMessageId: 'a1', model: MODEL }], ['text', { delta: 'Got your files.' }], ['done', { stopReason: 'end' }]]) });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.continue();
  });
  return server;
}

const picker = (page: Page) => page.getByLabel('Choose files to add');

test('an image is shrunk on the device, uploaded, sent with the message and shown in it', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const png = await bigPng(page);
  await picker(page).setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: png });
  const tray = page.getByRole('list', { name: 'Files to send' });
  await expect(tray.getByText('Image')).toBeVisible();
  const up = server.uploads[0];
  expect(['image/webp', 'image/jpeg']).toContain(up.type);
  expect(up.name).toMatch(/^banner\.(webp|jpg)$/);
  expect(up.bytes.length).toBeLessThan(png.length);
  const dims = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/webp;base64,${b64}`)).blob());
    return [bmp.width, bmp.height];
  }, up.bytes.toString('base64'));
  expect(dims).toEqual([1568, 784]);
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('What colour is this?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.vx-ai-md')).toContainText('Got your files.');
  expect(server.posted[0]).toMatchObject({ content: [{ type: 'attachment', id: 'att-1' }, { type: 'text', text: 'What colour is this?' }] });
  await expect(page.getByRole('list', { name: 'Attached files' }).getByRole('img', { name: /banner/ })).toBeVisible();
  await expect(tray).toHaveCount(0);
});

test('a PDF is read on the device: its page count shows and its text goes to the server', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await picker(page).setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: makePdf('Hello from the PDF') });
  await expect(page.getByRole('list', { name: 'Files to send' }).getByText('PDF · 1 page')).toBeVisible();
  expect(server.uploads[0]).toMatchObject({ name: 'paper.pdf', type: 'application/pdf' });
  expect(server.patches[0]).toMatchObject({ pages: 1 });
  expect(String(server.patches[0].text)).toContain('Hello from the PDF');
  await page.getByRole('button', { name: 'Send message' }).click();
  expect(server.posted[0]).toMatchObject({ content: [{ type: 'attachment', id: 'att-1' }] });
});

test('a picked model that cannot see images is caught before sending', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  await page.getByRole('button', { name: 'Model: Auto' }).click();
  await page.getByRole('option', { name: /GPT-OSS 120B/ }).click();
  await picker(page).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: await bigPng(page) });
  const chip = page.getByRole('alert').filter({ hasText: 'can’t see images' });
  await expect(chip).toBeVisible();
  await page.getByRole('textbox', { name: 'Message VinaX AI' }).fill('What is this?');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await chip.getByRole('button', { name: 'Use Auto' }).click();
  await expect(page.getByRole('button', { name: 'Model: Auto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  expect(server.posted).toHaveLength(0);
});

test('files can be dropped on the page and removed from the tray', async ({ page }) => {
  const server = await setup(page);
  await page.goto('/vinaxai');
  const data = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['print("hi")\n'], 'main.py', { type: 'text/x-python' }));
    return dt;
  });
  await page.locator('.vx-ai').dispatchEvent('drop', { dataTransfer: data });
  const tray = page.getByRole('list', { name: 'Files to send' });
  await expect(tray.getByText('main.py')).toBeVisible();
  await expect(tray.getByText('Text')).toBeVisible();
  await tray.getByRole('button', { name: 'Remove main.py' }).click();
  await expect(tray).toHaveCount(0);
  await expect.poll(() => server.deleted).toEqual(['att-1']);
});

test('the file tray and a sent file have no WCAG A/AA violations', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/vinaxai');
  await picker(page).setInputFiles([{ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes') }, { name: 'paper.pdf', mimeType: 'application/pdf', buffer: makePdf('Scan me') }]);
  await expect(page.getByRole('list', { name: 'Files to send' }).getByText('PDF · 1 page')).toBeVisible();
  let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('list', { name: 'Attached files' })).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
});
