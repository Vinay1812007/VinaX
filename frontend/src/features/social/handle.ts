/**
 * 15.0 — a public profile's handle: 3–20 lower-case letters, digits or
 * underscores (what Settings → Profile lets a listener pick and what
 * /u/<handle> opens). One rule for the settings field and "Find by handle".
 */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/**
 * What a listener typed into "Find by handle", as a handle — or null when it
 * cannot be one. Takes `name`, `@name`, `/u/name` or a full profile link
 * (`https://www.vinaxmusic.online/u/name`), any case. Pure.
 */
export function parseHandle(input: string): string | null {
  let s = input.trim();
  const link = /\/u\/([^/?#\s]+)/i.exec(s);
  if (link) s = link[1];
  s = s.replace(/^@+/, '').toLowerCase();
  return HANDLE_RE.test(s) ? s : null;
}
