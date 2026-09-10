/**
 * Turning agent events into something a human — or a pipeline — can read.
 *
 * Two implementations of the same two interfaces:
 *
 *   TerminalOutput  streaming prose, step lines, coloured diffs, live command
 *                   output. What an interactive session shows.
 *   JsonOutput      one JSON object per line on stdout, nothing else. What
 *                   `--json` emits, with a versioned schema, so automation
 *                   never has to parse English.
 *
 * Both write diagnostics to stderr and results to stdout, so `vinax --json -p
 * "…" > events.jsonl` produces a clean file even when something goes wrong.
 */
import type { AgentObserver } from '../agent/loop.js';
import type { ToolUi } from '../tools/types.js';
import { JSON_SCHEMA_VERSION } from '../protocol/events.js';
import { glyphs, paint, renderDiff, renderMarkdown, type Theme } from './render.js';
import { describeToolDone } from './activity.js';
import type { TerminalApp } from './app.js';

export interface Output extends AgentObserver, ToolUi {
  /** A line of ordinary CLI chrome (headers, notices). */
  print(text: string): void;
  /** Diagnostics — always stderr. */
  problem(text: string): void;
  /** Called once the run is over, before the summary. */
  finish(): void;
}

export class TerminalOutput implements Output {
  private streaming = false;
  private lastWasStep = false;
  /** Live command output is echoed in a dimmed, indented gutter. */
  private commandGutterOpen = false;

  constructor(
    private readonly theme: Theme,
    private readonly opts: { showCommandOutput: boolean } = { showCommandOutput: true },
  ) {}

  private w(text: string): void {
    process.stdout.write(text);
  }

  print(text: string): void {
    this.closeGutter();
    this.w(`${text}\n`);
    this.lastWasStep = false;
  }

  problem(text: string): void {
    this.closeGutter();
    process.stderr.write(`${text}\n`);
  }

  private closeGutter(): void {
    if (!this.commandGutterOpen) return;
    this.commandGutterOpen = false;
    this.w('\n');
  }

  engine(info: { engine: string; label: string; model: string; web: boolean }): void {
    // The engine line is only interesting when it is not what was asked for
    // (AUTO resolved a seat) or when a specific model is in play.
    if (this.theme.color) {
      this.print(paint(this.theme, 'grey', `  ${info.label}${info.model ? ` · ${info.model}` : ''}${info.web ? ' · web on' : ''}`));
    }
  }

  status(status: string): void {
    if (status === 'thinking' && !this.lastWasStep) {
      const g = glyphs(this.theme);
      this.print(paint(this.theme, 'grey', `${g.step} Thinking`));
      this.lastWasStep = true;
    }
  }

  assistantDelta(text: string): void {
    this.closeGutter();
    if (!this.streaming) {
      this.streaming = true;
      this.w('\n');
    }
    // Streamed straight through: buffering to render Markdown would mean the
    // user waits for the whole reply before seeing a word of it.
    this.w(text);
  }

  assistantEnd(): void {
    if (!this.streaming) return;
    this.streaming = false;
    this.w('\n\n');
    this.lastWasStep = false;
  }

  step(text: string): void {
    this.closeGutter();
    const g = glyphs(this.theme);
    this.w(`${paint(this.theme, 'grey', g.step)} ${text}\n`);
    this.lastWasStep = true;
  }

  note(text: string): void {
    this.closeGutter();
    this.w(`${paint(this.theme, 'grey', `  ${text}`)}\n`);
  }

  stream(chunk: string, source: 'stdout' | 'stderr'): void {
    if (!this.opts.showCommandOutput) return;
    this.commandGutterOpen = true;
    const g = glyphs(this.theme);
    const painted = chunk
      .split('\n')
      .map((l) => (l ? paint(this.theme, source === 'stderr' ? 'yellow' : 'grey', `  ${g.vbar} ${l}`) : ''))
      .join('\n');
    this.w(painted);
  }

  diff(_path: string, unified: string): void {
    if (!unified) return;
    this.closeGutter();
    this.w(`${renderDiff(unified.split('\n').slice(0, 40).join('\n'), this.theme)}\n`);
  }

  toolCall(): void {
    // The individual tools narrate themselves through step(); a second line
    // here would double every action.
  }

  toolResult(result: { id: string; name: string; ok: boolean; content: string }): void {
    this.closeGutter();
    if (result.ok) return;
    const g = glyphs(this.theme);
    const firstLine = result.content.split('\n')[0].slice(0, 160);
    this.w(`${paint(this.theme, 'red', g.fail)} ${firstLine}\n`);
  }

