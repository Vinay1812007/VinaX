/**
 * Slash commands.
 *
 * Each one does exactly one thing, and the name says which. There is no
 * command that means different things depending on context, because the point
 * of a slash command is that you can type it without thinking about state.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalMode } from '../config/args.js';
import { compact } from '../agent/context.js';
import { starterInstructions } from '../context/discovery.js';
import { glyphs, paint } from './render.js';
import type { SessionController } from '../commands/controller.js';

export interface SlashOutcome {
  handled: boolean;
  /** Set when the command asks the session to end. */
  exit?: boolean;
  /** Text to send to the agent instead (e.g. after @file expansion). */
  forward?: string;
}

export const SLASH_COMMANDS: Array<{ name: string; args?: string; help: string }> = [
  { name: '/help', help: 'Show this list' },
  { name: '/models', help: 'List VinaX engines and the live model menus' },
  { name: '/model', args: '<id>', help: 'Choose a model on a model-selectable engine' },
  { name: '/engine', args: '<id>', help: 'Switch engine' },
  { name: '/web', args: 'on|off', help: 'Turn live web search on or off' },
  { name: '/status', help: 'What VinaX is doing, and what it has done' },
  { name: '/diff', help: 'Show the working-tree diff' },
  { name: '/permissions', args: '[ask|auto-edit|full-auto]', help: 'Show or change the approval mode' },
  { name: '/files', help: 'Files VinaX has changed this session' },
  { name: '/compact', help: 'Summarise the conversation to free context' },
  { name: '/undo', help: 'Undo the most recent VinaX edit' },
  { name: '/clear', help: 'Start a fresh conversation in this directory' },
  { name: '/sessions', help: 'List saved sessions' },
  { name: '/resume', args: '<id>', help: 'Resume a saved session' },
  { name: '/init', help: 'Write a starter VINAX.md for this project' },
  { name: '/mcp', help: 'Show configured external tool servers' },
  { name: '/doctor', help: 'Check the local setup' },
  { name: '/version', help: 'Show the VinaX CLI version' },
  { name: '/exit', help: 'Leave VinaX CLI' },
];

/** Names for autocomplete. */
export function completions(prefix: string): string[] {
  return SLASH_COMMANDS.map((c) => c.name).filter((n) => n.startsWith(prefix));
}

const APPROVALS: ApprovalMode[] = ['ask', 'auto-edit', 'full-auto'];

