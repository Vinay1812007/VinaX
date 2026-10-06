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

export interface Provider {
  id: ProviderId;
  label: string;
  /** The provider's key is set on the server. */
  configured: boolean;
  /** Empty when the key is missing or the provider's list could not be read. */
  models: ProviderModel[];
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

export interface Msg {
  role: 'user' | 'assistant';
  content: string;
  images?: string[];
  /** The model that answered, by its original name (from stream meta). Older
   *  builds stored a VinaX nickname here; those still show as they were. */
  engine?: string;
  /** 10.3 — the provider of the model that answered, for its logo on the chip. */
  engineProvider?: ProviderId;
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
