/**
 * The interactive terminal layer: editor, menu, slash picker, activity.
 *
 * Everything here is driven through the same path the real terminal uses —
 * bytes in, rendered lines out — with injected streams and an injected clock,
 * so the assertions are exact and no test waits on a real timer.
 */
import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { LineEditor } from '../src/terminal/editor.js';
import { Menu, type MenuItem } from '../src/terminal/menu.js';
import { TerminalApp } from '../src/terminal/app.js';
import { Activity, describeTool, describeToolDone, formatElapsed, type Clock } from '../src/terminal/activity.js';
import { Screen } from '../src/terminal/screen.js';
import { hasAnsi, stripAnsi } from '../src/terminal/ansi.js';
import { displayWidth, graphemes, truncateToWidth } from '../src/terminal/width.js';
import type { Theme } from '../src/terminal/render.js';

const ESC = '\u001b';
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;
const ENTER = '\r';
const TAB = '\t';
const BACKSPACE = '\u007f';
const ctrl = (l: string): string => String.fromCharCode(l.charCodeAt(0) - 96);

const THEME: Theme = { color: false, width: 80, unicode: true };

/** An app wired to capture output instead of printing it. */
function makeApp(opts: { interactive?: boolean } = {}) {
  const chunks: string[] = [];
  const out = new PassThrough() as unknown as NodeJS.WriteStream;
  out.write = ((t: string) => { chunks.push(String(t)); return true; }) as NodeJS.WriteStream['write'];
  Object.defineProperty(out, 'columns', { value: 80, configurable: true });
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const app = new TerminalApp({
    theme: THEME,
    input,
    output: out,
    interactive: opts.interactive ?? true,
  });
  return { app, chunks, rendered: (): string => stripAnsi(chunks.join('')) };
}

describe('the line editor', () => {
  it('inserts text at the visible cursor after arrow movement', () => {
    // The acceptance case: type, move left five times, type again.
    const ed = new LineEditor();
    ed.insert('hello');
    for (let i = 0; i < 5; i += 1) ed.left();
    ed.insert('VinaX-');
    expect(ed.value).toBe('VinaX-hello');

    const ed2 = new LineEditor();
    ed2.insert('hello');
    ed2.left();
    ed2.left();
    ed2.insert('X');
    expect(ed2.value).toBe('helXlo');
  });

  it('clamps movement at both ends', () => {
    const ed = new LineEditor();
    ed.insert('ab');
    ed.left(); ed.left(); ed.left(); ed.left();
    expect(ed.cursor).toBe(0);
    ed.right(); ed.right(); ed.right();
    expect(ed.cursor).toBe(2);
  });

  it('deletes before and at the cursor', () => {
    const ed = new LineEditor();
    ed.insert('abcd');
    ed.left();
    ed.backspace();
    expect(ed.value).toBe('abd');
    ed.deleteForward();
    expect(ed.value).toBe('ab');
  });

  it('supports the readline editing shortcuts', () => {
    const ed = new LineEditor();
    ed.insert('npm run build');
    ed.home();
    expect(ed.cursor).toBe(0);
    ed.end();
    expect(ed.cursor).toBe(13);

    ed.killWordBefore();
    expect(ed.value).toBe('npm run ');

    ed.setValue('npm run build', 8);
    ed.killBefore();
    expect(ed.value).toBe('build');

    ed.setValue('npm run build', 4);
    ed.killAfter();
    expect(ed.value).toBe('npm ');
  });

  it('moves by words, skipping the whitespace between them', () => {
    const ed = new LineEditor();
    ed.setValue('npm run build ');
    ed.wordLeft();
    expect(ed.value.slice(ed.cursor)).toBe('build ');
    ed.wordLeft();
    expect(ed.value.slice(ed.cursor)).toBe('run build ');
    ed.wordRight();
    expect(ed.cursor).toBe(7);
  });

  it('treats an emoji as ONE character, and measures it as two columns', () => {
    const ed = new LineEditor();
    ed.insert('hi 👋');
    expect(graphemes(ed.value)).toHaveLength(4);
    ed.left();
    expect(ed.cursor, 'one Left crosses the whole emoji').toBe(3);
    ed.right();
    ed.backspace();
    // A cursor counted in UTF-16 units would have split the surrogate pair
    // here and left a lone half behind.
    expect(ed.value).toBe('hi ');
    expect(displayWidth('hi 👋')).toBe(5);
  });

  it('walks history up and down, returning to the unsent draft', () => {
    const ed = new LineEditor();
    ed.remember('first prompt');
    ed.remember('second prompt');
    ed.insert('draft in progress');

    ed.historyPrev();
    expect(ed.value).toBe('second prompt');
    ed.historyPrev();
    expect(ed.value).toBe('first prompt');
    expect(ed.historyPrev()).toBe(false);

    ed.historyNext();
    expect(ed.value).toBe('second prompt');
    ed.historyNext();
    expect(ed.value).toBe('draft in progress');
    expect(ed.historyNext()).toBe(false);
  });

  it('collapses consecutive duplicate history entries', () => {
    const ed = new LineEditor();
    ed.remember('npm test');
    ed.remember('npm test');
    expect(ed.historyEntries()).toEqual(['npm test']);
  });

  it('reports the cursor by logical line for multi-line input', () => {
    const ed = new LineEditor();
    ed.insert('first\nsec');
    expect(ed.cursorPosition()).toEqual({ line: 1, column: 3 });
    expect(ed.lines()).toEqual(['first', 'sec']);
  });
});

