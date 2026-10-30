/** 1.3 — true when any line is written in an Indian script (Devanagari to Malayalam) or Urdu's Arabic script. */
export function hasIndicScript(lines: readonly string[]): boolean {
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 1) {
      const c = line.charCodeAt(i);
      if ((c >= 0x0600 && c <= 0x06ff) || (c >= 0x0900 && c <= 0x0dff)) return true;
    }
  }
  return false;
}
