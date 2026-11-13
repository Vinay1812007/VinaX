import { useId, useState, type ReactNode } from 'react';
import { MIN_PASSWORD } from '@/services/auth/email';

/** A password box with Show / Hide. `isNew` asks a password manager to suggest one. `aside` sits right of the label. */
export function PasswordField({ label, value, onChange, isNew = false, aside }: { label: string; value: string; onChange: (v: string) => void; isNew?: boolean; aside?: ReactNode }): ReactNode {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="vx-auth-field">
      <span className="vx-auth-label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </span>
      <span className="vx-auth-pw">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          required
          minLength={isNew ? MIN_PASSWORD : undefined}
          maxLength={72}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isNew ? `At least ${MIN_PASSWORD} characters` : undefined}
        />
        <button type="button" className="vx-auth-link" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
    </div>
  );
}
