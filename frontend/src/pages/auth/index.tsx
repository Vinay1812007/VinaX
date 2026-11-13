/**
 * The three sign-in pages as one lazy chunk (the router loads it for
 * /login, /signup and /forgot-password): one import in the first-load
 * router instead of three.
 */
import type { ReactNode } from 'react';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import ForgotPasswordPage from './ForgotPasswordPage';

export default function AuthPage({ page }: { page: 'login' | 'signup' | 'forgot' }): ReactNode {
  return page === 'signup' ? <SignupPage /> : page === 'forgot' ? <ForgotPasswordPage /> : <LoginPage />;
}
