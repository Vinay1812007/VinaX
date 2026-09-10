/**
 * Library surface.
 *
 * `vinax` is a binary first, but the pieces are exported so the e2e suite can
 * drive them, and so anything else in the VinaX repository can reuse the
 * protocol types without shelling out to the CLI.
 */
export { CLI_NAME, CLI_VERSION } from './version.js';
export { parseArgs, type ParsedArgs, type ApprovalMode, type OutputMode } from './config/args.js';
export { resolveConfig, applyProjectConfig, DEFAULTS, DEFAULT_API_BASE, type VinaxConfig } from './config/config.js';
export { paths, vinaxHome, ensureDirs } from './config/paths.js';
export { VinaxApi, ApiError, type Meta, type MetaEngine } from './api/client.js';
export { createSseParser, type SseMessage } from './api/sse.js';
export { PROTOCOL, JSON_SCHEMA_VERSION, toAgentEvent, type AgentEvent, type AgentRequest } from './protocol/events.js';
export { runAgentTurn, type RunOutcome, type StopReason, type AgentObserver } from './agent/loop.js';
export { TaskLedger, summarizeRun } from './agent/ledger.js';
export { compact, buildSummary, estimateTokens, type Turn } from './agent/context.js';
export { discover, collectInstructions, contextBlock, starterInstructions, INSTRUCTION_FILES, type Discovery } from './context/discovery.js';
export { PermissionEngine, autoAllowed, type ActionRequest, type Decision, type Prompter } from './permissions/policy.js';
export { makeWorkspace, resolvePath, containedIn, type Workspace } from './security/paths.js';
export { isProtectedPath, redact, containsSecret, envForModel } from './security/secrets.js';
export { classifyArgv, classifyShell, splitShell, programName, type RiskLevel } from './security/risk.js';
export { TOOLS, executeTool, isKnownTool } from './tools/registry.js';
export { runProcess, killTree, killAllChildren, isLongRunning } from './tools/process/runner.js';
export { unifiedDiff, diffStat } from './tools/filesystem/diff.js';
export { globToRegExp, matchGlob, loadIgnores, DEFAULT_IGNORES } from './project/ignore.js';
export { RunJournal, type EditRecord, type UndoResult } from './session/journal.js';
export { SessionStore, listSessions, conversationFrom, type SessionEntry } from './session/store.js';
export { McpRegistry, type McpServerConfig, type McpToolInfo } from './tools/mcp/client.js';
export { EXIT, EXIT_LABEL, type ExitCode } from './utils/exit.js';
export { contentHash, looksBinary, detectNewline, clip } from './utils/text.js';
export { detectTheme, renderMarkdown, renderDiff, type Theme } from './terminal/render.js';
export { helpText } from './commands/help.js';
export { runDoctorChecks, renderDoctor, doctorExitCode, type Check } from './commands/doctor.js';
export { bootstrap, runInteractive, runOnce, exitCodeFor } from './commands/run.js';
