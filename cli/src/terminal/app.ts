/**
 * TerminalApp — the one object that owns interactive stdin and coordinates
 * everything drawn in the live region.
 *
 * Before this existed, several pieces wrote to stdout independently: readline
 * drew the prompt, the agent printed status lines, a tool streamed command
 * output, and none of them knew about the others. The result is the classic
 * smeared prompt.
 *
 * Now the ownership is explicit:
 *
 *     agent / tool event  →  TerminalApp state  →  render()  →  Screen
 *
 * Nothing else moves the cursor. Callers emit semantic events — "a tool
 * started", "text arrived", "ask the user to choose" — and this decides what
 * the terminal looks like.
 *
 * Deliberately NOT an alternate-screen application: the transcript stays in
 * normal scrollback so the user can scroll, select and copy it as usual.
 */
import { Activity, describeTool, formatElapsed, type Clock, ASCII_FRAMES, SPINNER_FRAMES } from './activity.js';
import { createKeyDecoder, isCtrl, type Key, type KeyDecoder } from './keys.js';
import { LineEditor } from './editor.js';
import { Menu, type MenuItem } from './menu.js';
import { Screen } from './screen.js';
import { ANSI, restoreSequence } from './ansi.js';
import { glyphs, paint, type Theme } from './render.js';
import { truncateToWidth } from './width.js';

/** How long a lone ESC waits before it is taken to be the Escape key. */
const ESCAPE_TIMEOUT_MS = 50;

export interface StatusLine {
  approval: string;
  engine: string;
  web: boolean;
  branch?: string;
}

export interface AppOptions {
  theme: Theme;
  /** stdin; injectable for tests. */
  input?: NodeJS.ReadStream;
  /** stdout; injectable for tests. */
  output?: NodeJS.WriteStream;
  clock?: Clock;
  /** False when stdout is a pipe, CI, or --json. */
  interactive: boolean;
  /** Called on Ctrl+C. Returns true if it consumed the interrupt. */
  onInterrupt?: () => boolean;
}

type Resolver<T> = (value: T) => void;

interface MenuSession<T> {
  title: string;
  hint: string;
  menu: Menu<T>;
  resolve: Resolver<T | null>;
  /** Extra lines shown above the menu (a diff, a command, a remote). */
  detail: string[];
  /** Typed characters filter the menu instead of editing the prompt. */
  filterable: boolean;
  filter: string;
  /** Single-key shortcuts, e.g. y/n on an approval. */
  shortcuts?: Record<string, T | null>;
}

export class TerminalApp {
  readonly screen: Screen;
  private readonly theme: Theme;
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly decoder: KeyDecoder = createKeyDecoder();
  private readonly editor = new LineEditor();
  private readonly clock: Clock | undefined;
  readonly interactive: boolean;

  private started = false;
  private rawWasSet = false;
  /** Process-level restore hooks, removed again on stop(). */
  private exitHooks: Array<[NodeJS.Signals | 'exit', () => void]> = [];
  private escapeTimer: NodeJS.Timeout | null = null;
  private spinnerTimer: NodeJS.Timeout | null = null;

  private activity: Activity | null = null;
  private status: StatusLine = { approval: 'ask', engine: 'auto', web: false };
  private placeholder = 'ask VinaX anything';

  /** Waiting for the user to submit a line. */
  private lineResolver: Resolver<string | null> | null = null;
  /** An open menu, if any. Menus take priority over the editor. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private menuSession: MenuSession<any> | null = null;
  /** True while the slash menu is showing under the input. */
  private slashOpen = false;
  private slashMenu: Menu<string> | null = null;
  private slashItems: Array<MenuItem<string>> = [];
  /** The query the slash menu is currently filtered by. */
  private slashQuery = '';
  /** Set by Esc: stay closed until the input stops being a bare command. */
  private slashDismissed = false;

  private onInterrupt: () => boolean;
  private interruptedAt = 0;

