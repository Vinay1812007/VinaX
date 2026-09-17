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
  | 'router';

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
}

export interface Conversation {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
  pinned?: boolean;
}
