/**
 * 12.2 — optional Google sign-in. Listening never needs it.
 *
 * Web: Google's own sign-in button (its script, loaded only when a sign-in
 * button is on screen) hands back an ID token. Android: the native sign-in
 * sheet (@capgo/capacitor-social-login, Credential Manager) does the same.
 * Either way the token goes to POST /api/auth/google, which checks it with
 * Google and answers with VinaX's own session. Nothing else about the account
 * is read on the device.
 */
import { KEYS } from '@/constants/storage-keys';
import { getLocal, removeLocal, setLocal } from '@/services/storage/local';
import { isNativePlatform } from '@/services/native';

/** The project's public web OAuth client id (not a secret). */
export const GOOGLE_WEB_CLIENT_ID = '152181244509-biv1p3bge1endo5pd8qpc1ormhb4a75l.apps.googleusercontent.com';
const ORIGIN = isNativePlatform() ? 'https://www.sirimillavinay.online' : '';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

export interface AccountUser {
  name: string | null;
  email: string | null;
  picture: string | null;
  username: string | null;
}
export interface Account {
  session: string;
  user: AccountUser;
}

const listeners = new Set<(a: Account | null) => void>();

/** The signed-in account on this device, or null. */
export function currentAccount(): Account | null {
  const a = getLocal<Account | null>(KEYS.account, null);
  return a && typeof a.session === 'string' && a.session.startsWith('vx1.') && a.user ? a : null;
}

export function onAccountChange(cb: (a: Account | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setAccount(a: Account | null): void {
  if (a) setLocal(KEYS.account, a);
  else removeLocal(KEYS.account);
  for (const cb of listeners) cb(a);
}

export type SignInResult = 'ok' | 'cancelled' | 'refused' | 'offline' | 'unavailable';

/** Trade a Google ID token for a VinaX session. */
export async function exchangeGoogleToken(credential: string, fetchImpl: typeof fetch = fetch): Promise<SignInResult> {
  try {
    const res = await fetchImpl(`${ORIGIN}/api/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential, signed_device_id: getLocal<string>(KEYS.signedDeviceId, '') || undefined }),
    });
    if (res.status === 401) return 'refused';
    if (!res.ok) return 'unavailable';
    const j = (await res.json()) as { session?: unknown; user?: AccountUser };
    if (typeof j.session !== 'string' || !j.user) return 'unavailable';
    setAccount({ session: j.session, user: j.user });
    if (j.user.username) setLocal(KEYS.userHandle, j.user.username);
    if (j.user.name && !getLocal<string>(KEYS.userName, '')) setLocal(KEYS.userName, j.user.name);
    return 'ok';
  } catch {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
  }
}

// ------------------------------------------------------------------ Android

let nativeReady: Promise<unknown> | null = null;

/** Android: the native Google sheet. */
export async function signInNative(): Promise<SignInResult> {
  try {
    const { SocialLogin } = await import('@capgo/capacitor-social-login');
    if (!nativeReady) nativeReady = SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
    await nativeReady;
    // No `scopes` here, deliberately: the plugin's defaults already cover
    // openid + email + profile, and on Android passing ANY scopes makes it
    // reject before the Google sheet even opens ("You CANNOT use scopes
    // without modifying the main activity") because our MainActivity is a
    // plain BridgeActivity. That rejection was every tap's silent death.
    const res = await SocialLogin.login({ provider: 'google', options: {} });
    const r = res.result as { idToken?: string | null };
    if (!r?.idToken) return 'cancelled';
    return await exchangeGoogleToken(r.idToken);
  } catch (e) {
    const msg = String(e);
    if (/cancel/i.test(msg)) return 'cancelled';
    void import('@/services/analytics/telemetry').then((m) => m.reportError('auth-native', msg.slice(0, 200))).catch(() => undefined);
    return 'unavailable';
  }
}

// ------------------------------------------------------------------ web

interface Gis {
  accounts: { id: { initialize(o: Record<string, unknown>): void; renderButton(el: HTMLElement, o: Record<string, unknown>): void; disableAutoSelect(): void } };
}
let gisLoad: Promise<Gis | null> | null = null;

function loadGis(): Promise<Gis | null> {
  const g = (window as unknown as { google?: Gis }).google;
  if (g?.accounts?.id) return Promise.resolve(g);
  if (!gisLoad) {
    gisLoad = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve((window as unknown as { google?: Gis }).google ?? null);
      s.onerror = () => {
        gisLoad = null;
        resolve(null);
      };
      document.head.appendChild(s);
    });
  }
  return gisLoad;
}

/** Web: draw Google's sign-in button into `el`; `done` gets the outcome. False when it could not load. */
export async function renderGoogleButton(el: HTMLElement, done: (r: SignInResult) => void, theme: 'dark' | 'light' = 'dark'): Promise<boolean> {
  const gis = await loadGis();
  if (!gis || !el.isConnected) return false;
  gis.accounts.id.initialize({
    client_id: GOOGLE_WEB_CLIENT_ID,
    callback: (r: { credential?: string }) => {
      if (!r?.credential) return done('cancelled');
      void exchangeGoogleToken(r.credential).then(done);
    },
    ux_mode: 'popup',
    use_fedcm_for_prompt: true,
  });
  gis.accounts.id.renderButton(el, { type: 'standard', theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: Math.min(360, el.clientWidth || 320) });
  return true;
}

// ------------------------------------------------------------------ account

/** Sign out on this device (the session simply stops being sent). */
export function signOut(): void {
  const g = (window as unknown as { google?: Gis }).google;
  try {
    g?.accounts?.id?.disableAutoSelect();
  } catch {
    /* not loaded */
  }
  if (isNativePlatform()) void import('@capgo/capacitor-social-login').then(({ SocialLogin }) => SocialLogin.logout({ provider: 'google' })).catch(() => undefined);
  setAccount(null);
}

/** 13.0 — ask the server whether the session still stands; a definite "no" (401) signs out.
 *  Offline or a server hiccup keeps the listener signed in. */
export async function validateSession(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const a = currentAccount();
  if (!a) return false;
  try {
    const res = await fetchImpl(`${ORIGIN}/api/auth/me`, { headers: { authorization: `Bearer ${a.session}` }, cache: 'no-store' });
    if (res.status === 401) {
      signOut();
      return false;
    }
    if (res.ok) {
      const j = (await res.json()) as { user?: AccountUser };
      if (j.user) setAccount({ session: a.session, user: { ...a.user, ...j.user, picture: j.user.picture ?? a.user.picture } });
    }
  } catch {
    /* offline: keep the session */
  }
  return true;
}

/** Delete the account on the server (Google id, email, name, picture), then sign out. */
export async function deleteAccount(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const a = currentAccount();
  if (!a) return true;
  try {
    const res = await fetchImpl(`${ORIGIN}/api/auth/me`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.session}` }, body: JSON.stringify({ delete: true }) });
    if (!res.ok && res.status !== 401) return false;
  } catch {
    return false;
  }
  signOut();
  return true;
}
