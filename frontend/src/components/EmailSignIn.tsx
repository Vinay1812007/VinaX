/**
 * Schema 20 — sign in with an email and a password, create an account with an
 * email address, or set a new password when it is forgotten. Opened from
 * "Continue with email" under the Google button (GoogleSignIn), loaded only
 * then.
 *
 * Creating an account and "Forgot password?" are the same two steps: the
 * address gets a 6-digit code, then the code and a new password sign in. When
 * the address already has an account (a Google one too) the code sets that
 * account's password, so nobody ends up with two accounts.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { emailAuthMessage, MIN_PASSWORD, requestEmailCode, signInWithPassword, verifyEmailCode } from '@/services/auth/email';

type Mode = 'signin' | 'signup' | 'reset';

export default function EmailSignIn({ onSignedIn, onClose }: { onSignedIn: () => void; onClose: () => void }): ReactNode {
  const [mode, setMode] = useState<Mode>('signin');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (m: Mode): void => {
    setMode(m);
    setStep('email');
    setCode('');
    setPw('');
    setError(null);
    setNotice(null);
  };

  const sendCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await requestEmailCode(email.trim());
    setBusy(false);
    if (r.result === 'ok') {
      setStep('code');
      setNotice(`We sent a 6-digit code to ${email.trim()}. It works for 15 minutes — check spam if it isn’t there.`);
    } else setError(emailAuthMessage(r));
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'signin') {
      setBusy(true);
      setError(null);
      const r = await signInWithPassword(email.trim(), password);
      setBusy(false);
      if (r.result === 'ok') onSignedIn();
      else setError(emailAuthMessage(r));
      return;
    }
    if (step === 'email') return sendCode();
    if (password.length < MIN_PASSWORD) return setError(emailAuthMessage({ result: 'password_short' }));
    setBusy(true);
    setError(null);
    const r = await verifyEmailCode({ email: email.trim(), code: code.trim(), password, ...(mode === 'signup' && name.trim() ? { name: name.trim() } : {}) });
    setBusy(false);
    if (r.result === 'ok') onSignedIn();
    else setError(emailAuthMessage(r));
  };

  const title = mode === 'signin' ? 'Sign in with email' : mode === 'signup' ? 'Create an account' : 'Set a new password';
  const action =
    mode === 'signin' ? (busy ? 'Signing in…' : 'Sign in')
      : step === 'email' ? (busy ? 'Sending…' : 'Send code')
        : mode === 'signup' ? (busy ? 'Creating…' : 'Create account') : busy ? 'Saving…' : 'Save and sign in';

  return (
    <form className="vx-email-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="vx-email-head">
        <h3>{title}</h3>
        <button type="button" className="vx-email-link" onClick={onClose}>Close</button>
      </div>
      {mode === 'signup' && step === 'email' && (
        <label className="vx-email-field">
          <span>Name</span>
          <input type="text" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" />
        </label>
      )}
      {step === 'email' ? (
        <label className="vx-email-field">
          <span>Email</span>
          <input type="email" inputMode="email" autoComplete={mode === 'signin' ? 'username' : 'email'} required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus />
        </label>
      ) : (
        <>
          {notice && <p className="vx-email-note" role="status">{notice}</p>}
          <label className="vx-email-field">
            <span>Code from the email</span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" autoFocus />
          </label>
          {/* Lets a password manager save the address with the new password. */}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
        </>
      )}
      {(mode === 'signin' || step === 'code') && (
        <label className="vx-email-field">
          <span>{mode === 'signin' ? 'Password' : 'New password'}</span>
          <span className="vx-email-pw">
            <input
              type={show ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'signin' ? undefined : MIN_PASSWORD}
              maxLength={72}
              value={password}
              onChange={(e) => setPw(e.target.value)}
              placeholder={mode === 'signin' ? '' : `At least ${MIN_PASSWORD} characters`}
            />
            <button type="button" className="vx-email-link" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
      )}
      {error && <p className="vx-email-error" role="alert">{error}</p>}
      <button type="submit" className="vx-email-submit" disabled={busy || !email.trim() || (step === 'code' && (code.length !== 6 || !password)) || (mode === 'signin' && !password)}>
        {action}
      </button>
      <div className="vx-email-links">
        {mode === 'signin' ? (
          <>
            <button type="button" className="vx-email-link" onClick={() => go('reset')}>Forgot password?</button>
            <button type="button" className="vx-email-link" onClick={() => go('signup')}>Create an account</button>
          </>
        ) : step === 'code' ? (
          <>
            <button type="button" className="vx-email-link" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
            <button type="button" className="vx-email-link" onClick={() => go(mode)}>Use a different email</button>
          </>
        ) : (
          <button type="button" className="vx-email-link" onClick={() => go('signin')}>Have a password? Sign in</button>
        )}
      </div>
    </form>
  );
}
