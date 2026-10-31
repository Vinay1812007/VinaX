/** VinaX AI — the shapes the page shares with /api/ai/* (docs/ai.md). */

export interface ModelLabel {
  id: string;
  name: string;
  provider: string;
}

export interface PickerModel extends ModelLabel {
  group: 'fast' | 'balanced' | 'smart' | 'vision' | 'code' | 'cloudflare';
  description: string;
  flags: { vision: boolean; web: boolean; thinking: boolean; code: boolean };
  available: boolean;
  reason?: 'not_configured' | 'busy';
}

export interface ModelsResponse {
  enabled: boolean;
  configured: boolean;
  /** Web search is offered (the owner allows it and something can search). */
  search?: boolean;
  groups: string[];
  models: PickerModel[];
}

export type StopReason = 'end' | 'length' | 'aborted' | 'error';

export interface Source {
  n: number;
  url: string;
  title: string;
  site: string;
  snippet?: string;
}

/** The web sources of a reply. */
export interface SourcesInfo {
  items: Source[];
  via: 'grounding' | 'search';
  queries?: string[];
  /** Google's search-suggestions HTML (grounding); shown in a sandboxed frame, as Google's terms require. */
  entryPointHtml?: string;
}

/** Where [n] markers go in a grounded reply (UTF-16 index in its text). */
export interface Marker {
  at: number;
  ns: number[];
}

export type SearchStatus = { step: 'searching'; query: string } | { step: 'searched'; count: number; sites: string[] };

export interface ReplyError {
  code: string;
  message: string;
  retryable: boolean;
  alternatives?: ModelLabel[];
}

export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  text: string;
  thinking: string;
  /** How long the model reasoned, once its answer began (ms). */
  thinkingMs: number | null;
  model: ModelLabel | null;
  stopReason: StopReason | null;
  error: ReplyError | null;
  sources?: SourcesInfo | null;
  /** While the reply is written: what the web search is doing. */
  status?: SearchStatus | null;
  createdAt: string;
  /** Only on this device so far (not yet confirmed by the server). */
  local?: boolean;
}

/** One message as GET /api/ai/conversations/:id sends it. */
export interface ServerMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  content: Array<{ type: string; text?: string }>;
  thinking: string | null;
  thinkingMs: number | null;
  model: ModelLabel | null;
  stopReason: StopReason | null;
  sources?: SourcesInfo | null;
  createdAt: string;
}

/** One row of the conversation list. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  starred: boolean;
  activeLeafId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerConversation {
  id: string;
  title: string | null;
  starred: boolean;
  activeLeafId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The named events of the chat stream. */
export type StreamEvent =
  | { event: 'meta'; data: { conversationId: string; userMessageId: string; assistantMessageId: string; model: ModelLabel; continued?: boolean } }
  | { event: 'title'; data: { title: string } }
  | { event: 'thinking'; data: { delta: string } }
  | { event: 'text'; data: { delta: string } }
  | { event: 'status'; data: SearchStatus }
  | { event: 'sources'; data: SourcesInfo & { markers?: Marker[] } }
  | { event: 'error'; data: ReplyError }
  | { event: 'done'; data: { stopReason: StopReason; usage?: { input: number; output: number } } };