export async function handleSlash(line: string, ctl: SessionController): Promise<SlashOutcome> {
  if (!line.startsWith('/')) return { handled: false };
  const [rawCmd, ...rest] = line.trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const arg = rest.join(' ').trim();
  const { out, theme } = ctl;
  const g = glyphs(theme);

  switch (cmd) {
    case '/help': {
      const width = Math.max(...SLASH_COMMANDS.map((c) => `${c.name} ${c.args ?? ''}`.trim().length));
      out.print('');
      out.print(paint(theme, 'bold', 'Commands'));
      for (const c of SLASH_COMMANDS) {
        const label = `${c.name} ${c.args ?? ''}`.trim();
        out.print(`  ${label.padEnd(width)}  ${paint(theme, 'grey', c.help)}`);
      }
      out.print('');
      out.print(paint(theme, 'grey', '  Reference a file with @path — for example: @src/index.ts explain this'));
      out.print(paint(theme, 'grey', '  Ctrl+C interrupts the current turn; press it again at the prompt to exit.'));
      out.print('');
      return { handled: true };
    }

    case '/version':
      out.print(`VinaX CLI ${ctl.version}`);
      return { handled: true };

    case '/exit':
    case '/quit':
      return { handled: true, exit: true };

    case '/engine': {
      if (!arg) {
        out.print(`Engine: ${ctl.config.engine}`);
        return { handled: true };
      }
      const meta = await ctl.meta();
      const engine = meta?.engines.find((e) => e.id === arg.toLowerCase());
      if (!engine) {
        out.print(`No engine called "${arg}". Try /models.`);
        return { handled: true };
      }
      if (!engine.available) {
        out.print(`${engine.label} is not configured on the VinaX service right now.`);
        return { handled: true };
      }
      ctl.config.engine = engine.id;
      if (!engine.acceptsModel) ctl.config.model = null;
      out.print(`Engine: ${engine.label}`);
      return { handled: true };
    }

    case '/model': {
      const meta = await ctl.meta();
      const engine = meta?.engines.find((e) => e.id === ctl.config.engine);
      if (!engine?.acceptsModel) {
        out.print(`The ${engine?.label ?? ctl.config.engine} engine does not take a model id. Switch to a model-selectable engine first (/models).`);
        return { handled: true };
      }
      if (!arg) {
        out.print(`Model: ${ctl.config.model ?? '(the engine picks)'}`);
        return { handled: true };
      }
      ctl.config.model = arg;
      out.print(`Model: ${arg} (the service validates it on the next message)`);
      return { handled: true };
    }

    case '/models': {
      await ctl.showModels();
      return { handled: true };
    }

    case '/web': {
      const want = arg.toLowerCase();
      if (want !== 'on' && want !== 'off') {
        out.print(`Web search is ${ctl.config.web ? 'on' : 'off'}. Use /web on or /web off.`);
        return { handled: true };
      }
      ctl.config.web = want === 'on';
      out.print(`Web search ${ctl.config.web ? 'on' : 'off'}.`);
      return { handled: true };
    }

    case '/permissions': {
      if (!arg) {
        out.print(`Approval mode: ${ctl.permissions.approvalMode}`);
        const grants = ctl.permissions.grantedScopes();
        if (grants.length) {
          out.print(paint(theme, 'grey', `  granted this session: ${grants.join(', ')}`));
        }
        out.print(paint(theme, 'grey', `  change with /permissions ${APPROVALS.join('|')}`));
        return { handled: true };
      }
      const mode = arg.toLowerCase() as ApprovalMode;
      if (!APPROVALS.includes(mode)) {
        out.print(`Approval mode must be one of ${APPROVALS.join(', ')}.`);
        return { handled: true };
      }
      ctl.permissions.setMode(mode);
      ctl.config.approval = mode;
      out.print(`Approval mode: ${mode}`);
      return { handled: true };
    }

    case '/status': {
      ctl.printStatus();
      return { handled: true };
    }

    case '/files': {
      const files = ctl.journal.changedFiles();
      if (!files.length) {
        out.print('VinaX has not changed any files this session.');
        return { handled: true };
      }
      out.print(paint(theme, 'bold', 'Changed by VinaX'));
      for (const f of files) out.print(`  ${g.bullet} ${f}`);
      return { handled: true };
    }

    case '/diff': {
      await ctl.showDiff();
      return { handled: true };
    }

    case '/compact': {
      const result = compact(ctl.conversation, ctl.ledger, { force: true, keepRecent: 4 });
      if (!result.summary) {
        out.print('There is not enough conversation to compact yet.');
        return { handled: true };
      }
      ctl.conversation.length = 0;
      ctl.conversation.push(...result.turns);
      out.print(
        `Compacted: ${result.droppedTurns} turns replaced by a factual summary (${result.tokensBefore.toLocaleString('en-US')} → ${result.tokensAfter.toLocaleString('en-US')} estimated tokens).`,
      );
      return { handled: true };
    }

    case '/undo': {
      const result = await ctl.undo();
      if (!result.ok) {
        out.print(`${paint(theme, 'yellow', g.warn)} ${result.reason}`);
        return { handled: true };
      }
      for (const r of result.restored) {
        out.print(`${paint(theme, 'green', g.ok)} ${r.display} ${r.action === 'removed' ? 'removed again' : 'restored'}`);
      }
      return { handled: true };
    }

    case '/clear': {
      ctl.conversation.length = 0;
      ctl.resetLedger();
      out.print('Conversation cleared. The workspace and your files are untouched.');
      return { handled: true };
    }

    case '/sessions': {
      await ctl.showSessions();
      return { handled: true };
    }

    case '/resume': {
      if (!arg) {
        out.print('Usage: /resume <session-id>. See /sessions for the list.');
        return { handled: true };
      }
      const loaded = await ctl.resume(arg);
      out.print(loaded ? `Resumed session ${arg}.` : `No session called ${arg}.`);
      return { handled: true };
    }

    case '/init': {
      const file = join(ctl.discovery.workspaceRoot, 'VINAX.md');
      if (ctl.discovery.instructionFiles.includes('VINAX.md')) {
        out.print('This project already has a VINAX.md. VinaX has not overwritten it.');
        return { handled: true };
      }
      await writeFile(file, starterInstructions(ctl.discovery), 'utf8');
      ctl.discovery.instructionFiles.push('VINAX.md');
      out.print(`${paint(theme, 'green', g.ok)} Wrote VINAX.md — edit it to describe this project's conventions.`);
      return { handled: true };
    }

    case '/mcp': {
      ctl.showMcp();
      return { handled: true };
    }

    case '/doctor': {
      await ctl.runDoctor();
      return { handled: true };
    }

    default:
      out.print(`Unknown command ${cmd}. Try /help.`);
      return { handled: true };
  }
}
