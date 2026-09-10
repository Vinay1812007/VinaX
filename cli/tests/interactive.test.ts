/**
 * The interactive session, end to end.
 *
 * This drives the REAL loop — bootstrap, TerminalApp, the agent loop, the
 * permission engine — against a mock VinaX server, feeding actual terminal
 * key sequences and reading what would have been printed.
 *
 * It exists for one bug class that unit tests cannot reach: what the user
 * actually sees. Above all, that a streamed answer appears exactly ONCE.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import { TerminalApp } from '../src/terminal/app.js';
import { bootstrap, runInteractive } from '../src/commands/run.js';
import { parseArgs } from '../src/config/args.js';
import { stripAnsi } from '../src/terminal/ansi.js';
import { cleanup, tempDir, writeFiles } from './helpers.js';

const ESC = '\u001b';
const ENTER = '\r';
const DOWN = `${ESC}[B`;

interface Step {
  say?: string;
  calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

let server: Server;
let port = 0;
let script: Step[] = [];
let requests: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/api/vinaxcli/meta') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        protocol: 'vinax-cli/1', protocols: ['vinax-cli/1'],
        engines: [
          { id: 'auto', label: 'VinaX AUTO', hint: 'Picks the seat', acceptsModel: false, available: true },
          { id: 'fast', label: 'VinaX Fast', hint: 'Quickest turns', acceptsModel: false, available: true },
        ],
        catalogEndpoint: '/api/aimodels', tools: [], limits: { maxSteps: 80 }, web: { available: true }, docs: '',
      }));
      return;
    }
    if (req.url !== '/api/vinaxcli/agent') { res.writeHead(404).end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body) as { step: number };
      requests.push(parsed as unknown as Record<string, unknown>);
      const plan = script[parsed.step - 1];
      const base = { seq: 0, runId: 'run_i', requestId: `req_${parsed.step}`, step: parsed.step };
      const events: Array<Record<string, unknown>> = [
        { type: 'hello', protocol: 'vinax-cli/1', maxSteps: 80, maxCallsPerStep: 6, ...base },
        { type: 'engine', engine: 'fast', label: 'VinaX Fast', model: 'm', web: false, ...base },
        { type: 'status', status: 'thinking', ...base },
      ];
      if (plan?.say) {
        // Stream it in pieces, as a real engine does.
        for (const piece of plan.say.match(/.{1,7}/g) ?? []) {
          events.push({ type: 'assistant_delta', text: piece, ...base });
        }
      }
      let n = 0;
      for (const call of plan?.calls ?? []) {
        n += 1;
        events.push({ type: 'tool_call', id: `c${parsed.step}_${n}`, name: call.name, arguments: call.arguments, ...base });
      }
      events.push({ type: 'done', reason: (plan?.calls?.length ?? 0) > 0 ? 'tool_calls' : 'final', toolCalls: plan?.calls?.length ?? 0, ...base });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

let project = '';
let home = '';
let harness: ReturnType<typeof makeHarness> | null = null;

function makeHarness() {
  const chunks: string[] = [];
  const out = new PassThrough() as unknown as NodeJS.WriteStream;
  out.write = ((t: string) => { chunks.push(String(t)); return true; }) as NodeJS.WriteStream['write'];
  Object.defineProperty(out, 'columns', { value: 100, configurable: true });
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const app = new TerminalApp({
    theme: { color: false, width: 100, unicode: true },
    input, output: out, interactive: true,
  });
  return { app, chunks, text: (): string => stripAnsi(chunks.join('')) };
}

beforeEach(async () => {
  project = await tempDir('vinax-int-project-');
  home = await tempDir('vinax-int-home-');
  await writeFiles(project, { 'package.json': JSON.stringify({ name: 'demo' }), 'src/a.ts': 'export const a = 1;\n' });
  script = [];
  requests = [];
  process.env.VINAX_API_BASE = `http://127.0.0.1:${port}`;
  process.env.VINAX_HOME = home;
  harness = makeHarness();
});

afterEach(async () => {
  harness?.app.stop();
  harness = null;
  delete process.env.VINAX_API_BASE;
  delete process.env.VINAX_HOME;
  await cleanup(project);
  await cleanup(home);
});

/** Start the interactive loop and return a driver for it. */
async function startSession(extraArgs: string[] = []) {
  const h = harness!;
  const args = parseArgs(['--cwd', project, '--full-auto', ...extraArgs]);
  args.output = 'interactive';
  const boot = await bootstrap(args, { app: h.app });
  const finished = runInteractive(boot);
  // Let the loop reach its first readLine().
  await new Promise((r) => setTimeout(r, 20));
  return {
    ...h,
    finished,
    type: (s: string) => h.app.feed(s),
    /** Submit a line and wait for the turn to settle. */
    submit: async (line: string, settleMs = 120) => {
      h.app.feed(line);
      h.app.feed(ENTER);
      await new Promise((r) => setTimeout(r, settleMs));
    },
    quit: async () => {
      h.app.feed('/exit');
      h.app.feed(ENTER);
      return finished;
    },
  };
}

