/**
 * v7.1 — shared shapes for the VinaX AI chat surface. The page used to be one
 * 3k-line module; these are the contracts its pieces now agree on.
 */

/**
 * 10.3 — the four providers VinaX AI reaches, one key each. The order is the
 * order the menu lists them in (and the order GET /api/aimodels sends them).
 */
export type ProviderId = 'nvidia' | 'openrouter' | 'groq' | 'gemini';

/** One model a provider serves right now, under its own original name. */
export interface ProviderModel {
  /** The exact slug sent back on the wire. */
  id: string;
  /** The model's original name, as the provider publishes it. */
  name: string;
  /** Who made the model, when the provider says. */
  maker: string | null;
  context: number | null;
  /** Reads images. */
  vision: boolean;
}

/** 10.3 — what a non-chat model makes or reads. Embeddings are listed but
 *  only ever used on the server. */
export type MediaKind = 'image' | 'speech' | 'transcription' | 'music' | 'embedding';

/** 10.3 — one free non-chat model a provider serves, under its own name. */
export interface MediaModel {
  id: string;
  name: string;
  maker: string | null;
  kind: MediaKind;
  /** Speech models: the voices it speaks in (empty otherwise). */
  voices: string[];
}

/** 10.3 — a free tool some of a provider's chat models can use. Web search is
 *  not one of them, and never will be (10.2). */
export interface ProviderTool {
  id: string;
  name: string;
  /** Slugs of the chat models that carry the tool. */
  models: string[];
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** The provider's key is set on the server. */
  configured: boolean;
  /** Empty when the key is missing or the provider's list could not be read. */
  models: ProviderModel[];
  /** 10.3 — non-chat models (absent from an older server's answer). */
  media?: MediaModel[];
  /** 10.3 — tools its chat models can use (absent from an older server's answer). */
  tools?: ProviderTool[];
}

/** 10.3 — which kinds of model the server can reach at all right now. All
 *  false when an older server sends no `features`. */
export interface AiFeatures {
  image: boolean;
  speech: boolean;
  transcription: boolean;
  music: boolean;
  code: boolean;
  /** 11.0 — some chat model can search the web (the Gemini provider's own grounding). */
  web: boolean;
}

/** 10.3 — one exact non-chat model: a provider and the model's slug, with
 *  its name at the moment it was picked. */
export interface MediaPick {
  provider: ProviderId;
  model: string;
  name?: string;
}

/** 10.3 — a picture or a music clip made in the chat. `src` is a data URL
 *  while the tab is open; it is emptied before the chat is saved (media is
 *  never kept on the device), and the thread then shows a placeholder line. */
export interface MsgMedia {
  kind: 'image' | 'music';
  src: string;
  mime?: string;
  /** The model's published name, as the server reported it. */
  model: string;
  provider?: ProviderId;
  prompt: string;
}

/**
 * What the composer is set to: Auto (the service picks the best model for each
 * question), or one exact model from one provider. `name` is the model's
 * original name at the moment it was picked, so a saved pick labels itself
 * before the list has ever been fetched.
 */
export type ModelChoice =
  | { mode: 'auto' }
  | { mode: 'model'; provider: ProviderId; model: string; name?: string };

/** 11.0 — what a web-grounded reply drew on (the stream's `sources` event):
 *  the pages, the queries the model ran, and the provider's search-suggestion
 *  snippet (HTML, shown in a sealed frame). Kept with the chat. */
export interface MsgSources {
  items: Array<{ url: string; title: string }>;
  queries: string[];
  entry: string | null;
}

/** 11.2 — why the listener's own model pick gave no answer (the server's
 *  `model_unavailable`), and the models from the same provider it offered
 *  instead. VinaX never answers a pick with another provider's model. */
export type PickIssueReason = 'quota' | 'not_free' | 'busy' | 'gone' | 'down' | 'refused';
export interface PickIssue {
  reason: PickIssueReason;
  provider: ProviderId;
  model: string;
  name: string;
  /** Up to three other models from the same provider. */
  alternatives: Array<{ provider: ProviderId; model: string; name: string }>;
}

/** 11.2 — one version of an edited user message (./versions.ts): its text,
 *  its pictures, and the turns that followed it. The version on screen keeps
 *  `after: []` — its turns are the thread itself. */
export interface MsgVersion {
  content: string;
  images?: string[];
  after: Msg[];
}

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  /** The model that answered, by its original name (from stream meta). Older
   *  builds stored a VinaX nickname here; those still show as they were. */
  engine?: string;
  /** 10.3 — the provider of the model that answered, for its logo on the chip. */
  engineProvider?: ProviderId;
  /** 10.3 — tools that were on for the model that answered (stream meta). */
  tools?: string[];
  /** 11.0 — the pages a web-grounded reply drew on. */
  sources?: MsgSources;
  /** 10.3 — a picture or a music clip made with Create image / Create music clip. */
  media?: MsgMedia;
  /** 10.3 — a picture or clip is being made for this (still empty) reply. */
  creating?: 'image' | 'music';
  /** 11.0 — this line answers a Create image / Create music clip request that
   *  did not produce one, so asking again goes back to the maker, not to chat. */
  mediaKind?: 'image' | 'music';
  /** 11.0 — the id of the turn still writing this reply. Only that turn may
   *  patch it; cleared when the turn ends and never kept across a reload. */
  turn?: string;
  /** Render as a live mini-player card (music commands). */
  player?: boolean;
  /** Listener feedback on this reply. */
  rating?: 'up' | 'down';
  /** Pinned to the top of the chat. */
  pinned?: boolean;
  /** Follow-up questions the engine suggested. */
  followups?: string[];
  /** 8.2.0 — no reply arrived (the text is the failure line); the thread
   *  offers Retry, and the line is never sent back to the assistant. */
  failed?: boolean;
  /** 11.0 — with `failed`: asking again as it is cannot work (too large, or
   *  turned away); the thread offers "Edit message" instead of Retry. */
  needsEdit?: boolean;
  /** 11.2 — with `failed`: the picked model could not answer; the notice says
   *  why and offers its alternatives and Auto. */
  pickIssue?: PickIssue;
  /** 9.0 — no reply arrived and asking again cannot help right now (VinaX AI
   *  is switched off, or has reached its limit for the day). Presentation
   *  only: the thread shows a notice that points back to the music. */
  unavailable?: boolean;
  /** 11.2 — a user message edited in place: every version, oldest first (at
   *  most 10), and which one is on screen. Absent until the first edit. */
  versions?: MsgVersion[];
  version?: number;
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
