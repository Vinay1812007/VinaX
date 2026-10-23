/**
 * 13.9 — the sheet a signed-out visitor meets when they tap play, like or
 * save while browsing: one line on why, the Google button, and the same
 * promises the sign-in screen makes. On sign-in it closes and runs what the
 * visitor was doing (services/auth/gate). Loaded only when it opens.
 */
import { Link } from 'react-router-dom';
import { useUiStore, type SignInReason } from '@/store/uiStore';
import { GoogleSignIn } from './GoogleSignIn';
import { Sheet, SheetHeader } from './Sheet';

const COPY: Record<SignInReason, { title: string; text: string }> = {
  listen: { title: 'Sign in to start listening', text: 'Songs play once you are signed in. One tap, nothing to pay, and your library follows you to every device.' },
  save: { title: 'Sign in to save this', text: 'Liked songs, playlists and Listen Later live in your account, so they are there on every device.' },
  account: { title: 'Sign in to VinaX', text: 'Play any song, save it, and get picks made from what you listen to.' },
};

export function SignInPrompt() {
  const prompt = useUiStore((s) => s.signIn);
  const close = useUiStore((s) => s.closeSignIn);
  if (!prompt) return null;
  const copy = COPY[prompt.reason];
  const resume = prompt.resume;
  return (
    <Sheet onClose={close} labelledBy="vx-signin-prompt-title" size="sm" z={80} className="vx-signin-prompt">
      <SheetHeader id="vx-signin-prompt-title" title={copy.title} subtitle={copy.text} onClose={close} />
      <div className="vx-signin-prompt-button">
        <GoogleSignIn
          onSignedIn={() => {
            close();
            resume?.();
          }}
        />
      </div>
      <ul className="vx-signin-prompt-perks">
        <li>₹0, no subscription, nothing asks for a card</li>
        <li>No ads in the player, the queue or your library</li>
        <li>Your library on every device</li>
      </ul>
      <p className="vx-signin-prompt-fine">
        By signing in you agree to the <Link to="/terms" onClick={close}>Terms</Link> and the <Link to="/privacy" onClick={close}>Privacy policy</Link>.
      </p>
    </Sheet>
  );
}

export default SignInPrompt;
