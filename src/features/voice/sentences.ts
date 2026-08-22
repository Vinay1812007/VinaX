/** Streaming sentence cutter for live voice — lets speech start on the first
 *  complete sentence while the rest of the reply is still being written. */
export function cutSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;
  for (;;) {
    const punct = /[.!?…]["')\]]?\s+/.exec(rest);
    const nl = /\n+/.exec(rest);
    const m = punct && nl ? (punct.index <= nl.index ? punct : nl) : (punct ?? nl);
    if (m) {
      const end = m.index + m[0].length;
      const part = rest.slice(0, end).trim();
      if (part) sentences.push(part);
      rest = rest.slice(end);
      continue;
    }
    // Runaway text with no punctuation: force a cut so speech never stalls.
    if (rest.length > 240) {
      const sp = rest.lastIndexOf(' ', 240);
      const cut = sp > 80 ? sp : 240;
      const part = rest.slice(0, cut).trim();
      if (part) sentences.push(part);
      rest = rest.slice(cut);
      continue;
    }
    return { sentences, rest };
  }
}
