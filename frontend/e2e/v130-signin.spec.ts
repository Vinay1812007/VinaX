/**
 * 13.0 — VinaX needs an account. Signed out (?e2e-signed-out keeps the test
 * account away, see support/test.ts), every personal page sends the visitor
 * to the sign-in page (/login?next=…, 1.13.22); the legal pages stay
 * readable. Signed in, the app opens.
 *
 * 1.13.22 — sign-in, sign-up and forgot-password are their own pages
 * (pages/auth): Google's button and the email form on one card, no app
 * navigation and no marketing panels.
 */
import { expect, test, type Page } from './support/test';

const SESSION = { session: 'vx1.e2e.test', user: { name: 'Mail Tester', email: 'mail@example.com', picture: null, username: 'mailtester' } };

/** Answers the email sign-in API like the Worker would (no Resend, no database). */
async function mockEmailApi(page: Page, calls: string[]): Promise<void> {
  await page.route('**/api/auth/email/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body = (r.request().postDataJSON() ?? {}) as Record<string, string>;
    calls.push(path);
    if (path.endsWith('/login')) {
      return body.password === 'right-password'
        ? r.fulfill({ json: SESSION })
        : r.fulfill({ status: 401, json: { error: 'wrong_password' } });
    }
    if (path.endsWith('/code')) return r.fulfill({ json: { ok: true } });
    if (path.endsWith('/verify')) {
      return body.code === '123456' ? r.fulfill({ json: SESSION }) : r.fulfill({ status: 400, json: { error: 'wrong_code', triesLeft: 4 } });
    }
    return r.fulfill({ status: 404, json: {} });
  });
}

test('signed out, every personal page sends you to sign in; the legal pages stay readable', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  // 13.5.0 — published pages (Charts, hubs…) show their own text instead; see below.
  // 13.9 — Search and the song pages open signed out (v139-guest-browse.spec.ts); the personal pages do not (Home opens signed out since 1.11, see v139-guest-browse.spec.ts).
  for (const path of ['/library', '/settings', '/favorites']) {
    await page.goto(`${path}?e2e-signed-out`);
    await expect(page.getByRole('heading', { name: 'Sign in to VinaX', level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
    // No app navigation: only the page's own footer links.
    await expect(page.locator('nav:not(.vx-auth-links)')).toHaveCount(0);
    await expect(page.getByLabel('Email')).toBeVisible();
  }
  await page.goto('/privacy?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Your account and what syncs' })).toBeVisible();
  await page.goto('/terms?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Sign in to VinaX' })).toHaveCount(0);
});

