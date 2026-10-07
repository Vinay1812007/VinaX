/**
 * 10.0 Marigold — the connectors: the context sources VinaX AI can draw on for
 * a reply, each one a switch in the composer's + menu.
 *
 * Every connector is something the chat ALREADY does; this module only gives
 * them one list and one vocabulary. Nothing here talks to the server.
 *
 *   think     — the deep engine reasons it through first     (page state)
 *   nowPlaying— the song playing now rides with the message (page state)
 *   memory    — the lines the listener asked it to remember  (./memory.ts)
 *   code      — 10.3: the model may run code to work things out (this module)
 *
 * 11.0 — the Place row is gone: place follows the app-wide region setting
 * alone (src/services/location/assistantPlace.ts), and the server reads a
 * coarse place from the connection when the client sends none. A stored
 * `vinax.ai.placeOn` from 10.x is ignored.
 *
 * Run code is the one connector that is a TOOL rather than context: it asks
 * the answering model to run short programs, and the code and its output come
 * back inside the reply. It is listed only when the server says some model
 * can (`features.code` from GET /api/aimodels), and it is off by default.
 *
 */

/** 10.3 — Run code, '1' when on. Off unless the listener switched it on. */
export const CODE_ON_KEY = 'vinax.ai.codeOn';

/** Fired on window whenever a stored connector (memory, code) changes, so a
 *  second view of the same switch (the settings dialog, the chip row) follows. */
export const CONNECTORS_EVENT = 'vinax:ai-connectors';

export function notifyConnectors(): void {
  try {
    window.dispatchEvent(new Event(CONNECTORS_EVENT));
  } catch {
    /* no window (tests, very early) */
  }
}

export function onConnectorsChange(cb: () => void): () => void {
  window.addEventListener(CONNECTORS_EVENT, cb);
  return () => window.removeEventListener(CONNECTORS_EVENT, cb);
}

/** 10.3 — Run code: off unless the listener switched it on. */
export function codeConnectorOn(): boolean {
  try {
    return window.localStorage.getItem(CODE_ON_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCodeConnectorOn(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(CODE_ON_KEY, '1');
    else window.localStorage.removeItem(CODE_ON_KEY);
  } catch {
    /* private mode: the setting simply does not persist */
  }
  notifyConnectors();
}

/** 10.3 — Run code against the model in use: 'ok' (it can run code), 'auto'
 *  (Auto picks a model that can), 'unsupported' (the pinned model cannot), or
 *  'unknown' (the list has not been read yet — nothing is claimed). */
export type CodeSupport = 'ok' | 'auto' | 'unsupported' | 'unknown';

/** The quiet line on the Run code chip for each case (null = no line). */
export function codeChipNote(support: CodeSupport): string | null {
  return support === 'unsupported' ? 'not available with this model' : null;
}

export type ConnectorId = 'think' | 'nowPlaying' | 'memory' | 'code';

/** One row of the Connectors list, as the menu and the chip row draw it. */
export interface ConnectorView {
  id: ConnectorId;
  name: string;
  /** One line on what it does — or why it cannot be switched on right now. */
  description: string;
  on: boolean;
  /** Cannot be switched on from here (the reason is the description). */
  disabled?: boolean;
  /** 10.3 — a quiet note on the chip ("not available with this model"). */
  note?: string | null;
}

export interface ConnectorInputs {
  think: boolean;
  nowPlaying: boolean;
  /** Title of the song playing now, if any. */
  song?: string | null;
  memoryOn: boolean;
  memoryCount: number;
  /** 10.3 — the server can run code for some model (`features.code`). Run
   *  code is only listed when it can. */
  codeAvailable?: boolean;
  codeOn?: boolean;
  codeSupport?: CodeSupport;
}

/** The connector rows, in menu order. Pure. */
export function connectorViews(s: ConnectorInputs): ConnectorView[] {
  const lines = (n: number): string => `${n} saved line${n === 1 ? '' : 's'}`;
  return [
    { id: 'think', name: 'Think', description: 'Reason it through carefully before answering', on: s.think },
    {
      id: 'nowPlaying',
      name: 'Now playing',
      description: s.song ? `Share “${s.song}” with your message` : 'Share the song that is playing with your message',
      on: s.nowPlaying,
    },
    {
      id: 'memory',
      name: 'Memory',
      description: s.memoryOn
        ? s.memoryCount
          ? `${lines(s.memoryCount)} ${s.memoryCount === 1 ? 'rides' : 'ride'} with every chat`
          : 'On — add lines in Chat settings'
        : 'Lines you ask it to remember, kept on this device',
      on: s.memoryOn,
    },
    ...(s.codeAvailable ? [codeView(s.codeOn === true, s.codeSupport ?? 'unknown')] : []),
  ];
}

/** 10.3 — the Run code row. Its line says what it does, or — when the model
 *  in use cannot — what happens instead. */
function codeView(on: boolean, support: CodeSupport): ConnectorView {
  const description =
    support === 'unsupported'
      ? 'This model can’t run code — pick Auto or a model tagged Runs code'
      : support === 'auto'
        ? 'Runs short programs to work things out — Auto picks a model that can'
        : 'Runs short programs to work things out; the code and its output show in the reply';
  return { id: 'code', name: 'Run code', description, on, note: on ? codeChipNote(support) : null };
}

/** The connectors that are on, for the chip row above the composer. */
export function activeConnectors(views: ConnectorView[]): ConnectorView[] {
  return views.filter((v) => v.on && !v.disabled);
}
