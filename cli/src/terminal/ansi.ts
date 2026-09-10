/**
 * Every ANSI sequence VinaX CLI emits, in one place.
 *
 * Scattering escape strings through an application is how terminals end up
 * stuck: some path hides the cursor and never shows it again, or enables
 * bracketed paste and leaves it on after exit. Centralising them means there
 * is exactly one list of things that must be undone, and `restoreSequence()`
 * is that list read backwards.
 *
 * Nothing here decides WHETHER to emit — that is the renderer's job, and it
 * stays silent on a non-TTY, under NO_COLOR, or with TERM=dumb.
 */

const ESC = '\u001b';
const CSI = `${ESC}[`;

export const ANSI = {
  /** Move the cursor up n lines (no-op at 0). */
  up: (n: number): string => (n > 0 ? `${CSI}${n}A` : ''),
  down: (n: number): string => (n > 0 ? `${CSI}${n}B` : ''),
  right: (n: number): string => (n > 0 ? `${CSI}${n}C` : ''),
  left: (n: number): string => (n > 0 ? `${CSI}${n}D` : ''),
  /** Absolute column, 1-based as the terminal counts them. */
  column: (n: number): string => `${CSI}${Math.max(1, n)}G`,
  /** Erase from the cursor to the end of the line. */
  eraseLine: `${CSI}K`,
  /** Erase from the cursor to the end of the screen. */
  eraseDown: `${CSI}J`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  /** Bracketed paste: the terminal brackets pasted text so it is not typed. */
  enableBracketedPaste: `${CSI}?2004h`,
  disableBracketedPaste: `${CSI}?2004l`,
  pasteStart: `${CSI}200~`,
  pasteEnd: `${CSI}201~`,
  reset: `${CSI}0m`,
} as const;

/**
 * Everything that must be undone before VinaX gives the terminal back.
 *
 * Emitted on every exit path — normal, /exit, Ctrl+C, Ctrl+D, SIGTERM, an
 * uncaught exception. A terminal left in raw mode with a hidden cursor is a
 * terminal the user has to `reset` by hand, and that is never acceptable.
 */
export function restoreSequence(): string {
  return `${ANSI.showCursor}${ANSI.disableBracketedPaste}${ANSI.reset}`;
}

// Matches CSI sequences, two-character escapes, and a bare ESC. Built from
// the ESC constant so there is no second raw control character in this file.
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z~]|${ESC}[()][0-9A-Za-z]|${ESC}.`, 'g');

/** Strip every escape sequence — used by the tests and by non-TTY output. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** True when the text carries any escape sequence at all. */
export function hasAnsi(text: string): boolean {
  ANSI_PATTERN.lastIndex = 0;
  return ANSI_PATTERN.test(text);
}
