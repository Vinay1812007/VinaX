/**
 * v5.16.0 — slash commands for the VinaX AI composer. Typing "/" opens a
 * menu; a command either runs instantly on the device (no engine call) or
 * seeds a prompt. Pure data + matcher here; the page wires the actions.
 */
export interface SlashCommand {
  cmd: string;
  hint: string;
  /** Takes an argument after the command word. */
  arg?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: 'playlist', arg: 'vibe', hint: 'Build a playlist from a vibe — "/playlist rainy evening"' },
  { cmd: 'now', hint: 'Show what is playing, with controls' },
  { cmd: 'lyrics', hint: 'Explain the lyrics of the song playing now' },
  { cmd: 'mood', arg: 'mood', hint: 'Play songs for a mood — "/mood chill"' },
  { cmd: 'summary', hint: 'Summarise this conversation' },
  { cmd: 'think', hint: 'Toggle Think (deeper reasoning)' },
  { cmd: 'web', hint: 'Toggle live web search' },
  { cmd: 'prompts', hint: 'Open your saved prompts' },
  { cmd: 'export', hint: 'Export this chat' },
  { cmd: 'clear', hint: 'Start a new chat' },
];

/** Parse "/cmd rest" → { cmd, arg } or null when the text is not a command. */
export function parseSlash(text: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), arg: (m[2] ?? '').trim() };
}

/** Commands whose name starts with what the user has typed after "/". */
export function matchSlash(input: string): SlashCommand[] {
  if (!input.startsWith('/') || /\s/.test(input)) return [];
  const q = input.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q));
}