  usage(): void {
    // Totals are reported once, in the summary, rather than after every step.
  }

  warning(w: { code: string; message: string }): void {
    const g = glyphs(this.theme);
    this.problem(`${paint(this.theme, 'yellow', g.warn)} ${w.message}`);
  }

  error(e: { code: string; message: string; recoverable: boolean }): void {
    const g = glyphs(this.theme);
    // A recoverable protocol error is something the model will retry from;
    // shouting about it would be noise.
    if (e.recoverable) {
      this.problem(paint(this.theme, 'grey', `  ${e.message}`));
      return;
    }
    this.problem(`${paint(this.theme, 'red', g.fail)} ${e.message}`);
  }

  permissionRequired(info: { action: string; message: string }): void {
    this.problem(`${paint(this.theme, 'yellow', glyphs(this.theme).ask)} ${info.message}`);
  }

  compacted(info: { droppedTurns: number; tokensBefore: number; tokensAfter: number }): void {
    this.note(
      `Context compacted: ${info.droppedTurns} earlier turns replaced by a factual summary (${info.tokensBefore.toLocaleString('en-US')} → ${info.tokensAfter.toLocaleString('en-US')} tokens).`,
    );
  }

  renderReply(text: string): void {
    this.print(renderMarkdown(text, this.theme));
  }

  finish(): void {
    this.assistantEnd();
    this.closeGutter();
  }
}

/** One JSON object per line. The schema is versioned by the `v` field. */
export class JsonOutput implements Output {
  private buffered = '';

