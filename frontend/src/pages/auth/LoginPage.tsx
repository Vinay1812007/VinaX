/**
 * /login — sign in with Google, or with an email address and its password.
 * Signed-out visits to personal pages land here with `?next=` (AuthGate).
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { emailAuthMessage, signInWithPassword, type EmailAuthResult } from '@/services/auth/email';
import { PasswordField } from '@/components/auth/PasswordField';
import { AuthShell, useAuthQuery } from './AuthShell';
import { useT } from '@/i18n';

export default function LoginPage(): ReactNode {
  const t = useT();
  const { next, email, setEmail, href } = useAuthQuery();
  const [password, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ result: EmailAuthResult; text: string } | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    const r = await signInWithPassword(email.trim(), password);
    setBusy(false);
    // Signed in: AuthShell sees the account and moves on to `next`.
    if (r.result !== 'ok') setError({ result: r.result, text: emailAuthMessage(r) ?? '' });
  };

  return (
    <AuthShell
      title="Sign in to VinaX"
      lede="Your library, playlists, history and taste follow you to every device."
      next={next}
      google
      switcher={
        <>
          {t('New to VinaX?')} <Link to={href('/signup')}>{t('Create an account')}</Link>
        </>
      }
    >
      <form className="vx-auth-form" onSubmit={(e) => void submit(e)} noValidate>
        <label className="vx-auth-field">
          <span>{t('Email')}</span>
          <input type="email" inputMode="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        <PasswordField
          label={t('Password')}
          value={password}
          onChange={setPw}
          aside={
            <Link to={href('/forgot-password')} className="vx-auth-link">
              {t('Forgot password?')}
            </Link>
          }
        />
        {error && (
          <p className="vx-auth-error" role="alert">
            {error.result === 'wrong_password' ? (
              <>
                {t('That email and password don’t match. Made your account with Google? Use the Google button above, or')}{' '}
                <Link to={href('/forgot-password')}>{t('set a password')}</Link>.
              </>
            ) : (
              error.text
            )}
          </p>
        )}
        <button type="submit" className="vx-auth-submit" disabled={busy || !email.trim() || !password}>
          {t(busy ? 'Signing in…' : 'Sign in')}
        </button>
      </form>
    </AuthShell>
  );
}