describe('the menu', () => {
  const items: Array<MenuItem<string>> = [
    { id: 'a', label: 'alpha', description: 'first', value: 'a' },
    { id: 'b', label: 'beta', description: 'second', value: 'b' },
    { id: 'c', label: 'gamma', description: 'third', disabled: true, value: 'c' },
    { id: 'd', label: 'delta', description: 'fourth', value: 'd' },
  ];

  it('starts on the first enabled item', () => {
    const m = new Menu(items);
    expect(m.selected?.id).toBe('a');
  });

  it('moves down and up, SKIPPING disabled entries', () => {
    const m = new Menu(items);
    m.next();
    expect(m.selected?.id).toBe('b');
    m.next();
    expect(m.selected?.id, 'gamma is disabled and must be skipped').toBe('d');
    m.prev();
    expect(m.selected?.id).toBe('b');
  });

  it('wraps at the ends', () => {
    const m = new Menu(items);
    m.prev();
    expect(m.selected?.id).toBe('d');
    m.next();
    expect(m.selected?.id).toBe('a');
  });

  it('clamps instead of wrapping when told to', () => {
    const m = new Menu(items, { wrap: false });
    m.prev();
    expect(m.selected?.id).toBe('a');
  });

  it('filters live on label and description', () => {
    const m = new Menu(items);
    m.setFilter('bet');
    expect(m.items.map((i) => i.id)).toEqual(['b']);
    m.setFilter('third');
    expect(m.items.map((i) => i.id)).toEqual(['c']);
    m.setFilter('');
    expect(m.items).toHaveLength(4);
  });

  it('scrolls, keeping the selection visible', () => {
    const many: Array<MenuItem<number>> = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), label: `item ${i}`, value: i,
    }));
    const m = new Menu(many, { maxVisible: 5 });
    expect(m.visible().items).toHaveLength(5);
    expect(m.visible().hasAbove).toBe(false);
    expect(m.visible().hasBelow).toBe(true);

    for (let i = 0; i < 7; i += 1) m.next();
    const v = m.visible();
    expect(v.items.some((i) => i.id === String(m.selectedIndex))).toBe(true);
    expect(v.hasAbove).toBe(true);
  });

  it('pages and jumps to the ends', () => {
    const many: Array<MenuItem<number>> = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), label: `item ${i}`, value: i,
    }));
    const m = new Menu(many, { maxVisible: 5 });
    m.pageDown();
    expect(m.selectedIndex).toBe(5);
    m.pageUp();
    expect(m.selectedIndex).toBe(0);
    m.last();
    expect(m.selectedIndex).toBe(19);
    m.first();
    expect(m.selectedIndex).toBe(0);
  });

  it('reports an empty result rather than pretending to have a selection', () => {
    const m = new Menu(items);
    m.setFilter('nothing matches this');
    expect(m.isEmpty).toBe(true);
    expect(m.selected).toBeNull();
  });
});

