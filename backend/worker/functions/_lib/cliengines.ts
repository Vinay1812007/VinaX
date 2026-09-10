/**
 * The engines VinaX CLI can run on.
 *
 * The CLI must never ship its own engine list — a hard-coded menu in a
 * published npm package goes stale the first time a key rotates, and the
 * listener ends up choosing an engine that no longer exists. So the CLI asks
 * /api/vinaxcli/meta, and this table is what that endpoint answers with.
 *
 * Engines are named for what they DO for a coding task, not for the model
 * behind them: the seat can be re-laned (as the assistant's seats have been,
 * repeatedly) without breaking anyone's `--engine` flag or saved config.
 */
import { LANE_ENV, type AiEnv, type Lane } from './ai';

export interface CliEngine {
  /** Stable id used by `--engine` and the config file. */
  id: string;
  label: string;
  hint: string;
  /** Feature lane that serves it. Never sent to the client. */
  lane: Lane;
  /** True when the engine's key opens a whole catalog and `--model` applies. */
  acceptsModel: boolean;
  /** Which catalog `--model` is validated against, when it accepts one. */
  catalog?: 'grq' | 'opr';
}

export const CLI_ENGINES: readonly CliEngine[] = [
  { id: 'auto', label: 'VinaX AUTO', hint: 'Picks the seat from the task', lane: 'chat', acceptsModel: false },
  { id: 'balanced', label: 'VinaX Balanced', hint: 'The everyday coding seat', lane: 'chat', acceptsModel: false },
  { id: 'fast', label: 'VinaX Fast', hint: 'Quickest turns, small changes', lane: 'fast', acceptsModel: false },
  { id: 'deep', label: 'VinaX Deep', hint: 'Multi-step reasoning, hard bugs', lane: 'deep', acceptsModel: false },
  { id: 'power', label: 'VinaX Power', hint: 'Premium backstop, slowest', lane: 'home', acceptsModel: false },
  { id: 'agent', label: 'VinaX Agent', hint: 'Long autonomous runs', lane: 'agent', acceptsModel: false },
  { id: 'instant', label: 'VinaX Instant', hint: 'Sub-second seat; model selectable', lane: 'scholar', acceptsModel: true, catalog: 'grq' },
  { id: 'menu', label: 'VinaX Menu', hint: 'Free-model marketplace; model selectable', lane: 'router', acceptsModel: true, catalog: 'opr' },
] as const;

const BY_ID = new Map(CLI_ENGINES.map((e) => [e.id, e]));

export function cliEngine(id: string | null | undefined): CliEngine | null {
  return BY_ID.get(String(id ?? '').trim().toLowerCase()) ?? null;
}

/** True when the engine's own key is configured on this Worker. */
export function engineAvailable(env: AiEnv, e: CliEngine): boolean {
  return Boolean(env[LANE_ENV[e.lane]]);
}

/**
 * AUTO seat: choose from the request itself.
 *
 * A coding agent's default failure mode is picking a slow premium seat for
 * "rename this variable" and a light seat for "work out why the build
 * deadlocks". The signal words below are the cheap version of that judgement
 * — deliberately conservative, because the balanced seat is the one measured
 * fastest to first token and it handles most coding turns.
 */
export function pickAutoEngine(text: string): CliEngine {
  const t = text.toLowerCase();
  const hard =
    /\b(architect|refactor|redesign|race condition|deadlock|memory leak|why does|root cause|security|vulnerab|performance|optimi[sz]e|migrat|concurren|debug)\b/.test(t) ||
    text.length > 1200;
  const trivial = /^\s*(what|where|which|list|show|explain briefly|read)\b/.test(t) && text.length < 160;
  const id = hard ? 'deep' : trivial ? 'fast' : 'balanced';
  return BY_ID.get(id) ?? CLI_ENGINES[1];
}
