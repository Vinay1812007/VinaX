/**
 * 10.0 Marigold — the connectors: the context sources VinaX AI can draw on for
 * a reply, each one a switch in the composer's + menu.
 *
 * Every connector is something the chat ALREADY does; this module only gives
 * them one list and one vocabulary. Nothing here talks to the server.
 *
 *   web       — search the live web for the reply            (page state)
 *   research  — cross-check several web sources             (page state)
 *   think     — the deep engine reasons it through first     (page state)
 *   nowPlaying— the song playing now rides with the message (page state)
 *   memory    — the lines the listener asked it to remember  (./memory.ts)
 *   place     — coarse place + time zone (assistantPlace)    (this module)
 *
 * Place had no switch of its own: it followed the app-wide region setting.
 * That setting still decides whether a place EXISTS to send; the connector
 * adds a chat-only "do not send it" on top, on by default so nothing changes
 * for anyone who never touches it.
 */

export const PLACE_ON_KEY = 'vinax.ai.placeOn';

/** Fired on window whenever a stored connector (memory, place) changes, so a
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

/** The place connector: on unless the listener switched it off here. */
export function placeConnectorOn(): boolean {
  try {
    return window.localStorage.getItem(PLACE_ON_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setPlaceConnectorOn(on: boolean): void {
  try {
    window.localStorage.setItem(PLACE_ON_KEY, on ? '1' : '0');
  } catch {
    /* private mode: the setting simply does not persist */
  }
  notifyConnectors();
}

export type ConnectorId = 'web' | 'research' | 'think' | 'nowPlaying' | 'memory' | 'place';

/** One row of the Connectors list, as the menu and the chip row draw it. */
export interface ConnectorView {
  id: ConnectorId;
  name: string;
  /** One line on what it does — or why it cannot be switched on right now. */
  description: string;
  on: boolean;
  /** Cannot be switched on from here (the reason is the description). */
  disabled?: boolean;
}

export interface ConnectorInputs {
  web: boolean;
  research: boolean;
  think: boolean;
  nowPlaying: boolean;
  /** Title of the song playing now, if any. */
  song?: string | null;
  memoryOn: boolean;
  memoryCount: number;
  placeOn: boolean;
  /** What would be sent ("Hyderabad, IN · Asia/Kolkata"), or null when the
   *  app-wide region setting leaves nothing to send. */
  placeLabel: string | null;
}

/** The connector rows, in menu order. Pure. */
export function connectorViews(s: ConnectorInputs): ConnectorView[] {
  const lines = (n: number): string => `${n} saved line${n === 1 ? '' : 's'}`;
  return [
    { id: 'web', name: 'Web search', description: 'Search the live web for fresh answers', on: s.web || s.research },
    { id: 'research', name: 'Research', description: 'Cross-check several sources and cite them', on: s.research },
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
    s.placeLabel
      ? { id: 'place', name: 'Place', description: `${s.placeLabel}, for local dates and times`, on: s.placeOn }
      : { id: 'place', name: 'Place', description: 'Off in Settings: region sharing is switched off', on: false, disabled: true },
  ];
}

/** The connectors that are on, for the chip row above the composer. Web search
 *  is folded into Research when both are on (Research always searches). */
export function activeConnectors(views: ConnectorView[]): ConnectorView[] {
  const research = views.some((v) => v.id === 'research' && v.on);
  return views.filter((v) => v.on && !v.disabled && !(research && v.id === 'web'));
}
