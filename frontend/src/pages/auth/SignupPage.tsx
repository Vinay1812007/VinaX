/**
 * /signup — a new VinaX account with Google, or with an email address: a
 * 6-digit code proves the address, then the listener picks a password.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CodeAndPasswordForm } from '@/components/auth/CodeAndPasswordForm';
import { AuthShell, useAuthQuery } from './AuthShell';
import { useT } from '@/i18n';

export default function SignupPage(): ReactNode {
  const t = useT();
  const { next, email, setEmail, href } = useAuthQuery();
  return (
    <AuthShell
      title="Create your VinaX account"
      lede="Free, with no ads. Your library, playlists and taste follow you to every device."
      next={next}
      google
      switcher={
        <>
          {t('Have an account?')} <Link to={href('/login')}>{t('Sign in')}</Link>
        </>
      }
    >
      <CodeAndPasswordForm mode="signup" email={email} onEmail={setEmail} />
    </AuthShell>
  );
}
