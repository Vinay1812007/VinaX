/** VinaX AI — the shapes the page shares with /api/ai/* (docs/ai.md). */

export interface ModelLabel {
  id: string;
  name: string;
  provider: string;
}

export interface PickerModel extends ModelLabel {
  /** The curated groups, then `more-<provider>`: free models found in that provider's own list. */
  group: 'fast' | 'balanced' | 'smart' | 'vision' | 'code' | 'more' | 'cloudflare'
    | 'more-groq' | 'more-gemini' | 'more-openrouter' | 'more-nvidia' | 'more-cloudflare';
  description: string;
  flags: { vision: boolean; web: boolean; thinking: boolean; code: boolean };
  available: boolean;
  reason?: 'not_configured' | 'busy';
}

/** A free model found in its provider's list (not curated): kept out of short menus such as Retry. */
export const isFoundModel = (m: Pick<PickerModel, 'group'>): boolean => typeof m.group === 'string' && m.group.startsWith('more-');

export interface ModelsResponse {
  enabled: boolean;
  configured: boolean;
  /** Web search is offered (the owner allows it and something can search). */
  search?: boolean;
  groups: string[];
  models: PickerModel[];
  /** Voice features that have a provider key, and the voices to offer (phase 6). */
  voice?: VoiceInfo;
  /** The owner's file limits (counts, MB and pages). */
  limits?: Partial<Record<'imagesPerMessage' | 'filesPerMessage' | 'filesPerChat' | 'pdfMB' | 'pdfPages' | 'textMB', number>>;
}

export interface VoiceInfo {
  dictation: boolean;
  readAloud: boolean;
  live: boolean;
  /** Read aloud voices (Groq Orpheus). */
  voices: string[];
  /** Live voices (Gemini), also used when Gemini reads aloud. */
  liveVoices: string[];
  /** Live voice may search the web (the owner allows web search). */
  liveSearch?: boolean;
  /** Live models the listener may pick (Auto tries them in this order). */
  liveModels?: Array<{ id: string; name: string; note?: string }>;
  /** Languages Live voice can be held to. */
  liveLanguages?: Array<{ code: string; name: string; native: string }>;
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

/** A file in a message (as sent, or as saved in its content). */
export interface FileRef {
  id: string;
  name: string;
  kind: 'image' | 'pdf' | 'text';
  mime: string;
  size: number;
  pages?: number;
  /** This device's own copy of an image just sent (an object URL). */
  preview?: string;
}

export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: 'user' | 'assistant';
  text: string;
  files?: FileRef[];
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
  content: Array<{ type: string; text?: string; id?: string; name?: string; kind?: FileRef['kind']; mime?: string; size?: number; pages?: number }>;
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
  /** The project the chat is in, or null. */
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerConversation {
  id: string;
  title: string | null;
  starred: boolean;
  activeLeafId: string | null;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Never reads or adds to memory. */
  incognito?: boolean;
}

/** One note in VinaX AI's memory (GET /api/ai/memories). */
export interface MemoryItem {
  id: string;
  text: string;
  /** 'chat': learned from a chat; 'user': added in settings. */
  origin: 'chat' | 'user';
  createdAt: string;
}

export interface MemoryPrefs {
  use: boolean;
  learn: boolean;
}

export interface MemoryState {
  /** False while the owner has memory off (notes can still be seen and deleted). */
  enabled: boolean;
  prefs: MemoryPrefs;
  items: MemoryItem[];
  max: number;
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

// ---------- shared chats ----------

/** One of the listener's shared links (GET /api/ai/shares). */
export interface ShareSummary {
  id: string;
  conversationId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One turn of a shared chat: its text (artifacts inside), files by name only. */
export interface SharedMessage {
  role: 'user' | 'assistant';
  text: string;
  files?: Array<{ name: string; kind: FileRef['kind'] }>;
  sources?: SourcesInfo;
  createdAt: string;
}

/** A shared chat as anyone with the link reads it (GET /api/ai/shares/:id). */
export interface SharedChat {
  id: string;
  title: string;
  messages: SharedMessage[];
  createdAt: string;
  updatedAt: string;
}

/** One card of the artifacts gallery: an artifact's newest version in one chat (no content). */
export interface GalleryItem {
  conversationId: string;
  conversationTitle: string | null;
  artifactId: string;
  messageId: string;
  kind: 'code' | 'html' | 'svg' | 'mermaid' | 'markdown' | 'react';
  title: string;
  language: string | null;
  incomplete: boolean;
  versions: number;
  createdAt: string;
}

/** One artifact of the gallery with every version in its chat, oldest first. */
export interface GalleryArtifact {
  conversationId: string;
  conversationTitle: string | null;
  artifactId: string;
  versions: Array<{ messageId: string; createdAt: string; type: GalleryItem['kind']; title: string; language: string | null; content: string; incomplete: boolean }>;
}

// ---------- projects ----------

/** One of the listener's projects (GET /api/ai/projects). */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  /** What every chat in the project follows. */
  instructions: string | null;
  starred: boolean;
  chatCount?: number;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** A file in a project's knowledge (never its text). */
export interface KnowledgeFile {
  id: string;
  name: string;
  mime: string;
  kind: FileRef['kind'];
  size: number;
  pages?: number;
  /** Characters of text it adds to the project. */
  chars: number;
  createdAt: string;
}

/** GET /api/ai/projects/:id */
export interface ProjectDetail {
  project: Project;
  files: KnowledgeFile[];
  chats: ConversationSummary[];
  limits: { files: number; chars: number; usedChars: number };
}
