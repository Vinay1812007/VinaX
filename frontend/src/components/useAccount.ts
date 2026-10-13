import { useEffect, useState } from 'react';
import { currentAccount, onAccountChange, type Account } from '@/services/auth/google';

/** 13.0 — the signed-in Google account, kept current. Its own tiny module so
 *  first-load code (the gate, the top bar) never pulls the sign-in button in. */
export function useAccount(): Account | null {
  const [a, setA] = useState<Account | null>(currentAccount);
  useEffect(() => onAccountChange(setA), []);
  return a;
}