describe('the interactive session', () => {
  it('shows a streamed answer EXACTLY ONCE', async () => {
    const answer = 'This repository is the VinaX monorepo.';
    script = [{ say: answer }];
    const s = await startSession();
    s.chunks.length = 0;
    await s.submit('what does this repository do?');
    await s.quit();

    const text = s.text();
    const occurrences = text.split(answer).length - 1;
    // The regression: streaming the deltas AND printing finalText afterwards
    // rendered the same reply twice.
    expect(occurrences, `the answer appeared ${occurrences} times`).toBe(1);
  }, 20_000);

  it('leaves no permanent "Thinking" lines behind', async () => {
    script = [{ say: 'Done.' }];
    const s = await startSession();
    s.chunks.length = 0;
    await s.submit('hello');
    await s.quit();
    const thinking = s.text().split('Thinking').length - 1;
    // The spinner redraws one transient line; it must not accumulate.
    expect(thinking).toBeLessThanOrEqual(1);
  }, 20_000);

  it('runs a tool and leaves ONE permanent past-tense line', async () => {
    script = [{ calls: [{ name: 'read_file', arguments: { path: 'src/a.ts' } }] }, { say: 'It exports a constant.' }];
    const s = await startSession();
    s.chunks.length = 0;
    await s.submit('what is in src/a.ts?', 250);
    await s.quit();
    const text = s.text();
    // Count the FINISHED form. The running form is transient — it is drawn and
    // erased in place, so it legitimately appears in a raw byte capture.
    expect(text).toContain('Reading src/a.ts');
    const finished = text.split('\u2713 Read src/a.ts').length - 1;
    expect(finished, 'exactly one permanent result line').toBe(1);
    expect(text).toContain('It exports a constant.');
  }, 20_000);

  it('opens the live slash menu on "/" and runs the chosen command', async () => {
    script = [];
    const s = await startSession();
    s.chunks.length = 0;
    s.type('/');
    await new Promise((r) => setTimeout(r, 20));
    expect(s.text()).toContain('/help');
    expect(s.text()).toContain('/permissions');

    // Arrow to a command and run it.
    s.chunks.length = 0;
    s.type('/stat');
    s.type(ENTER);
    await new Promise((r) => setTimeout(r, 60));
    expect(s.text()).toContain('State');
    await s.quit();
  }, 20_000);

  it('changes the approval mode through the arrow-key picker', async () => {
    const s = await startSession();
    s.chunks.length = 0;
    s.type('/permissions');
    s.type(ENTER);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.text()).toContain('Permission mode');
    expect(s.text()).toContain('Auto edit');

    s.chunks.length = 0;
    s.type(DOWN);
    s.type(ENTER);
    await new Promise((r) => setTimeout(r, 40));
    expect(s.text()).toMatch(/Approval mode set to (ask|auto-edit|full-auto)/);
    await s.quit();
  }, 20_000);

  it('never lets an escape sequence reach the model as text', async () => {
    script = [{ say: 'ok' }];
    const s = await startSession();
    s.type('hello world');
    for (let i = 0; i < 5; i += 1) s.type(`${ESC}[D`);
    s.type('VinaX-');
    s.type(ENTER);
    await new Promise((r) => setTimeout(r, 150));
    await s.quit();

    const sent = requests[0] as { messages: Array<{ role: string; content: string }> } | undefined;
    const userMessage = sent?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('hello VinaX-world');
    expect(userMessage).not.toContain(ESC);
  }, 20_000);

  it('restores the terminal on exit', async () => {
    const s = await startSession();
    s.chunks.length = 0;
    await s.quit();
    const raw = s.chunks.join('');
    // Cursor shown and bracketed paste disabled — the two things that strand a
    // terminal if a program forgets them.
    expect(raw).toContain('?25h');
    expect(raw).toContain('?2004l');
  }, 20_000);
});
