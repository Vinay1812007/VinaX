/**
 * The one thing allowed to move the cursor.
 *
 * A terminal application has two kinds of output and they must not fight:
 *
 *   PERMANENT   the transcript — what VinaX read, ran and answered. It scrolls
 *               away and stays in history, so the user can scroll back and
 *               copy it.
 *   TRANSIENT   the live region at the bottom — the prompt, an open menu, a
 *               spinner. It is redrawn in place and leaves nothing behind.
 *
 * Everything goes through here so those two never interleave. The failure this
 * prevents is specific and familiar: a command writes to stdout while a
 * spinner is redrawing, and the prompt ends up smeared across the screen.
 *
 * On a non-TTY (a pipe, CI, --json) the transient region does not exist at
 * all: there is nothing to redraw and no cursor to move, so only permanent
 * output is written and not a single escape byte is emitted.
 */
import { ANSI, restoreSequence } from './ansi.js';
import { displayWidth } from './width.js';

export interface ScreenOptions {
  /** Where to write. Injectable so tests can capture instead of print. */
  write: (text: string) => void;
  /** Terminal columns; re-read on resize. */
  columns: () => number;
  /** False for pipes, CI and --json: no cursor motion, no redraw. */
  interactive: boolean;
}

export class Screen {
  private readonly out: (text: string) => void;
  private readonly cols: () => number;
  readonly interactive: boolean;
  /** Rows the transient region currently occupies on screen. */
  private drawnRows = 0;
  private transient: string[] = [];
  /** Where the cursor should sit inside the region, if anywhere. */
  private cursor: { row: number; column: number } | null = null;
  private cursorHidden = false;

  constructor(opts: ScreenOptions) {
    this.out = opts.write;
    this.cols = opts.columns;
    this.interactive = opts.interactive;
  }

  get columns(): number {
    return Math.max(20, this.cols());
  }

  /** How many screen rows a logical line takes once wrapped. */
  private rowsFor(line: string): number {
    const w = displayWidth(line);
    if (w === 0) return 1;
    return Math.ceil(w / this.columns);
  }

  /** Erase the transient region, leaving the cursor where it began. */
  private eraseTransient(): void {
    if (!this.interactive || this.drawnRows === 0) return;
    // The cursor sits somewhere inside the region; go to its first row.
    let seq = ANSI.column(1);
    if (this.cursorRow > 0) seq += ANSI.up(this.cursorRow);
    seq += ANSI.eraseDown;
    this.out(seq);
    this.drawnRows = 0;
    this.cursorRow = 0;
  }

  /** Row the real cursor is on within the transient region. */
  private cursorRow = 0;

  private paintTransient(): void {
    if (!this.interactive || this.transient.length === 0) {
      this.drawnRows = 0;
      this.cursorRow = 0;
      return;
    }
    let seq = '';
    let rows = 0;
    this.transient.forEach((line, i) => {
      seq += line;
      rows += this.rowsFor(line);
      if (i < this.transient.length - 1) seq += '\n';
    });
    this.drawnRows = rows;

    // Park the cursor. When the region declares a cursor position (the input
    // line) put it there and show it; otherwise hide it so a spinner does not
    // leave a blinking block in the middle of the text.
    if (this.cursor) {
      const target = this.cursor;
      const rowsAfter = this.transient
        .slice(target.row + 1)
        .reduce((n, l) => n + this.rowsFor(l), 0);
      seq += ANSI.up(rowsAfter) + ANSI.column(target.column + 1);
      this.cursorRow = target.row;
      if (this.cursorHidden) {
        seq += ANSI.showCursor;
        this.cursorHidden = false;
      }
    } else {
      this.cursorRow = Math.max(0, rows - 1);
      if (!this.cursorHidden) {
        seq += ANSI.hideCursor;
        this.cursorHidden = true;
      }
    }
    this.out(seq);
  }

  /**
   * Replace the live region.
   *
   * `cursor` names where the caret belongs, as a row within `lines` and a
   * display column within that row.
   */
  setTransient(lines: string[], cursor?: { row: number; column: number }): void {
    this.eraseTransient();
    this.transient = lines;
    this.cursor = cursor ?? null;
    this.paintTransient();
  }

  clearTransient(): void {
    this.eraseTransient();
    this.transient = [];
    this.cursor = null;
    if (this.cursorHidden) {
      this.out(ANSI.showCursor);
      this.cursorHidden = false;
    }
  }

  /**
   * Append to the permanent transcript.
   *
   * The live region is lifted first and put back afterwards, so transcript
   * output can never land inside the prompt.
   */
  writeLine(text: string): void {
    this.write(`${text}\n`);
  }

  write(text: string): void {
    if (!this.interactive) {
      this.out(text);
      return;
    }
    this.eraseTransient();
    this.out(text);
    this.paintTransient();
  }

  /** Re-measure and repaint — for SIGWINCH. */
  resize(): void {
    if (!this.interactive) return;
    // The old geometry is unknowable after a resize, so do not try to erase
    // by row count: return to column 1, clear downward, and repaint.
    this.out(ANSI.column(1) + ANSI.eraseDown);
    this.drawnRows = 0;
    this.cursorRow = 0;
    this.paintTransient();
  }

  /** Give the terminal back exactly as it was found. */
  shutdown(): void {
    if (!this.interactive) return;
    this.clearTransient();
    this.out(restoreSequence());
  }
}
