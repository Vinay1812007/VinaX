/**
 * `vinax mcp list | add | remove`.
 *
 * Adding a server means telling VinaX to start a program on this machine and
 * let the model call into it, so the command says exactly that when it writes
 * the entry. Nothing is installed, nothing is downloaded, and nothing is
 * authenticated on the user's behalf.
 */
import { McpRegistry, type McpServerConfig } from '../tools/mcp/client.js';
import { paths } from '../config/paths.js';
import { glyphs, paint, type Theme } from '../terminal/render.js';
import { EXIT, type ExitCode } from '../utils/exit.js';

export async function mcpCommand(action: 'list' | 'add' | 'remove', rest: string[], theme: Theme): Promise<ExitCode> {
  const g = glyphs(theme);
  const servers = await McpRegistry.load();

  if (action === 'list') {
    if (!servers.length) {
      process.stdout.write(`No MCP servers configured (${paths().mcp}).\n`);
      process.stdout.write('Add one with: vinax mcp add <name> <command> [args…]\n');
      return EXIT.ok;
    }
    process.stdout.write(`${paint(theme, 'bold', 'MCP servers')}\n`);
    for (const s of servers) {
      const state = s.enabled === false ? paint(theme, 'grey', ' (disabled)') : '';
      process.stdout.write(`  ${g.bullet} ${s.name}${state}\n`);
      process.stdout.write(`      ${paint(theme, 'grey', [s.command, ...s.args].join(' '))}\n`);
    }
    process.stdout.write(`${paint(theme, 'grey', `  ${paths().mcp}`)}\n`);
    return EXIT.ok;
  }

  if (action === 'remove') {
    const name = rest[0];
    if (!name) {
      process.stderr.write('Usage: vinax mcp remove <name>\n');
      return EXIT.usage;
    }
    const next = servers.filter((s) => s.name !== name);
    if (next.length === servers.length) {
      process.stderr.write(`No MCP server called "${name}".\n`);
      return EXIT.usage;
    }
    await McpRegistry.save(next);
    process.stdout.write(`Removed MCP server "${name}".\n`);
    return EXIT.ok;
  }

  const [name, command, ...args] = rest;
  if (!name || !command) {
    process.stderr.write('Usage: vinax mcp add <name> <command> [args…]\n');
    return EXIT.usage;
  }
  if (!/^[\w-]{1,32}$/.test(name)) {
    process.stderr.write('An MCP server name may contain letters, digits, hyphens and underscores only.\n');
    return EXIT.usage;
  }
  if (servers.some((s) => s.name === name)) {
    process.stderr.write(`An MCP server called "${name}" already exists. Remove it first.\n`);
    return EXIT.usage;
  }
  const entry: McpServerConfig = { name, command, args, enabled: true };
  await McpRegistry.save([...servers, entry]);
  process.stdout.write(`Added MCP server "${name}".\n`);
  process.stdout.write(
    `${paint(theme, 'grey', '  VinaX will start this program locally and let the model call its tools.')}\n`,
  );
  process.stdout.write(
    `${paint(theme, 'grey', '  Every call still goes through the same approval prompts as a built-in tool.')}\n`,
  );
  return EXIT.ok;
}