describe('the live slash menu', () => {
  const commands: Array<MenuItem<string>> = [
    { id: '/help', label: '/help', description: 'Show commands', value: '/help' },
    { id: '/engine', label: '/engine', description: 'Change VinaX engine', value: '/engine' },
    { id: '/permissions', label: '/permissions', description: 'Change approval mode', value: '/permissions' },
    { id: '/status', label: '/status', description: 'Current task status', value: '/status' },
  ];

  const openApp = () => {
    const h = makeApp();
    h.app.setSlashCommands(commands);
    h.app.start();
    return h;
  };

  it('opens the moment "/" is typed — no Tab required', () => {
    const h = openApp();
    const done = h.app.readLine();
    h.chunks.length = 0;
    h.app.feed('/');
    const out = h.rendered();
    expect(out).toContain('/help');
    expect(out).toContain('/engine');
    expect(out).toContain('Change approval mode');
    void done;
  });

  it('filters live as more is typed', () => {
    const h = openApp();
    void h.app.readLine();
    h.app.feed('/per');
    h.chunks.length = 0;
    h.app.feed('m');
    const out = h.rendered();
    expect(out).toContain('/permissions');
    expect(out).not.toContain('/status');
  });

  it('moves the selection with Down and Up', () => {
    const h = openApp();
    void h.app.readLine();
    h.app.feed('/');
    h.chunks.length = 0;
    h.app.feed(DOWN);
    // The pointer marks the selected row; after one Down it is on /engine.
    const afterDown = h.rendered();
    const engineLine = afterDown.split('\n').find((l) => l.includes('/engine')) ?? '';
    expect(engineLine).toContain('›');

    h.chunks.length = 0;
    h.app.feed(UP);
    const afterUp = h.rendered();
    const helpLine = afterUp.split('\n').find((l) => l.includes('/help')) ?? '';
    expect(helpLine).toContain('›');
  });

  it('Enter runs the selected command', async () => {
    const h = openApp();
    const line = h.app.readLine();
    h.app.feed('/');
    h.app.feed(DOWN);
    h.app.feed(ENTER);
    await expect(line).resolves.toBe('/engine');
  });

  it('Tab completes without submitting', () => {
    const h = openApp();
    void h.app.readLine();
    h.app.feed('/eng');
    h.chunks.length = 0;
    h.app.feed(TAB);
    expect(h.rendered()).toContain('/engine');
  });

  it('Esc closes the menu and leaves the typed text intact', () => {
    const h = openApp();
    void h.app.readLine();
    h.app.feed('/hel');
    h.chunks.length = 0;
    h.app.feed(ESC);
    h.app.flushKeys();
    const out = h.rendered();
    expect(out).toContain('/hel');
    expect(out).not.toContain('Show commands');
  });

  it('closes once the command has an argument', () => {
    const h = openApp();
    void h.app.readLine();
    h.app.feed('/engine');
    h.chunks.length = 0;
    h.app.feed(' ');
    expect(h.rendered()).not.toContain('Change VinaX engine');
  });
});

