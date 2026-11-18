/**
 * /forgot-password — a code to the address, then a new password, and signed
 * in. A Google account sets its first password the same way.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CodeAndPasswordForm } from '@/components/auth/CodeAndPasswordForm';
import { AuthShell, useAuthQuery } from './AuthShell';
import { useT } from '@/i18n';

export default function ForgotPasswordPage(): ReactNode {
  const t = useT();
  const { next, email, setEmail, href } = useAuthQuery();
  return (
    <AuthShell
      title="Set a new password"
      lede="Forgot it, or signed up with Google and never set one? We’ll email you a code."
      next={next}
      switcher={<Link to={href('/login')}>{t('Back to sign in')}</Link>}
    >
      <CodeAndPasswordForm mode="reset" email={email} onEmail={setEmail} />
    </AuthShell>
  );
}
