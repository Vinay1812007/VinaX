/**
 * The input line editor.
 *
 * Pure state: text, a cursor, and a history ring. No terminal, no stdin, no
 * escape sequences — the app feeds it decoded keys and asks it to render.
 * That separation is what lets the tests assert "type hello, press Left five
 * times, type X" and check the exact resulting string.
 *
 * The cursor is an index into GRAPHEMES, never into UTF-16 units. Moving left
 * past an emoji must move one visible character, not land inside a surrogate
 * pair and corrupt the line.
 */
import { displayWidth, graphemes } from './width.js';

export interface EditorState {
  /** The current text. */
  value: string;
  /** Cursor position, counted in graphemes. */
  cursor: number;
}

export class LineEditor {
  private chars: string[] = [];
  private pos = 0;
  private history: string[] = [];
  /** Index into history while browsing; history.length means "the draft". */
  private historyPos = 0;
  /** What the user had typed before they started browsing history. */
  private draft = '';

  get value(): string {
    return this.chars.join('');
  }

  /** Cursor position in graphemes. */
  get cursor(): number {
    return this.pos;
  }

  /** Terminal columns from the start of the text to the cursor. */
  get cursorColumn(): number {
    return displayWidth(this.chars.slice(0, this.pos).join(''));
  }

  get isEmpty(): boolean {
    return this.chars.length === 0;
  }

  state(): EditorState {
    return { value: this.value, cursor: this.pos };
  }

  setValue(text: string, cursor?: number): void {
    this.chars = graphemes(text);
    this.pos = cursor === undefined ? this.chars.length : Math.max(0, Math.min(cursor, this.chars.length));
  }

  clear(): void {
    this.chars = [];
    this.pos = 0;
    this.historyPos = this.history.length;
    this.draft = '';
  }

  insert(text: string): void {
    if (!text) return;
    const inserted = graphemes(text);
    this.chars.splice(this.pos, 0, ...inserted);
    this.pos += inserted.length;
  }

  // ---- motion -------------------------------------------------------------

  left(): void {
    if (this.pos > 0) this.pos -= 1;
  }

  right(): void {
    if (this.pos < this.chars.length) this.pos += 1;
  }

  home(): void {
    this.pos = 0;
  }

  end(): void {
    this.pos = this.chars.length;
  }

  /**
   * Word boundaries.
   *
   * "Word" here means a run of non-whitespace, which is what a developer
   * expects when clearing a path or a flag. Leading whitespace is skipped
   * first so Alt+Left from the end of "npm run build " lands before "build".
   */
  wordLeft(): void {
    let i = this.pos;
    while (i > 0 && /\s/.test(this.chars[i - 1])) i -= 1;
    while (i > 0 && !/\s/.test(this.chars[i - 1])) i -= 1;
    this.pos = i;
  }

  wordRight(): void {
    let i = this.pos;
    const n = this.chars.length;
    while (i < n && /\s/.test(this.chars[i])) i += 1;
    while (i < n && !/\s/.test(this.chars[i])) i += 1;
    this.pos = i;
  }

  // ---- deletion -----------------------------------------------------------

  backspace(): void {
    if (this.pos === 0) return;
    this.chars.splice(this.pos - 1, 1);
    this.pos -= 1;
  }

  deleteForward(): void {
    if (this.pos >= this.chars.length) return;
    this.chars.splice(this.pos, 1);
  }

  /** Ctrl+U — everything before the cursor. */
  killBefore(): void {
    this.chars.splice(0, this.pos);
    this.pos = 0;
  }

  /** Ctrl+K — everything from the cursor on. */
  killAfter(): void {
    this.chars.splice(this.pos);
  }

  /** Ctrl+W — the word before the cursor. */
  killWordBefore(): void {
    const from = this.pos;
    this.wordLeft();
    this.chars.splice(this.pos, from - this.pos);
  }

  // ---- history ------------------------------------------------------------

  /**
   * Remember a submitted line.
   *
   * Consecutive duplicates are collapsed — pressing Up after running the same
   * command twice should not require two presses to get past it.
   */
  remember(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed);
    if (this.history.length > 500) this.history.shift();
    this.historyPos = this.history.length;
    this.draft = '';
  }

  /** Up — older entries. Returns false when already at the oldest. */
  historyPrev(): boolean {
    if (!this.history.length || this.historyPos === 0) return false;
    if (this.historyPos === this.history.length) this.draft = this.value;
    this.historyPos -= 1;
    this.setValue(this.history[this.historyPos]);
    return true;
  }

  /** Down — newer entries, ending back at the draft the user was typing. */
  historyNext(): boolean {
    if (this.historyPos >= this.history.length) return false;
    this.historyPos += 1;
    this.setValue(this.historyPos === this.history.length ? this.draft : this.history[this.historyPos]);
    return true;
  }

  historyEntries(): string[] {
    return [...this.history];
  }

  /** Seed history from a previous session. */
  loadHistory(lines: string[]): void {
    this.history = lines.filter((l) => l.trim()).slice(-500);
    this.historyPos = this.history.length;
  }

  // ---- rendering helpers --------------------------------------------------

  /** The text split into logical lines (Ctrl+J inserts a newline). */
  lines(): string[] {
    return this.value.split('\n');
  }

  /** Which logical line the cursor is on, and its column within that line. */
  cursorPosition(): { line: number; column: number } {
    const before = this.chars.slice(0, this.pos).join('');
    const parts = before.split('\n');
    return { line: parts.length - 1, column: displayWidth(parts[parts.length - 1]) };
  }
}
