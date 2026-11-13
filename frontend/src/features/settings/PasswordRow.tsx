/**
 * Schema 20 — Settings › Account › Password. A listener who signed up with
 * Google sets a password here, and can then also sign in with their email and
 * that password (on a phone without Google, a shared computer…). With one set,
 * the row changes it (the current password is asked for). A forgotten one is
 * reset from the sign-in screen with an email code.
 */
import { useState, type FormEvent } from 'react';
import { useAccount } from '@/components/useAccount';
import { emailAuthMessage, MIN_PASSWORD, setPassword } from '@/services/auth/email';
import { toast } from '@/store/toastStore';
import { Block, Row, RowButton } from './SettingsControls';
import '@/styles/signin.css';

export function PasswordRow() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [needCurrent, setNeedCurrent] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!account) return null;
  const has = account.user.hasPassword === true || needCurrent;
  const email = account.user.email;

  const close = (): void => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setAgain('');
    setError(null);
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    if (next.length < MIN_PASSWORD) return setError(emailAuthMessage({ result: 'password_short' }));
    if (next !== again) return setError('The two passwords don’t match.');
    setBusy(true);
    setError(null);
    const r = await setPassword(next, has ? current : undefined);
    setBusy(false);
    if (r.result === 'ok') {
      close();
      setNeedCurrent(false);
      toast(has ? 'Password changed.' : `Password set. You can now sign in with ${email ?? 'your email'} and this password.`, { duration: 5000 });
      return;
    }
    if (r.result === 'wrong_password') {
      // The account already had a password (set on another device): ask for it.
      if (!has) setNeedCurrent(true);
      return setError(has ? 'Your current password isn’t right. Forgot it? Sign out and use “Forgot password?” on the sign-in screen.' : 'This account already has a password. Enter it to change it.');
    }
    setError(emailAuthMessage(r));
  };

  const note = has
    ? `You can sign in with ${email ?? 'your email'} and your password.`
    : `Set a password to also sign in with ${email ?? 'your email'} and a password, without Google.`;

  const keywords = 'password email login sign in set change';
  // Closed: a plain row with its button on the right. Open: the form takes the
  // row's full width under the label (a narrow right-hand column squeezed it).
  if (!open) {
    return (
      <Row label="Password" note={note} keywords={keywords}>
        <RowButton onClick={() => setOpen(true)}>{has ? 'Change password' : 'Set a password'}</RowButton>
      </Row>
    );
  }
  return (
    <Block label="Password" note={note} keywords={keywords}>
      <form className="vx-email-form" onSubmit={(e) => void submit(e)} noValidate>
        {/* Lets a password manager file the new password under this address. */}
        <input type="email" autoComplete="username" value={email ?? ''} readOnly hidden />
        {has && (
          <label className="vx-email-field">
            <span>Current password</span>
            <input type={show ? 'text' : 'password'} autoComplete="current-password" maxLength={72} value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </label>
        )}
        <label className="vx-email-field">
          <span>{has ? 'New password' : 'Password'}</span>
          <span className="vx-email-pw">
            <input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={72} value={next} onChange={(e) => setNext(e.target.value)} placeholder={`At least ${MIN_PASSWORD} characters`} autoFocus={!has} />
            <button type="button" className="vx-email-link" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</button>
          </span>
        </label>
        <label className="vx-email-field">
          <span>Type it again</span>
          <input type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={72} value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        {error && <p className="vx-email-error" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="vx-email-submit px-5" disabled={busy || !next || !again || (has && !current)}>
            {busy ? 'Saving…' : has ? 'Change password' : 'Set password'}
          </button>
          <RowButton onClick={close}>Cancel</RowButton>
        </div>
      </form>
    </Block>
  );
}
