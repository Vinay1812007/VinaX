import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/config/args.js';

describe('CLI argument parsing', () => {
  it('defaults to an interactive run', () => {
    const a = parseArgs([]);
    expect(a.command.kind).toBe('run');
    expect(a.output).toBe('interactive');
    expect(a.prompt).toBeNull();
    expect(a.error).toBeNull();
  });

  it('treats a bare argument as a one-shot prompt', () => {
    const a = parseArgs(['explain this repository']);
    expect(a.prompt).toBe('explain this repository');
    expect(a.output).toBe('text');
  });

  it('accepts -p and --print', () => {
    expect(parseArgs(['-p', 'hello']).prompt).toBe('hello');
    expect(parseArgs(['--print', 'hello']).output).toBe('text');
  });

  it('parses exec as a subcommand with the rest as the prompt', () => {
    const a = parseArgs(['exec', 'fix', 'the', 'failing', 'tests']);
    expect(a.command.kind).toBe('exec');
    expect(a.prompt).toBe('fix the failing tests');
    expect(a.output).toBe('text');
  });

  it('keeps --json even when -p came first', () => {
    const a = parseArgs(['--json', '-p', 'inspect this repository']);
    expect(a.output).toBe('json');
    expect(a.prompt).toBe('inspect this repository');
  });

  it('parses the subcommands', () => {
    expect(parseArgs(['models']).command.kind).toBe('models');
    expect(parseArgs(['sessions']).command.kind).toBe('sessions');
    expect(parseArgs(['doctor']).command.kind).toBe('doctor');
    expect(parseArgs(['help']).command.kind).toBe('help');
    expect(parseArgs(['version']).command.kind).toBe('version');
  });

  it('parses mcp subcommands and rejects an unknown action', () => {
    const a = parseArgs(['mcp', 'add', 'files', 'node', 'server.js']);
    expect(a.command).toEqual({ kind: 'mcp', action: 'add', rest: ['files', 'node', 'server.js'] });
    expect(parseArgs(['mcp', 'frobnicate']).error).toContain('list, add or remove');
  });

  it('parses the workspace flags', () => {
    const a = parseArgs(['--cwd', './project', '--add-dir', '../shared', '--add-dir', '../other']);
    expect(a.cwd).toBe('./project');
    expect(a.addDirs).toEqual(['../shared', '../other']);
  });

  it('keeps engine, model and web separate from approval', () => {
    const a = parseArgs(['--engine', 'menu', '--model', 'some/model:free', '--web', '--approval', 'auto-edit']);
    expect(a.engine).toBe('menu');
    expect(a.model).toBe('some/model:free');
    expect(a.web).toBe(true);
    expect(a.approval).toBe('auto-edit');
  });

  it('accepts the approval shorthands', () => {
    expect(parseArgs(['--ask']).approval).toBe('ask');
    expect(parseArgs(['--auto-edit']).approval).toBe('auto-edit');
    expect(parseArgs(['--full-auto']).approval).toBe('full-auto');
  });

  it('rejects an unknown approval mode', () => {
    expect(parseArgs(['--approval', 'yolo']).error).toContain('--approval must be one of');
  });

  it('supports --no-web', () => {
    expect(parseArgs(['--no-web']).web).toBe(false);
    expect(parseArgs([]).web).toBeNull();
  });

  it('parses session flags and rejects the contradictory pair', () => {
    expect(parseArgs(['--continue']).continueLast).toBe(true);
    expect(parseArgs(['--resume', 'abc']).resumeId).toBe('abc');
    expect(parseArgs(['--continue', '--resume', 'abc']).error).toContain('pick one');
  });

  it('validates --max-steps', () => {
    expect(parseArgs(['--max-steps', '25']).maxSteps).toBe(25);
    expect(parseArgs(['--max-steps', '0']).error).toContain('between 1 and 500');
    expect(parseArgs(['--max-steps', 'lots']).error).toContain('between 1 and 500');
  });

  it('reports a flag whose value is missing instead of silently eating the next flag', () => {
    expect(parseArgs(['--engine', '--web']).error).toBe('--engine needs a value');
  });

  it('rejects an unknown option', () => {
    expect(parseArgs(['--mode', 'fast']).error).toBe('unknown option --mode');
  });

  it('stops flag parsing at --', () => {
    const a = parseArgs(['-p', 'do it', '--', '--not-a-flag']);
    expect(a.error).toBeNull();
    expect(a.prompt).toBe('do it');
  });

  it('handles help and version anywhere on the line', () => {
    expect(parseArgs(['--engine', 'fast', '--help']).command.kind).toBe('help');
    expect(parseArgs(['-v']).command.kind).toBe('version');
  });

  it('parses colour and debug flags', () => {
    expect(parseArgs(['--no-color']).color).toBe(false);
    expect(parseArgs(['--color']).color).toBe(true);
    expect(parseArgs(['--debug']).debug).toBe(true);
  });
});
