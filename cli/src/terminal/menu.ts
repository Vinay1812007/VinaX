/**
 * One vertical menu, used by everything that asks the user to choose.
 *
 * The slash-command picker, the engine and model selectors, the permission
 * mode chooser and the approval prompt are all this object with different
 * items. Writing five nearly-identical selectors is how keyboard behaviour
 * ends up subtly different in each one — Up wrapping in a place Down does
 * not, a disabled row that can still be selected, a scroll offset that
 * forgets where it was.
 *
 * Pure state, like the editor: the app renders it, the tests drive it.
 */

export interface MenuItem<T = unknown> {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Extra text matched when filtering, beyond label and description. */
  keywords?: string;
  value: T;
}

export interface MenuOptions {
  /** Rows visible at once; the list scrolls beyond this. */
  maxVisible?: number;
  /** Whether moving past an end wraps to the other end. */
  wrap?: boolean;
}

export class Menu<T = unknown> {
  private all: Array<MenuItem<T>>;
  private shown: Array<MenuItem<T>>;
  private index = 0;
  private offset = 0;
  private query = '';
  readonly maxVisible: number;
  readonly wrap: boolean;

  constructor(items: Array<MenuItem<T>>, opts: MenuOptions = {}) {
    this.all = items;
    this.shown = items;
    this.maxVisible = Math.max(1, opts.maxVisible ?? 8);
    this.wrap = opts.wrap ?? true;
    this.selectFirstEnabled();
  }

  get items(): Array<MenuItem<T>> {
    return this.shown;
  }

  get selectedIndex(): number {
    return this.index;
  }

  get selected(): MenuItem<T> | null {
    return this.shown[this.index] ?? null;
  }

  get filter(): string {
    return this.query;
  }

  get isEmpty(): boolean {
    return this.shown.length === 0;
  }

  /** The slice currently on screen, with the offset it starts at. */
  visible(): { items: Array<MenuItem<T>>; offset: number; hasAbove: boolean; hasBelow: boolean } {
    const items = this.shown.slice(this.offset, this.offset + this.maxVisible);
    return {
      items,
      offset: this.offset,
      hasAbove: this.offset > 0,
      hasBelow: this.offset + this.maxVisible < this.shown.length,
    };
  }

  replaceItems(items: Array<MenuItem<T>>): void {
    this.all = items;
    this.setFilter(this.query);
  }

  /**
   * Filter by a substring of the label, description or keywords.
   *
   * Selection is reset to the first enabled row rather than preserved: after
   * typing another character the old index almost never points at what the
   * user now means, and a selection that jumps around unpredictably is worse
   * than one that starts fresh.
   */
  setFilter(query: string): void {
    this.query = query;
    const q = query.trim().toLowerCase();
    this.shown = !q
      ? this.all
      : this.all.filter((i) =>
          `${i.label} ${i.description ?? ''} ${i.keywords ?? ''}`.toLowerCase().includes(q),
        );
    this.index = 0;
    this.offset = 0;
    this.selectFirstEnabled();
  }

  // ---- movement -----------------------------------------------------------

  next(): void {
    this.move(1);
  }

  prev(): void {
    this.move(-1);
  }

  pageDown(): void {
    this.moveBy(this.maxVisible);
  }

  pageUp(): void {
    this.moveBy(-this.maxVisible);
  }

  first(): void {
    this.index = 0;
    this.selectFirstEnabled();
    this.scrollIntoView();
  }

  last(): void {
    this.index = this.shown.length - 1;
    this.selectPrevEnabled();
    this.scrollIntoView();
  }

  /** Step one row, skipping disabled entries, wrapping when configured. */
  private move(delta: number): void {
    const n = this.shown.length;
    if (n === 0) return;
    let i = this.index;
    for (let step = 0; step < n; step += 1) {
      i += delta;
      if (i < 0) {
        if (!this.wrap) { i = 0; break; }
        i = n - 1;
      } else if (i >= n) {
        if (!this.wrap) { i = n - 1; break; }
        i = 0;
      }
      if (!this.shown[i]?.disabled) break;
    }
    this.index = i;
    this.scrollIntoView();
  }

  /** Jump a page, then settle on the nearest enabled row. */
  private moveBy(delta: number): void {
    const n = this.shown.length;
    if (n === 0) return;
    this.index = Math.max(0, Math.min(n - 1, this.index + delta));
    if (this.shown[this.index]?.disabled) {
      if (delta > 0) this.selectNextEnabled();
      else this.selectPrevEnabled();
    }
    this.scrollIntoView();
  }

  private selectFirstEnabled(): void {
    if (!this.shown.length) { this.index = 0; return; }
    if (!this.shown[this.index]?.disabled) return;
    this.selectNextEnabled();
  }

  private selectNextEnabled(): void {
    for (let i = this.index; i < this.shown.length; i += 1) {
      if (!this.shown[i].disabled) { this.index = i; return; }
    }
    this.selectPrevEnabled();
  }

  private selectPrevEnabled(): void {
    for (let i = Math.min(this.index, this.shown.length - 1); i >= 0; i -= 1) {
      if (!this.shown[i]?.disabled) { this.index = i; return; }
    }
    this.index = 0;
  }

  /** Keep the selected row inside the visible window. */
  private scrollIntoView(): void {
    if (this.index < this.offset) this.offset = this.index;
    else if (this.index >= this.offset + this.maxVisible) this.offset = this.index - this.maxVisible + 1;
    const maxOffset = Math.max(0, this.shown.length - this.maxVisible);
    this.offset = Math.max(0, Math.min(this.offset, maxOffset));
  }
}
