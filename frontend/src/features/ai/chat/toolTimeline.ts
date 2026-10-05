/**
 * 10.0 Marigold — the tool timeline as a pure model.
 *
 * A reply can carry two kinds of evidence of work done on its way:
 *
 *   - `steps`: the tool runs an agentic engine reported, one `step` frame each
 *     ("Searched the web for “…”", "Read example.com", "Ran code");
 *   - `sources`: the pages of the web search the service ran for the turn,
 *     reported in the stream's `meta` frame.
 *
 * Both become rows of one timeline. Nothing here is invented: a row exists
 * only for a step or a source list the stream actually sent, a count is shown
 * only when it is the length of a real list, and the only inference is the
 * one the stream's order implies — while the reply is still being worked on
 * and no answer text has arrived, the newest step is the one in progress.
 */
import type { AgentStep, AgentTool } from './types';

export type ToolStatus = 'running' | 'done';

export interface ToolRow {
  tool: AgentTool;
  /** As the stream labelled it, put in the present tense while it runs. */
  label: string;
  status: ToolStatus;
  /** Hosts of the pages a web search returned (search rows only). */
  hosts?: string[];
  /** How many pages that search returned (the length of the real list). */
  sourceCount?: number;
}

export interface Timeline {
  rows: ToolRow[];
  /** The folded header: "Used 3 tools", "Searched the web · 5 sources". */
  summary: string;
  /** A step is in progress right now. */
  running: boolean;
}

/** Host of a URL without "www.", or '' when it does not parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Distinct hosts in source order. */
export function distinctHosts(urls: readonly string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const h = hostOf(u);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** The service labels a step once it has happened ("Searched the web for
 *  “x”", "Ran code", "Read example.com"). While it is the step in progress the
 *  same words read in the present tense. An unknown label is left alone. */
const PRESENT: Array<[RegExp, string]> = [
  [/^Searched\b/, 'Searching'],
  [/^Ran\b/, 'Running'],
  [/^Read\b/, 'Reading'],
  [/^Opened\b/, 'Opening'],
  [/^Used\b/, 'Using'],
  [/^Visited\b/, 'Visiting'],
  [/^Fetched\b/, 'Fetching'],
];
export function liveLabel(label: string, running: boolean): string {
  if (!running) return label;
  for (const [re, verb] of PRESENT) if (re.test(label)) return label.replace(re, verb);
  return label;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * Fold what the stream sent into timeline rows plus the one-line summary.
 *
 * `working`   — this reply is still in flight.
 * `answering` — answer text has started to arrive (tool work is over).
 */
export function buildTimeline({
  steps = [],
  sources = [],
  working,
  answering,
}: {
  steps?: readonly AgentStep[];
  sources?: readonly string[];
  working: boolean;
  answering: boolean;
}): Timeline {
  const rows: ToolRow[] = [];
  // The service's own web search runs before the engine answers, so its row
  // leads. It is a fact the meta frame reported, never an assumption.
  if (sources.length) {
    rows.push({
      tool: 'search',
      label: 'Searched the web',
      status: 'done',
      hosts: distinctHosts(sources),
      sourceCount: sources.length,
    });
  }
  const lastStep = steps.length - 1;
  steps.forEach((s, i) => {
    const running = working && !answering && i === lastStep;
    rows.push({ tool: s.tool, label: liveLabel(s.label, running), status: running ? 'running' : 'done' });
  });
  const running = rows.some((r) => r.status === 'running');
  const sourcesPart = sources.length ? ` · ${plural(sources.length, 'source')}` : '';
  let summary = '';
  if (rows.length) {
    const onlySearch = rows.every((r) => r.tool === 'search');
    summary = onlySearch && rows.length === 1 ? `Searched the web${sourcesPart}` : `Used ${plural(rows.length, 'tool')}${sourcesPart}`;
  }
  return { rows, summary, running };
}
