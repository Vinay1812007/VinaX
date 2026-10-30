/**
 * VinaX AI — what every adapter does with the system text before sending:
 * models flagged `systemRole: false` get it in front of the first user turn
 * instead of as a system message.
 */
import type { ModelSpec, NormalizedMessage } from './types';

export function wireMessages(spec: ModelSpec, system: string, messages: NormalizedMessage[]): { system: string | null; messages: NormalizedMessage[] } {
  if (spec.flags.systemRole || !system) return { system: system || null, messages };
  const i = messages.findIndex((msg) => msg.role === 'user');
  if (i < 0) return { system: null, messages: [{ role: 'user', text: system }, ...messages] };
  const out = messages.slice();
  out[i] = { role: 'user', text: `${system}\n\n---\n\n${messages[i].text}` };
  return { system: null, messages: out };
}
