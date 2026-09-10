/**
 * Exit codes.
 *
 * Automation must never have to grep English prose to find out whether a run
 * worked. Every code here is stable, documented in the CLI docs, and asserted
 * by the test suite; new codes get appended rather than renumbered.
 */
export const EXIT = {
  /** The run finished and the agent produced a final answer. */
  ok: 0,
  /** Generic failure with no better code. */
  failure: 1,
  /** Bad flags, unknown command, contradictory options. */
  usage: 2,
  /** VinaX API unreachable, HTTP error, or malformed stream. */
  api: 3,
  /** A permission was required and refused (or could not be asked for). */
  permissionDenied: 4,
  /** The run hit the step ceiling before finishing. */
  maxSteps: 5,
  /** A tool failed in a way the agent could not recover from. */
  toolFailure: 6,
  /** The user interrupted the run. */
  interrupted: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Human label for a code — used by --json output and the docs table. */
export const EXIT_LABEL: Record<number, string> = {
  0: 'success',
  1: 'failure',
  2: 'invalid usage',
  3: 'VinaX API failure',
  4: 'permission denied',
  5: 'maximum steps reached',
  6: 'tool failure',
  130: 'interrupted',
};
