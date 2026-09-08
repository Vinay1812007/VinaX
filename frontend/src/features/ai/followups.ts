/**
 * v5.16.0 — follow-up suggestions. The engine ends a reply with one line
 * `>>> question | question | question`; the client lifts it off the body and
 * renders chips. While streaming, the line is hidden as it arrives so the
 * marker never flashes on screen.
 */
export const FOLLOWUP_MARK = '>>>';

export function splitFollowups(text: string): { body: string; followups: string[] } {
  const lines = text.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i -= 1) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith(FOLLOWUP_MARK)) {
      const followups = l
        .slice(FOLLOWUP_MARK.length)
        .split('|')
        .map((s) => s.trim().replace(/^[-•*]\s*/, '').replace(/^["“]|["”]$/g, ''))
        .filter((s) => s.length > 2 && s.length <= 120)
        .slice(0, 3);
      const body = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trimEnd();
      return { body, followups };
    }
    break;
  }
  return { body: text, followups: [] };
}

/** Streaming view: drop a trailing (possibly partial) follow-up line. */
export function hideFollowupLine(text: string): string {
  const i = text.lastIndexOf('\n');
  const tail = i >= 0 ? text.slice(i + 1) : text;
  const t = tail.trimStart();
  if (t.startsWith(FOLLOWUP_MARK) || (t.length < FOLLOWUP_MARK.length && FOLLOWUP_MARK.startsWith(t) && t.length > 0)) {
    return i >= 0 ? text.slice(0, i) : '';
  }
  return text;
}