  constructor(opts: AppOptions) {
    this.theme = opts.theme;
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.clock = opts.clock;
    this.interactive = opts.interactive;
    this.onInterrupt = opts.onInterrupt ?? ((): boolean => false);
    this.screen = new Screen({
      write: (t) => this.output.write(t),
      columns: () => this.output.columns ?? 80,
      interactive: opts.interactive,
    });
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Take the terminal. Safe to call on a non-TTY: it simply does less. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (!this.interactive) return;

    // Deliberately NOT readline.emitKeypressEvents(): that installs readline's
    // own reader on the stream, which competes with this one for the bytes and
    // silently starves it — input stops dead at the first escape sequence.
    // VinaX decodes raw bytes itself (see keys.ts), so readline has no part
    // to play here.
    if (this.input.isTTY && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(true);
      this.rawWasSet = true;
    }
    this.input.resume();
    this.input.setEncoding('utf8');
    this.input.on('data', this.onData);
    this.output.write(ANSI.enableBracketedPaste);
    this.output.on('resize', this.onResize);

    // The finally block in the session loop covers the ordinary paths, but a
    // signal kills the process without unwinding it. Without these, a SIGTERM
    // — from a supervisor, a `kill`, or a closing terminal — leaves the user's
    // shell in raw mode with no cursor, which they then have to `reset` by
    // hand. Restoring is a handful of bytes; forgetting is somebody's evening.
    const restore = (): void => {
      try {
        if (this.rawWasSet && typeof this.input.setRawMode === 'function') this.input.setRawMode(false);
        this.output.write(restoreSequence());
      } catch {
        /* the stream may already be gone; nothing more we can do */
      }
    };
    const onSignal = (sig: NodeJS.Signals) => (): void => {
      restore();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    for (const sig of ['SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) {
      const fn = onSignal(sig);
      this.exitHooks.push([sig, fn]);
      process.on(sig, fn);
    }
    // Synchronous, for anything that reaches exit without a signal.
    this.exitHooks.push(['exit', restore]);
    process.on('exit', restore);
  }

  /**
   * Give the terminal back.
   *
   * Called from every exit path, and idempotent, because the one thing worse
   * than a crash is a crash that leaves the user's shell in raw mode with no
   * cursor.
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stopSpinner();
    if (this.escapeTimer) { clearTimeout(this.escapeTimer); this.escapeTimer = null; }
    if (!this.interactive) return;

    this.input.off('data', this.onData);
    this.output.off('resize', this.onResize);
    if (this.rawWasSet && typeof this.input.setRawMode === 'function') {
      this.input.setRawMode(false);
      this.rawWasSet = false;
    }
    this.input.pause();
    this.screen.shutdown();
    this.decoder.reset();
    for (const [event, fn] of this.exitHooks) process.off(event, fn);
    this.exitHooks = [];
  }

  private onResize = (): void => {
    this.render();
    this.screen.resize();
  };

  // ---- input --------------------------------------------------------------

  private onData = (chunk: string): void => {
    if (this.escapeTimer) { clearTimeout(this.escapeTimer); this.escapeTimer = null; }
    try {
      for (const k of this.decoder.push(chunk)) this.handleKey(k);
    } catch (e) {
      // An exception in a key handler must never take the input loop down
      // with it — that strands the user at a prompt that has stopped
      // responding, with no clue why.
      this.writeTranscript(`Input error: ${e instanceof Error ? e.message : String(e)}`);
    }
    // A lone ESC is ambiguous until either more bytes arrive or a moment
    // passes. The decoder holds it; this is the moment passing.
    if (this.decoder.pending()) {
      this.escapeTimer = setTimeout(() => {
        this.escapeTimer = null;
        for (const k of this.decoder.flush()) this.handleKey(k);
      }, ESCAPE_TIMEOUT_MS);
      this.escapeTimer.unref?.();
    }
  };

  /** Drive the app from a key without touching stdin — used by the tests. */
  feed(chunk: string): void {
    for (const k of this.decoder.push(chunk)) this.handleKey(k);
  }

  /** Resolve a held ESC immediately — used by the tests. */
  flushKeys(): void {
    for (const k of this.decoder.flush()) this.handleKey(k);
  }

  private handleKey(k: Key): void {
    if (isCtrl(k, 'c')) {
      this.handleInterrupt();
      return;
    }
    if (this.menuSession) {
      this.handleMenuKey(k);
      return;
    }
    this.handleEditorKey(k);
  }

  private handleInterrupt(): void {
    if (this.menuSession) {
      // Cancelling a question is always safe: it means "no".
      this.closeMenu(null);
      return;
    }
    if (this.onInterrupt()) return;
    const now = Date.now();
    if (!this.editor.isEmpty) {
      this.editor.clear();
      this.closeSlash();
      this.render();
      return;
    }
    if (now - this.interruptedAt < 2000) {
      this.resolveLine(null);
      return;
    }
    this.interruptedAt = now;
    this.writeTranscript(paint(this.theme, 'grey', '  Press Ctrl+C again, or type /exit, to leave VinaX CLI.'));
  }

  private handleEditorKey(k: Key): void {
    const ed = this.editor;
    switch (k.name) {
      case 'enter':
        this.submit();
        return;
      case 'backspace': ed.backspace(); break;
      case 'delete': ed.deleteForward(); break;
      case 'left': ed.left(); break;
      case 'right': ed.right(); break;
      case 'home': ed.home(); break;
      case 'end': ed.end(); break;
      case 'word-left': ed.wordLeft(); break;
      case 'word-right': ed.wordRight(); break;
      case 'up':
        if (this.slashOpen && this.slashMenu) this.slashMenu.prev();
        else ed.historyPrev();
        break;
      case 'down':
        if (this.slashOpen && this.slashMenu) this.slashMenu.next();
        else ed.historyNext();
        break;
      case 'pageup': if (this.slashOpen && this.slashMenu) this.slashMenu.pageUp(); break;
      case 'pagedown': if (this.slashOpen && this.slashMenu) this.slashMenu.pageDown(); break;
      case 'tab':
        if (this.slashOpen && this.slashMenu?.selected) {
          ed.setValue(`${this.slashMenu.selected.value} `);
        }
        break;
      case 'shift-tab':
        if (this.slashOpen && this.slashMenu) this.slashMenu.prev();
        break;
      case 'escape':
        if (this.slashOpen) {
          this.slashDismissed = true;
          this.closeSlash();
        }
        break;
      case 'paste':
        // A pasted block is text, never a series of submissions.
        ed.insert(k.text ?? '');
        break;
      case 'char': {
        if (k.ctrl) {
          switch (k.text) {
            case 'a': ed.home(); break;
            case 'e': ed.end(); break;
            case 'u': ed.killBefore(); break;
            case 'k': ed.killAfter(); break;
            case 'w': ed.killWordBefore(); break;
            case 'j': ed.insert('\n'); break;
            case 'd':
              // Exit only on an empty line, so Ctrl+D cannot discard work.
              if (ed.isEmpty) { this.resolveLine(null); return; }
              ed.deleteForward();
              break;
            case 'l': this.screen.write(''); break;
            default: break;
          }
          break;
        }
        if (k.meta) break; // Alt+<char> is not text
        ed.insert(k.text ?? '');
        break;
      }
      default: break;
    }
    this.syncSlash();
    this.render();
  }

  private submit(): void {
    if (this.slashOpen && this.slashMenu?.selected) {
      // Enter on an open slash menu chooses the command rather than sending
      // whatever half-typed text is in the box.
      const command = this.slashMenu.selected.value;
      this.editor.setValue(command);
      this.closeSlash();
    }
    const value = this.editor.value;
    if (!value.trim()) { this.render(); return; }
    this.editor.remember(value);
    this.editor.clear();
    this.closeSlash();
    this.resolveLine(value);
  }

  // ---- the live slash menu ------------------------------------------------

  /** Give the app the slash-command catalogue to offer. */
  setSlashCommands(items: Array<MenuItem<string>>): void {
    this.slashItems = items;
  }

  /**
   * Open, filter or close the slash menu from the current input.
   *
   * The menu appears the moment the line begins with "/" — no Tab required —
   * and narrows as the user keeps typing.
   */
  private syncSlash(): void {
    const value = this.editor.value;
    const isSlash = value.startsWith('/') && !value.includes(' ') && !value.includes('\n');
    if (!isSlash) {
      // Leaving slash territory re-arms the menu for next time.
      this.slashDismissed = false;
      this.closeSlash();
      return;
    }
    if (this.slashDismissed) return;
    if (!this.slashOpen) {
      this.slashMenu = new Menu(this.slashItems, { maxVisible: 8 });
      this.slashOpen = true;
      this.slashQuery = '';
    }
    const query = value.slice(1);
    // Re-filtering resets the selection, so only do it when the query really
    // changed — otherwise Down would move the highlight and the same
    // keystroke would immediately put it back.
    if (query !== this.slashQuery) {
      this.slashQuery = query;
      this.slashMenu?.setFilter(query);
    }
  }

  private closeSlash(): void {
    this.slashOpen = false;
    this.slashMenu = null;
    this.slashQuery = '';
  }

  // ---- public API ---------------------------------------------------------

  /** Replace the Ctrl+C handler once the session loop is ready to own it. */
  setInterruptHandler(fn: () => boolean): void {
    this.onInterrupt = fn;
  }

  setStatus(status: Partial<StatusLine>): void {
    this.status = { ...this.status, ...status };
    this.render();
  }

  setPlaceholder(text: string): void {
    this.placeholder = text;
  }

  /** Wait for a submitted line. Resolves null when the user wants to leave. */
  readLine(): Promise<string | null> {
    return new Promise((resolve) => {
      this.lineResolver = resolve;
      this.render();
    });
  }

  private resolveLine(value: string | null): void {
    const r = this.lineResolver;
    this.lineResolver = null;
    this.screen.clearTransient();
    r?.(value);
  }

  /**
   * Ask the user to choose. Resolves null on Esc or Ctrl+C.
   *
   * Used by the approval prompt and by every picker, so they all behave the
   * same way under the same keys.
   */
  choose<T>(opts: {
    title: string;
    items: Array<MenuItem<T>>;
    detail?: string[];
    hint?: string;
    filterable?: boolean;
    maxVisible?: number;
    shortcuts?: Record<string, T | null>;
  }): Promise<T | null> {
    return new Promise((resolve) => {
      this.menuSession = {
        title: opts.title,
        hint: opts.hint ?? '↑↓ navigate · Enter select · Esc cancel',
        menu: new Menu<T>(opts.items, { maxVisible: opts.maxVisible ?? 8, wrap: true }),
        resolve: resolve as Resolver<unknown>,
        detail: opts.detail ?? [],
        filterable: opts.filterable ?? false,
        filter: '',
        shortcuts: opts.shortcuts as Record<string, unknown> | undefined,
      } as MenuSession<T>;
      this.render();
    });
  }

  private handleMenuKey(k: Key): void {
    const s = this.menuSession;
    if (!s) return;
    switch (k.name) {
      case 'up': s.menu.prev(); break;
      case 'down': s.menu.next(); break;
      case 'pageup': s.menu.pageUp(); break;
      case 'pagedown': s.menu.pageDown(); break;
      case 'home': s.menu.first(); break;
      case 'end': s.menu.last(); break;
      case 'tab': s.menu.next(); break;
      case 'shift-tab': s.menu.prev(); break;
      case 'escape':
        // Esc is always the safe answer: cancel, which for an approval means
        // reject.
        this.closeMenu(null);
        return;
      case 'enter': {
        const sel = s.menu.selected;
        if (sel && !sel.disabled) this.closeMenu(sel.value);
        return;
      }
      case 'backspace':
        if (s.filterable && s.filter) {
          s.filter = s.filter.slice(0, -1);
          s.menu.setFilter(s.filter);
        }
        break;
      case 'char': {
        if (k.ctrl || k.meta) break;
        const text = k.text ?? '';
        const shortcut = s.shortcuts?.[text.toLowerCase()];
        if (shortcut !== undefined) { this.closeMenu(shortcut); return; }
        if (s.filterable) {
          s.filter += text;
          s.menu.setFilter(s.filter);
        }
        break;
      }
      default: break;
    }
    this.render();
  }

  private closeMenu(value: unknown): void {
    const s = this.menuSession;
    this.menuSession = null;
    this.screen.clearTransient();
    s?.resolve(value);
    if (this.lineResolver) this.render();
  }

  // ---- activity -----------------------------------------------------------

  /** Start (or relabel) the live activity line. */
  beginActivity(label: string): void {
    if (this.activity?.running) {
      this.activity.setLabel(label);
      this.render();
      return;
    }
    this.activity = new Activity(label, {
      ...(this.clock ? { clock: this.clock } : {}),
      frames: this.theme.unicode ? SPINNER_FRAMES : ASCII_FRAMES,
    });
    this.startSpinner();
    this.render();
  }

  /** Describe a tool call in human terms and show it as the activity. */
  beginToolActivity(name: string, args: Record<string, unknown>): void {
    this.beginActivity(describeTool(name, args));
  }

  /**
   * Finish the activity, leaving one permanent line behind.
   *
   * The transient line is erased first, so no dead spinner frame is left in
   * scrollback.
   */
  endActivity(state: 'ok' | 'failed' | 'interrupted', label?: string, extra?: string): void {
    const a = this.activity;
    if (!a) return;
    a.finish(state, label);
    this.stopSpinner();
    this.activity = null;
    // Repaint FIRST, so the live region no longer holds the spinner line.
    // Writing the permanent line before this would redraw the stale frame
    // underneath it and leave it in scrollback.
    this.render();

    const g = glyphs(this.theme);
    const mark =
      state === 'ok' ? paint(this.theme, 'green', g.ok)
        : state === 'failed' ? paint(this.theme, 'red', g.fail)
          : paint(this.theme, 'yellow', g.warn);
    const elapsed = formatElapsed(a.elapsedMs());
    const tail = [extra, elapsed].filter(Boolean).join(' · ');
    this.writeTranscript(`${mark} ${a.text}${tail ? paint(this.theme, 'grey', ` · ${tail}`) : ''}`);
  }

  /** Drop the activity with no permanent line (the model started answering). */
  cancelActivity(): void {
    if (!this.activity) return;
    this.stopSpinner();
    this.activity = null;
    this.render();
  }

  get hasActivity(): boolean {
    return this.activity !== null;
  }

  private startSpinner(): void {
    if (!this.interactive || this.spinnerTimer) return;
    const interval = this.activity?.interval ?? 80;
    this.spinnerTimer = setInterval(() => {
      this.activity?.advance();
      this.render();
    }, interval);
    this.spinnerTimer.unref?.();
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
  }

  /** Advance the spinner by hand — tests, instead of real timers. */
  tickSpinner(): void {
    this.activity?.advance();
    this.render();
  }

  // ---- output -------------------------------------------------------------

  /** Append to the permanent transcript. */
  writeTranscript(text: string): void {
    this.screen.writeLine(text);
  }

  /** Raw permanent output with no trailing newline (streamed assistant text). */
  writeRaw(text: string): void {
    this.screen.write(text);
  }

  // ---- rendering ----------------------------------------------------------

  private render(): void {
    if (!this.interactive || !this.started) return;
    const g = glyphs(this.theme);
    const width = this.screen.columns;
    const lines: string[] = [];
    let cursor: { row: number; column: number } | undefined;

    // A menu owns the whole region while it is open.
    if (this.menuSession) {
      const s = this.menuSession;
      lines.push('');
      lines.push(`${paint(this.theme, 'yellow', g.ask)} ${paint(this.theme, 'bold', s.title)}`);
      if (s.detail.length) {
        lines.push('');
        for (const d of s.detail) lines.push(truncateToWidth(d, width));
      }
      lines.push('');
      const v = s.menu.visible();
      if (v.hasAbove) lines.push(paint(this.theme, 'grey', '  ↑ more'));
      for (const item of v.items) {
        const isSel = s.menu.selected?.id === item.id;
        const pointer = isSel ? paint(this.theme, 'cyan', '›') : ' ';
        const label = item.disabled
          ? paint(this.theme, 'grey', item.label)
          : isSel ? paint(this.theme, 'bold', item.label) : item.label;
        const desc = item.description ? paint(this.theme, 'grey', `  ${item.description}`) : '';
        lines.push(truncateToWidth(`  ${pointer} ${label}${desc}`, width));
      }
      if (v.hasBelow) lines.push(paint(this.theme, 'grey', '  ↓ more'));
      if (s.filterable && s.filter) lines.push(paint(this.theme, 'grey', `  filter: ${s.filter}`));
      lines.push('');
      lines.push(paint(this.theme, 'grey', `  ${s.hint}`));
      this.screen.setTransient(lines);
      return;
    }

    // Activity line, above the prompt.
    if (this.activity) {
      const a = this.activity.view();
      const elapsed = formatElapsed(a.elapsedMs);
      const spin = paint(this.theme, 'cyan', a.frame);
      lines.push(truncateToWidth(`${spin} ${a.text}${elapsed ? paint(this.theme, 'grey', ` · ${elapsed}`) : ''}`, width));
    }

    // The prompt, only while a line is actually being read.
    if (this.lineResolver) {
      if (lines.length) lines.push('');
      const promptMark = paint(this.theme, 'cyan', '›');
      const editorLines = this.editor.lines();
      const shown = this.editor.isEmpty
        ? [paint(this.theme, 'grey', this.placeholder)]
        : editorLines;
      shown.forEach((l, i) => {
        lines.push(`${i === 0 ? `${promptMark} ` : '  '}${l}`);
      });
      const pos = this.editor.cursorPosition();
      cursor = { row: lines.length - shown.length + pos.line, column: pos.column + 2 };

      if (this.slashOpen && this.slashMenu) {
        lines.push('');
        const v = this.slashMenu.visible();
        if (this.slashMenu.isEmpty) {
          lines.push(paint(this.theme, 'grey', '  no matching command'));
        } else {
          if (v.hasAbove) lines.push(paint(this.theme, 'grey', '  ↑ more'));
          for (const item of v.items) {
            const isSel = this.slashMenu.selected?.id === item.id;
            const pointer = isSel ? paint(this.theme, 'cyan', '›') : ' ';
            const label = isSel ? paint(this.theme, 'bold', item.label) : item.label;
            const pad = ' '.repeat(Math.max(1, 14 - item.label.length));
            lines.push(truncateToWidth(`  ${pointer} ${label}${pad}${paint(this.theme, 'grey', item.description ?? '')}`, width));
          }
          if (v.hasBelow) lines.push(paint(this.theme, 'grey', '  ↓ more'));
          lines.push(paint(this.theme, 'grey', '  ↑↓ select · Enter choose · Tab complete · Esc close'));
        }
      }

      lines.push(paint(this.theme, 'grey', this.statusText()));
    }

    this.screen.setTransient(lines, cursor);
  }

  private statusText(): string {
    const bits = [this.status.approval, this.status.engine, `web ${this.status.web ? 'on' : 'off'}`];
    if (this.status.branch) bits.push(this.status.branch);
    return `  ${bits.join(' · ')}`;
  }
}