describe('typing through the app', () => {
  it('NEVER puts an escape sequence into the submitted line', async () => {
    const h = makeApp();
    h.app.start();
    const line = h.app.readLine();
    h.app.feed('hello world');
    for (let i = 0; i < 5; i += 1) h.app.feed(LEFT);
    h.app.feed('VinaX-');
    h.app.feed(ENTER);
    const value = await line;
    expect(value).toBe('hello VinaX-world');
    expect(value).not.toContain(ESC);
    expect(value).not.toMatch(/\[[ABCD]/);
  });

  it('edits with Backspace and Right after moving left', async () => {
    const h = makeApp();
    h.app.start();
    const line = h.app.readLine();
    h.app.feed('abcd');
    h.app.feed(LEFT);
    h.app.feed(BACKSPACE);
    h.app.feed(RIGHT);
    h.app.feed('Z');
    h.app.feed(ENTER);
    await expect(line).resolves.toBe('abdZ');
  });

  it('walks history with the arrow keys', async () => {
    const h = makeApp();
    h.app.start();
    const first = h.app.readLine();
    h.app.feed('first prompt');
    h.app.feed(ENTER);
    await first;

    const second = h.app.readLine();
    h.app.feed(UP);
    h.app.feed(ENTER);
    await expect(second).resolves.toBe('first prompt');
  });

  it('treats a multi-line paste as text, not as several submissions', async () => {
    const h = makeApp();
    h.app.start();
    const line = h.app.readLine();
    h.app.feed(`${ESC}[200~line one\nline two${ESC}[201~`);
    h.app.feed(ENTER);
    await expect(line).resolves.toBe('line one\nline two');
  });

  it('Ctrl+J inserts a newline instead of submitting', async () => {
    const h = makeApp();
    h.app.start();
    const line = h.app.readLine();
    h.app.feed('one');
    h.app.feed(ctrl('j'));
    h.app.feed('two');
    h.app.feed(ENTER);
    await expect(line).resolves.toBe('one\ntwo');
  });

  it('Ctrl+D exits only when the line is empty', async () => {
    const h = makeApp();
    h.app.start();
    const busy = h.app.readLine();
    h.app.feed('abc');
    h.app.feed(ctrl('d'));   // deletes forward, does not exit
    h.app.feed(ENTER);
    await expect(busy).resolves.toBe('abc');

    const empty = h.app.readLine();
    h.app.feed(ctrl('d'));
    await expect(empty).resolves.toBeNull();
  });
});

describe('menus asked for by the app', () => {
  it('resolves the highlighted value on Enter', async () => {
    const h = makeApp();
    h.app.start();
    const choice = h.app.choose({
      title: 'Permission mode',
      items: [
        { id: 'ask', label: 'Ask', value: 'ask' },
        { id: 'auto-edit', label: 'Auto edit', value: 'auto-edit' },
        { id: 'full-auto', label: 'Full auto', value: 'full-auto' },
      ],
    });
    h.app.feed(DOWN);
    h.app.feed(ENTER);
    await expect(choice).resolves.toBe('auto-edit');
  });

  it('Esc cancels, which for an approval means reject', async () => {
    const h = makeApp();
    h.app.start();
    const choice = h.app.choose({
      title: 'Run command?',
      items: [{ id: 'once', label: 'Allow once', value: 'once' }, { id: 'reject', label: 'Reject', value: 'reject' }],
    });
    h.app.feed(ESC);
    h.app.flushKeys();
    await expect(choice).resolves.toBeNull();
  });

  it('Ctrl+C cancels a menu safely', async () => {
    const h = makeApp();
    h.app.start();
    const choice = h.app.choose({ title: 'x', items: [{ id: 'a', label: 'A', value: 'a' }] });
    h.app.feed(ctrl('c'));
    await expect(choice).resolves.toBeNull();
  });

  it('honours single-key shortcuts', async () => {
    const h = makeApp();
    h.app.start();
    const choice = h.app.choose({
      title: 'Run command?',
      items: [{ id: 'once', label: 'Allow once', value: 'once' }, { id: 'reject', label: 'Reject', value: 'reject' }],
      shortcuts: { y: 'once', n: 'reject' },
    });
    h.app.feed('y');
    await expect(choice).resolves.toBe('once');
  });

  it('shows the detail block above the choices', () => {
    const h = makeApp();
    h.app.start();
    void h.app.choose({
      title: 'Run command?',
      items: [{ id: 'once', label: 'Allow once', value: 'once' }],
      detail: ['  npm test', '', 'Working directory:', '  /home/u/project'],
    });
    const out = h.rendered();
    expect(out).toContain('Run command?');
    expect(out).toContain('npm test');
    expect(out).toContain('/home/u/project');
    expect(out).toContain('Allow once');
  });
});

describe('activity lines', () => {
  const fakeClock = (): Clock & { advance: (ms: number) => void } => {
    let t = 0;
    return { now: () => t, advance: (ms) => { t += ms; } };
  };

  it('advances frames while running and stops once finished', () => {
    const clock = fakeClock();
    const a = new Activity('Thinking', { clock });
    const first = a.frame;
    a.advance();
    expect(a.frame).not.toBe(first);
    a.finish('ok');
    const frozen = a.frame;
    a.advance();
    expect(a.frame, 'a finished activity must not keep animating').toBe(frozen);
    expect(a.running).toBe(false);
  });

  it('measures elapsed time from a monotonic clock', () => {
    const clock = fakeClock();
    const a = new Activity('Running npm test', { clock });
    clock.advance(3200);
    expect(a.elapsedMs()).toBe(3200);
    a.finish('ok');
    clock.advance(10_000);
    expect(a.elapsedMs(), 'a finished activity freezes its duration').toBe(3200);
  });

  it('omits a duration for work too fast to be worth one', () => {
    expect(formatElapsed(0)).toBe('');
    expect(formatElapsed(999)).toBe('');
    expect(formatElapsed(3200)).toBe('3.2s');
    expect(formatElapsed(65_000)).toBe('1m 5s');
  });

  it('describes tools the way a person reads them, not as raw JSON', () => {
    expect(describeTool('read_file', { path: 'src/auth.ts' })).toBe('Reading src/auth.ts');
    expect(describeTool('read_files', { paths: ['a', 'b', 'c', 'd'] })).toBe('Reading 4 files');
    expect(describeTool('grep', { pattern: 'token' })).toBe('Searching for "token"');
    expect(describeTool('apply_patch', { path: 'src/auth.ts' })).toBe('Editing src/auth.ts');
    expect(describeTool('run_command', { command: 'npm', args: ['test'] })).toBe('Running npm test');
    expect(describeTool('git_status', {})).toBe('Checking Git status');
    expect(describeTool('git_commit', {})).toBe('Creating commit');
    expect(describeTool('git_push', { branch: 'feature/auth-fix' })).toBe('Pushing feature/auth-fix');
    expect(describeTool('web_search', { query: 'vitest' })).toBe('Searching the web for "vitest"');
    expect(describeTool('mcp__files__read', {})).toBe('Running read on files');
  });

  it('leaves a past-tense line behind when finished', () => {
    expect(describeToolDone('read_file', { path: 'src/a.ts' })).toBe('Read src/a.ts');
    expect(describeToolDone('run_command', { command: 'npm', args: ['test'] })).toBe('Ran npm test');
    expect(describeToolDone('apply_patch', { path: 'src/a.ts' })).toBe('Updated src/a.ts');
    expect(describeToolDone('git_commit', {})).toBe('Created commit');
  });

  it('finishes into ONE permanent line and no leftover spinner frame', () => {
    const h = makeApp();
    h.app.start();
    h.app.beginActivity('Running npm test');
    h.app.tickSpinner();
    h.chunks.length = 0;
    h.app.endActivity('ok', 'Ran npm test');
    const out = h.rendered();
    expect(out).toContain('Ran npm test');
    // No spinner glyph survives into the transcript.
    expect(out).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });

  it('drops the activity with no permanent line when the model starts answering', () => {
    const h = makeApp();
    h.app.start();
    h.app.beginActivity('Thinking');
    expect(h.app.hasActivity).toBe(true);
    h.chunks.length = 0;
    h.app.cancelActivity();
    expect(h.app.hasActivity).toBe(false);
    expect(h.rendered()).not.toContain('Thinking');
  });
});

describe('non-interactive output', () => {
  it('emits NOT ONE escape byte when there is no terminal', () => {
    const h = makeApp({ interactive: false });
    h.app.start();
    h.app.beginActivity('Thinking');
    h.app.tickSpinner();
    h.app.writeTranscript('a transcript line');
    h.app.endActivity('ok', 'Done');
    h.app.stop();
    const raw = h.chunks.join('');
    expect(hasAnsi(raw), 'no cursor motion or colour may reach a pipe').toBe(false);
    expect(raw).toContain('a transcript line');
  });

  it('writes no transient region at all', () => {
    const h = makeApp({ interactive: false });
    h.app.start();
    void h.app.readLine();
    expect(h.chunks.join('')).toBe('');
  });
});

describe('the screen', () => {
  const capture = (interactive: boolean) => {
    const chunks: string[] = [];
    const s = new Screen({ write: (t) => chunks.push(t), columns: () => 80, interactive });
    return { s, chunks, text: (): string => chunks.join('') };
  };

  it('keeps permanent output out of the live region', () => {
    const c = capture(true);
    c.s.setTransient(['› prompt']);
    c.chunks.length = 0;
    c.s.writeLine('a permanent line');
    const out = stripAnsi(c.text());
    expect(out).toContain('a permanent line');
    // The prompt is redrawn after it, not overwritten by it.
    expect(out.indexOf('a permanent line')).toBeLessThan(out.lastIndexOf('› prompt'));
  });

  it('restores the terminal on shutdown', () => {
    const c = capture(true);
    c.s.setTransient(['x']);
    c.chunks.length = 0;
    c.s.shutdown();
    // Cursor shown and bracketed paste disabled — the two things that strand a
    // terminal if they are forgotten.
    expect(c.text()).toContain('?25h');
    expect(c.text()).toContain('?2004l');
  });

  it('does nothing clever on a pipe', () => {
    const c = capture(false);
    c.s.setTransient(['› prompt']);
    c.s.writeLine('plain');
    expect(c.text()).toBe('plain\n');
  });
});

describe('display width', () => {
  it('measures what the terminal draws, not string length', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本語')).toBe(6);
    expect(displayWidth('👋')).toBe(2);
    expect(displayWidth('é')).toBe(1); // e + combining acute
  });

  it('truncates on a column budget', () => {
    expect(truncateToWidth('hello world', 8)).toBe('hello w…');
    expect(truncateToWidth('short', 20)).toBe('short');
    expect(displayWidth(truncateToWidth('日本語テキスト', 6))).toBeLessThanOrEqual(6);
  });
});

