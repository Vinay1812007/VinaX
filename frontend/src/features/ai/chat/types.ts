/**
 * v7.1 — shared shapes for the VinaX AI chat surface. The page used to be one
 * 3k-line module; these are the contracts its pieces now agree on.
 */

/** Engine seat ids — stable for the API and for stored preferences. */
export type Mode =
  | 'muse'
  | 'swift'
  | 'sage'
  | 'scholar'
  | 'win'
  | 'nova'
  | 'nano'
  | 'auto'
  | 'pro'
  | 'mini'
  | 'k3'
  | 'translator'
  | 'glimmer'
  | 'flash'
  | 'musegl'
  | 'ising15'
  | 'laguna'
  | 'gemma4'
  | 'router'
  /** 8.1.0 — the flagship engine on the owner's newest key: live web grounding, the DJ's own brain. */
  | 'maestro';

/** Which live catalogue a seat opens. */
export type CatalogGroupId = 'grq' | 'opr';

/** One selectable row of a live catalogue, as the server labels it. */
export interface CatalogModel {
  id: string;
  label: string;
  context: number | null;
  /** Server-side flag: an agentic system that searches and runs code itself. */
  agent: boolean;
}

export interface CatalogGroup {
  id: CatalogGroupId;
  label: string;
  hint: string;
  configured: boolean;
  models: CatalogModel[];
}

/** The listener's model pick inside each catalogue (persisted shape). */
export type CatalogPicks = Partial<Record<CatalogGroupId, string>>;

/** What the composer is set to: a seat, plus an exact catalogue model when
 *  the seat opens a catalogue and the listener chose a row in it. */
export interface ModelChoice {
  mode: Mode;
  model?: string;
}

export type AgentTool = 'search' | 'code' | 'visit' | 'other';
/** One thing an agentic engine did while answering. */
export interface AgentStep {
  tool: AgentTool;
  label: string;
}

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  sources?: string[];
  /**
   * 9.1.0 — each source's own title and snippet, so a citation can be previewed
   * rather than shown as a bare host. Text from an arbitrary page: rendered as
   * TEXT, never as markup. Absent on older stored messages and on the grounded
   * lane, which reports URLs only.
   */
  sourcePreviews?: Array<{ url: string; title: string; snippet: string }>;
  /** Nickname of the engine that answered (from stream meta). */
  engine?: string;
  /** Render as a live mini-player card (music commands). */
  player?: boolean;
  /** Listener feedback on this reply. */
  rating?: 'up' | 'down';
  /** Pinned to the top of the chat. */
  pinned?: boolean;
  /** Follow-up questions the engine suggested. */
  followups?: string[];
  /** v7.1 — what an agentic engine did on the way to this reply. */
  steps?: AgentStep[];
  /** 8.2.0 — no reply arrived (the text is the failure line); the thread
   *  offers Retry, and the line is never sent back to the assistant. */
  failed?: boolean;
  /** 9.0 — no reply arrived and asking again cannot help right now (VinaX AI
   *  is switched off, or has reached its limit for the day). Presentation
   *  only: the thread shows a notice that points back to the music. */
  unavailable?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
  pinned?: boolean;
  /**
   * 9.1.0 — a temporary chat: never written to the device (storage.ts
   * `persistChats` drops it), so it leaves nothing behind when the tab closes.
   * Not part of an export, and never revived by an import.
   */
  temporary?: boolean;
  /**
   * 9.1.0 — the project this chat belongs to (../projects.ts). Its instructions
   * and reference files ride every message in the chat. Absent = no project.
   */
  projectId?: string;
}