test('1.13.22: the sign-in page is one card with Google and email, and carries no ads', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/login?e2e-signed-out');
  await expect(page.getByRole('heading', { name: 'Sign in to VinaX', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Google sign-in couldn’t load' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
  await expect(page.getByRole('link', { name: /Explore VinaX first/ })).toBeVisible();
  // The old marketing screen is gone.
  for (const name of ['What you get', 'Questions']) await expect(page.getByRole('heading', { name })).toHaveCount(0);
  await expect(page.locator('script[src*="googlesyndication"], ins.adsbygoogle')).toHaveCount(0);
});

test('1.13.22: the three pages link to each other and keep next and the typed email', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/library?e2e-signed-out');
  await page.getByLabel('Email').fill('me@example.com');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password\?next=%2Flibrary.*&email=me%40example.com/);
  await expect(page.getByRole('heading', { name: 'Set a new password', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('me@example.com');
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your VinaX account', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue('me@example.com');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary/);
});

test('1.13.22: a wrong password says so, the right one lands on next', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  const calls: string[] = [];
  await mockEmailApi(page, calls);
  await page.goto('/login?e2e-signed-out&next=%2Ffavorites');
  await page.getByLabel('Email').fill('mail@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'That email and password don’t match' })).toBeVisible();
  await expect(page.getByRole('alert').getByRole('link', { name: 'set a password' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('right-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/favorites$/);
  expect(calls).toEqual(['/api/auth/email/login', '/api/auth/email/login']);
});

test('1.13.22: sign-up is a code, then a password; resend counts down', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  const calls: string[] = [];
  await mockEmailApi(page, calls);
  await page.goto('/signup?e2e-signed-out&next=%2Flibrary');
  await page.getByLabel('Name').fill('Mail Tester');
  await page.getByLabel('Email').fill('mail@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('We sent a 6-digit code to', { exact: false })).toBeVisible();
  await expect(page.getByText('The code sets its password', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Send a new code in \d+ s/ })).toBeDisabled();
  await page.getByLabel('Code from the email').fill('999999');
  await page.getByLabel('Choose a password').fill('a-good-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '4 tries left' })).toBeVisible();
  await page.getByLabel('Code from the email').fill('123456');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect(calls).toEqual(['/api/auth/email/code', '/api/auth/email/verify', '/api/auth/email/verify']);
});

test('1.13.22: play as a guest, sign in with email from the sheet, and the play goes ahead back on the page', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('vinax.account.v1');
      sessionStorage.setItem('vinax.guest-browse', '1');
    } catch {
      /* storage blocked */
    }
  });
  const calls: string[] = [];
  await mockEmailApi(page, calls);
  await page.goto('/discover');
  await page.getByRole('button', { name: /^Play \d{4}$/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Sign in to start listening' });
  await sheet.getByRole('link', { name: 'Sign in with email' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fdiscover$/);
  await expect(page.getByRole('status').filter({ hasText: 'Now playing:' })).toHaveCount(0);
  await page.getByLabel('Email').fill('mail@example.com');
  await page.getByLabel('Password', { exact: true }).fill('right-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/discover$/);
  // The year play the sheet interrupted runs now.
  await expect(page.getByRole('status').filter({ hasText: 'Now playing:' })).toBeVisible();
});

test('1.13.22: next never leaves the site, and a signed-in visit to /login moves on', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/login?e2e-signed-out&next=%2F%2Fevil.example');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  // The test account is signed in on this load.
  await page.goto('/login?next=%2Fsettings');
  await expect(page).toHaveURL(/\/settings$/);
});

test('13.3.0: when Google’s script is blocked, the screen says why and Try again redraws the button', async ({ page }) => {
  let blocked = true;
  await page.route('**/accounts.google.com/**', (r) => (blocked ? r.abort() : r.fulfill({ contentType: 'text/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(el){el.textContent="google-button"},disableAutoSelect(){}}}};' })));
  await page.goto('/library?e2e-signed-out');
  await expect(page.getByRole('alert').filter({ hasText: 'Google sign-in couldn’t load' })).toBeVisible();
  await expect(page.getByText('sign in later in Settings', { exact: false })).toHaveCount(0);
  blocked = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('google-button')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('signed in, the app opens with the account in the top bar', async ({ page }) => {
  await page.goto('/settings');
  // The avatar first, so the app has rendered before the absence check.
  await expect(page.locator('.vx-avatar')).toHaveAttribute('aria-label', /Tester/);
  await expect(page.locator('main.vx-auth')).toHaveCount(0);
});

test('13.4.0: About, Help and Get the app open signed out', async ({ page }) => {
  for (const path of ['/about', '/help', '/download']) {
    await page.goto(`${path}?e2e-signed-out`);
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to VinaX' })).toHaveCount(0);
  }
});

test('13.4.0: the avatar opens profile and app settings, and Sign out signs out', async ({ page }) => {
  // A returning listener: no first-run sheet over the top bar.
  await page.addInitScript(() => {
    if (!localStorage.getItem('vinax.onboarded.v1')) localStorage.setItem('vinax.onboarded.v1', 'true');
  });
  await page.goto('/library');
  // What's new opens once for a version this browser hasn't seen; close it.
  const whatsNew = page.getByRole('button', { name: 'Let’s go' });
  await page.waitForTimeout(1500);
  if (await whatsNew.isVisible()) await whatsNew.click();
  await page.getByRole('button', { name: /profile and settings/ }).click();
  const menu = page.getByRole('menu', { name: 'Profile and settings' });
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Profile settings')).toBeVisible();
  await expect(menu.getByText('App settings')).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Account & sign-in' }).click();
  await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: /profile and settings/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to VinaX' })).toBeVisible();
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('13.5.0: signed out, a published page shows its own text with a sign-in card, and calls no catalogue API', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  const api: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/')) api.push(p);
  });
  for (const [path, h1] of [['/charts/', 'Top Charts'], ['/telugu-songs/', 'Telugu Songs'], ['/privacy/', 'Privacy']] as const) {
    await page.goto(`${path}?e2e-signed-out`);
    await expect(page.getByRole('heading', { name: h1, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Listen free on VinaX' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in to VinaX' })).toHaveCount(0);
    // The page's own links stay crawlable, in the form the host answers with a 200.
    await expect(page.locator('#vx-public-content a[href="/charts/"]').first()).toBeAttached();
  }
  await page.waitForTimeout(500);
  // Only the maintenance switch and the sign-in card's security-check key
  // (GET /api/auth/google, Cloudflare Turnstile) are asked; no catalogue,
  // config or account calls.
  expect(api.filter((p) => p !== '/api/site-mode' && p !== '/api/auth/google')).toEqual([]);
});

test('1.13.22: a published page’s sign-in card links to email sign-in with next', async ({ page }) => {
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await page.goto('/charts/?e2e-signed-out');
  const card = page.locator('#vx-public-signin');
  await expect(card.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', /^\/signup\?next=%2Fcharts/);
  await card.getByRole('link', { name: 'Sign in with email' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to VinaX', level: 1 })).toBeVisible();
});

test('13.5.0: signed in, a published page is the full app page', async ({ page }) => {
  await page.goto('/charts/');
  await expect(page.getByRole('heading', { name: 'Listen free on VinaX' })).toHaveCount(0);
  await expect(page.locator('.vx-topbar')).toBeVisible();
});
