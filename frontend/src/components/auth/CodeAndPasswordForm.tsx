/**
 * The two steps /signup and /forgot-password share: the address gets a
 * 6-digit code, then the code and a new password sign in.
 *
 * The server answers the same whether or not the address already has an
 * account (so the form can't be used to find out who listens on VinaX). When
 * it has one, a Google account too, the code sets that account's password
 * and signs in to it, so nobody ends up with two accounts; the sign-up step
 * says so.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { emailAuthMessage, MIN_PASSWORD, requestEmailCode, verifyEmailCode } from '@/services/auth/email';
import { PasswordField } from './PasswordField';

/** Seconds before another code may go to the same address (the server's CODE_RESEND_MS). */
export const RESEND_SECONDS = 60;

export function CodeAndPasswordForm({ mode, email, onEmail }: { mode: 'signup' | 'reset'; email: string; onEmail: (v: string) => void }): ReactNode {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  // "Send a new code" counts down instead of answering "wait".
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await requestEmailCode(email.trim());
    setBusy(false);
    if (r.result === 'ok') {
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
      return;
    }
    if (r.result === 'wait' && r.retryIn) {
      // A code already went out a moment ago: it still works, so go on to it.
      setStep('code');
      setWait(r.retryIn);
      return;
    }
    setError(emailAuthMessage(r));
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (step === 'email') return sendCode();
    if (password.length < MIN_PASSWORD) return setError(emailAuthMessage({ result: 'password_short' }));
    setBusy(true);
    setError(null);
    const r = await verifyEmailCode({ email: email.trim(), code, password, ...(mode === 'signup' && name.trim() ? { name: name.trim() } : {}) });
    setBusy(false);
    // Signed in: the page sees the account and moves on.
    if (r.result !== 'ok') setError(emailAuthMessage(r));
  };

  const back = (): void => {
    setStep('email');
    setCode('');
    setPw('');
    setError(null);
  };

  const action =
    step === 'email' ? (busy ? 'Sending…' : 'Send code')
      : mode === 'signup' ? (busy ? 'Creating…' : 'Create account') : busy ? 'Saving…' : 'Save and sign in';
  const ready = step === 'email' ? !!email.trim() : code.length === 6 && password.length > 0;

  return (
    <form className="vx-auth-form" onSubmit={(e) => void submit(e)} noValidate>
      {step === 'email' ? (
        <>
          {mode === 'signup' && (
            <label className="vx-auth-field">
              <span>Name <em>(optional)</em></span>
              <input type="text" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" autoFocus={!email} />
            </label>
          )}
          <label className="vx-auth-field">
            <span>Email</span>
            <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => onEmail(e.target.value)} placeholder="you@example.com" autoFocus={mode === 'reset' || !!email} />
          </label>
          {mode === 'signup' && <p className="vx-auth-hint">We’ll email you a 6-digit code to check the address is yours.</p>}
        </>
      ) : (
        <>
          <div className="vx-auth-sent" role="status">
            <p>
              We sent a 6-digit code to <strong>{email.trim()}</strong>. It works for 15 minutes. Check spam if it isn’t there.
            </p>
            {mode === 'signup' && <p>Already have a VinaX account with this address, Google too? The code sets its password and signs you in to it.</p>}
          </div>
          <label className="vx-auth-field">
            <span>Code from the email</span>
            <input
              className="vx-auth-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              autoFocus
            />
          </label>
          {/* Lets a password manager save the address with the new password. */}
          <input type="email" autoComplete="username" value={email.trim()} readOnly hidden />
          <PasswordField label={mode === 'signup' ? 'Choose a password' : 'New password'} value={password} onChange={setPw} isNew />
        </>
      )}
      {error && <p className="vx-auth-error" role="alert">{error}</p>}
      <button type="submit" className="vx-auth-submit" disabled={busy || !ready}>
        {action}
      </button>
      {step === 'code' && (
        <div className="vx-auth-row">
          <button type="button" className="vx-auth-link" disabled={busy || wait > 0} onClick={() => void sendCode()}>
            {wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}
          </button>
          <button type="button" className="vx-auth-link" onClick={back}>
            Use a different email
          </button>
        </div>
      )}
    </form>
  );
}
