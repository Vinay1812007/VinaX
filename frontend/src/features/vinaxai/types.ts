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
  groups: string[];
  models: PickerModel[];
}

export type StopReason = 'end' | 'length' | 'aborted' | 'error';

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
  | { event: 'error'; data: ReplyError }
  | { event: 'done'; data: { stopReason: StopReason; usage?: { input: number; output: number } } };