  private emit(obj: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify({ v: JSON_SCHEMA_VERSION, ...obj })}\n`);
  }

  print(): void {
    // Chrome has no place in a machine stream.
  }

  problem(text: string): void {
    process.stderr.write(`${text}\n`);
  }

  engine(info: { engine: string; label: string; model: string; web: boolean }): void {
    this.emit({ type: 'engine', ...info });
  }

  status(status: string): void {
    this.emit({ type: 'status', status });
  }

  assistantDelta(text: string): void {
    this.buffered += text;
    this.emit({ type: 'assistant_delta', text });
  }

  assistantEnd(): void {
    this.buffered = '';
  }

  step(text: string): void {
    this.emit({ type: 'status', status: 'tool', detail: text });
  }

  note(text: string): void {
    this.emit({ type: 'status', status: 'note', detail: text });
  }

  stream(chunk: string, source: 'stdout' | 'stderr'): void {
    this.emit({ type: 'command_output', source, text: chunk });
  }

  diff(path: string, unified: string): void {
    this.emit({ type: 'diff', path, diff: unified });
  }

  toolCall(call: { id: string; name: string; arguments: Record<string, unknown> }): void {
    this.emit({ type: 'tool_call', id: call.id, tool: call.name, arguments: call.arguments });
  }

  toolResult(result: { id: string; name: string; ok: boolean; content: string }): void {
    this.emit({ type: 'tool_result', id: result.id, tool: result.name, ok: result.ok, content: result.content });
  }

  usage(u: { inputTokens: number; outputTokens: number }): void {
    this.emit({ type: 'usage', inputTokens: u.inputTokens, outputTokens: u.outputTokens });
  }

  warning(w: { code: string; message: string }): void {
    this.emit({ type: 'warning', code: w.code, message: w.message });
  }

  error(e: { code: string; message: string; recoverable: boolean }): void {
    this.emit({ type: 'error', code: e.code, message: e.message, recoverable: e.recoverable });
  }

  permissionRequired(info: { action: string; message: string }): void {
    this.emit({ type: 'permission_required', action: info.action, message: info.message });
  }

  compacted(info: { droppedTurns: number; tokensBefore: number; tokensAfter: number }): void {
    this.emit({ type: 'status', status: 'compacted', ...info });
  }

  final(text: string): void {
    this.emit({ type: 'final', text });
  }

  finish(): void {
    /* nothing buffered to flush */
  }
}

/** Plain text mode: prose on stdout, step lines on stderr, no colour codes. */
export class PlainOutput extends TerminalOutput {
  constructor(theme: Theme) {
    super({ ...theme, color: false }, { showCommandOutput: false });
  }
}

/**
 * The interactive output: every event becomes TerminalApp state.
 *
 * Nothing here writes escape sequences or moves the cursor — it emits
 * semantic events and lets the app decide what the terminal looks like. That
 * is the whole point of having one owner.
 */
export class InteractiveOutput implements Output {
  /** Tool arguments by call id, so a finished tool can be described in the
   *  past tense with the same detail the running line had. */
  private readonly pending = new Map<string, { name: string; args: Record<string, unknown> }>();
  /** True once any assistant text has been shown this turn. */
  private streamed = false;
  private streaming = false;

  constructor(private readonly app: TerminalApp, private readonly theme: Theme) {}

  /** Did the user already see the answer stream? Guards the duplicate print. */
  streamedAnything(): boolean {
    return this.streamed;
  }

  resetTurn(): void {
    this.streamed = false;
    this.streaming = false;
  }

  print(text: string): void {
    this.app.writeTranscript(text);
  }

  problem(text: string): void {
    // Diagnostics belong on stderr, but in an interactive session they must
    // still pass through the app or they land inside the live region.
    this.app.writeTranscript(text);
  }

  engine(info: { engine: string; label: string; model: string; web: boolean }): void {
    this.app.setStatus({ engine: info.label || info.engine, web: info.web });
  }

  status(status: string): void {
    if (status === 'thinking') this.app.beginActivity('Thinking');
  }

  assistantDelta(text: string): void {
    if (!text) return;
    // The first token ends the thinking animation: a spinner must never run
    // over streaming text.
    if (!this.streaming) {
      this.app.cancelActivity();
      this.app.writeRaw('\n');
      this.streaming = true;
      this.streamed = true;
    }
    this.app.writeRaw(text);
  }

  assistantEnd(): void {
    if (!this.streaming) return;
    this.streaming = false;
    this.app.writeRaw('\n\n');
  }

  step(text: string): void {
    // A tool narrating its own progress relabels the live activity rather
    // than adding another permanent line — but NOT while a tool activity is
    // already running. Those labels are written for a plain log ("Read
    // src/a.ts") and would put past tense on a spinner that is still going.
    if (this.app.hasActivity) return;
    this.app.beginActivity(text);
  }

  note(text: string): void {
    this.app.writeTranscript(paint(this.theme, 'grey', `  ${text}`));
  }

  stream(chunk: string, source: 'stdout' | 'stderr'): void {
    const g = glyphs(this.theme);
    const body = chunk
      .split('\n')
      .map((l) => (l ? paint(this.theme, source === 'stderr' ? 'yellow' : 'grey', `  ${g.vbar} ${l}`) : ''))
      .join('\n');
    this.app.writeRaw(body);
  }

  diff(_path: string, unified: string): void {
    if (!unified) return;
    this.app.writeTranscript(renderDiff(unified.split('\n').slice(0, 40).join('\n'), this.theme));
  }

  toolCall(call: { id: string; name: string; arguments: Record<string, unknown> }): void {
    this.pending.set(call.id, { name: call.name, args: call.arguments });
    this.app.beginToolActivity(call.name, call.arguments);
  }

  toolResult(result: { id: string; name: string; ok: boolean; content: string }): void {
    const info = this.pending.get(result.id);
    this.pending.delete(result.id);
    const label = info ? describeToolDone(info.name, info.args) : result.name;
    if (result.ok) {
      this.app.endActivity('ok', label);
      return;
    }
    this.app.endActivity('failed', label, firstLine(result.content));
  }

  usage(): void {
    // Totals are reported once in the summary, not after every step.
  }

  warning(w: { code: string; message: string }): void {
    const g = glyphs(this.theme);
    this.app.writeTranscript(`${paint(this.theme, 'yellow', g.warn)} ${w.message}`);
  }

  error(e: { code: string; message: string; recoverable: boolean }): void {
    if (e.recoverable) {
      this.app.writeTranscript(paint(this.theme, 'grey', `  ${e.message}`));
      return;
    }
    this.app.endActivity('failed', e.message);
  }

  permissionRequired(info: { action: string; message: string }): void {
    const g = glyphs(this.theme);
    this.app.writeTranscript(`${paint(this.theme, 'yellow', g.ask)} ${info.message}`);
  }

  compacted(info: { droppedTurns: number; tokensBefore: number; tokensAfter: number }): void {
    this.note(
      `Context compacted: ${info.droppedTurns} earlier turns replaced by a factual summary (${info.tokensBefore.toLocaleString('en-US')} → ${info.tokensAfter.toLocaleString('en-US')} tokens).`,
    );
  }

  renderReply(text: string): void {
    this.app.writeTranscript(renderMarkdown(text, this.theme));
  }

  finish(): void {
    this.assistantEnd();
  }
}

/** First meaningful line of a failure, for the one-line activity result. */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.slice(0, 120);
}