describe('giving the terminal back', () => {
  it('emits the restore sequence on a normal stop', () => {
    const h = makeApp();
    h.app.start();
    h.chunks.length = 0;
    h.app.stop();
    const raw = h.chunks.join('');
    expect(raw, 'cursor must be shown again').toContain('?25h');
    expect(raw, 'bracketed paste must be turned off').toContain('?2004l');
  });

  it('registers signal handlers, because a signal never unwinds the loop', () => {
    const before = process.listenerCount('SIGTERM');
    const h = makeApp();
    h.app.start();
    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(before);
    h.app.stop();
    // …and removes them again, so repeated sessions cannot leak listeners.
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('restores the terminal from the SIGTERM handler itself', () => {
    const h = makeApp();
    const before = process.listeners('SIGTERM');
    h.app.start();
    const added = process.listeners('SIGTERM').filter((l) => !before.includes(l));
    expect(added).toHaveLength(1);

    // Run the handler exactly as the signal would, with exit stubbed so the
    // test survives it.
    const exit = process.exit;
    let exitCode: number | undefined;
    // @ts-expect-error — deliberately replacing exit for the duration
    process.exit = (code?: number) => { exitCode = code; };
    h.chunks.length = 0;
    try {
      (added[0] as (sig: string) => void)('SIGTERM');
    } finally {
      process.exit = exit;
      h.app.stop();
    }
    const raw = h.chunks.join('');
    expect(raw).toContain('?25h');
    expect(raw).toContain('?2004l');
    expect(exitCode).toBe(143);
  });

  it('enables bracketed paste only while it owns the terminal', () => {
    const h = makeApp();
    h.app.start();
    expect(h.chunks.join('')).toContain('?2004h');
    h.chunks.length = 0;
    h.app.stop();
    expect(h.chunks.join('')).toContain('?2004l');
  });

  it('never touches terminal modes without a terminal', () => {
    const h = makeApp({ interactive: false });
    const before = process.listenerCount('SIGTERM');
    h.app.start();
    expect(process.listenerCount('SIGTERM'), 'no signal hooks on a pipe').toBe(before);
    h.app.stop();
    expect(h.chunks.join('')).toBe('');
  });
});
