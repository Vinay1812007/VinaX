/**
 * Turning raw terminal bytes into named keys.
 *
 * A terminal does not tell a program "the user pressed Up". It sends
 * `ESC [ A` — or `ESC O A` if the terminal is in application cursor mode,
 * which macOS Terminal.app and iTerm both use in some configurations. A
 * program that does not decode these gets the escape sequence as literal
 * text, which is exactly why arrow keys "type ^[[A" in a naive prompt.
 *
 * This decoder is a pure function over a byte stream with no reference to
 * stdin, so tests can feed it exact sequences and assert the result. That is
 * the only way to be confident about terminals the developer does not own.
 *
 * It is stateful in one necessary way: a sequence can arrive split across
 * reads, and a bracketed paste spans many chunks, so incomplete input is held
 * until it completes.
 */

const ESC = '\u001b';
const DEL = '\u007f';

export interface Key {
  /** 'char' for printable input, 'paste' for bracketed paste, else a name. */
  name:
    | 'char' | 'paste'
    | 'up' | 'down' | 'left' | 'right'
    | 'home' | 'end' | 'pageup' | 'pagedown'
    | 'enter' | 'tab' | 'shift-tab' | 'escape'
    | 'backspace' | 'delete'
    | 'word-left' | 'word-right'
    | 'unknown';
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  /** The raw bytes this key came from. */
  sequence: string;
  /** Text for 'char' and 'paste'. */
  text?: string;
}

const key = (name: Key['name'], sequence: string, mods: Partial<Key> = {}): Key => ({
  name,
  ctrl: false,
  meta: false,
  shift: false,
  sequence,
  ...mods,
});

/** CSI final byte to key name, for the plain `ESC [ X` forms. */
const CSI_LETTER: Record<string, Key['name']> = {
  A: 'up', B: 'down', C: 'right', D: 'left',
  H: 'home', F: 'end', Z: 'shift-tab',
};

/** `ESC [ n ~` forms. */
const CSI_TILDE: Record<string, Key['name']> = {
  '1': 'home', '3': 'delete', '4': 'end',
  '5': 'pageup', '6': 'pagedown', '7': 'home', '8': 'end',
};

/** xterm modifier parameter: 1 + bitmask(shift=1, alt=2, ctrl=4). */
function modifiers(param: string | undefined): { shift: boolean; meta: boolean; ctrl: boolean } {
  const n = param ? Number(param) - 1 : 0;
  return { shift: (n & 1) !== 0, meta: (n & 2) !== 0, ctrl: (n & 4) !== 0 };
}

/** Longest suffix of `s` that is a proper prefix of `marker`. */
function partialSuffix(s: string, marker: string): number {
  const max = Math.min(s.length, marker.length - 1);
  for (let n = max; n > 0; n -= 1) {
    if (s.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

export interface KeyDecoder {
  /** Feed a chunk; returns every key it completed. */
  push(chunk: string): Key[];
  /**
   * Resolve a held lone ESC into the Escape key.
   *
   * A bare ESC is ambiguous: it is either the Escape key, or the first byte of
   * an arrow sequence whose remaining bytes are still in flight. The decoder
   * cannot tell without waiting, and waiting is a timing policy — so it holds
   * the byte and the APP decides, calling flush() on a short timer. That keeps
   * this module pure and the tests exact.
   */
  flush(): Key[];
  /** True while a partial escape sequence or an open paste is buffered. */
  pending(): boolean;
  /** Discard any partial state. */
  reset(): void;
}

export function createKeyDecoder(): KeyDecoder {
  let buf = '';
  let pasting = false;
  let pasteBuf = '';

  const drain = (): Key[] => {
    const out: Key[] = [];

    for (;;) {
      if (!buf) break;

      // ---- inside a bracketed paste: everything is text until the end mark
      if (pasting) {
        const endMark = ESC + '[201~';
        const end = buf.indexOf(endMark);
        if (end === -1) {
          const keep = partialSuffix(buf, endMark);
          pasteBuf += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          break;
        }
        pasteBuf += buf.slice(0, end);
        buf = buf.slice(end + endMark.length);
        pasting = false;
        out.push(key('paste', pasteBuf, { text: pasteBuf }));
        pasteBuf = '';
        continue;
      }

      const c = buf[0];

      if (c === ESC) {
        // A lone ESC may be Escape, or the first byte of a split arrow
        // sequence. Hold it; push() resolves it when nothing follows.
        if (buf.length === 1) break;

        const second = buf[1];

        if (second === '[') {
          const startMark = ESC + '[200~';
          if (buf.startsWith(startMark)) {
            buf = buf.slice(startMark.length);
            pasting = true;
            continue;
          }
          const m = new RegExp('^' + ESC + '\\[([0-9;]*)([A-Za-z~])').exec(buf);
          if (!m) break; // incomplete CSI — wait for the rest
          const [seq, params, finalByte] = m;
          buf = buf.slice(seq.length);
          const parts = params.split(';');
          const mods = modifiers(parts[1]);

          if (finalByte === '~') {
            out.push(key(CSI_TILDE[parts[0] ?? ''] ?? 'unknown', seq, mods));
            continue;
          }
          const name = CSI_LETTER[finalByte];
          if (!name) {
            out.push(key('unknown', seq, mods));
            continue;
          }
          // Ctrl/Alt + Left/Right are word motions wherever they are reported.
          if ((mods.ctrl || mods.meta) && (name === 'left' || name === 'right')) {
            out.push(key(name === 'left' ? 'word-left' : 'word-right', seq, mods));
            continue;
          }
          out.push(key(name, seq, mods));
          continue;
        }

        // ESC O x — application cursor mode. Terminal.app and iTerm send these
        // for arrows by default; a decoder that only knows ESC [ is precisely
        // why arrows appear not to work there.
        if (second === 'O') {
          if (buf.length < 3) break;
          const finalByte = buf[2];
          const seq = buf.slice(0, 3);
          buf = buf.slice(3);
          out.push(key(CSI_LETTER[finalByte] ?? 'unknown', seq));
          continue;
        }

        // ESC b / ESC f — Alt+Left / Alt+Right when Option is sent as Meta.
        if (second === 'b' || second === 'f') {
          const seq = buf.slice(0, 2);
          buf = buf.slice(2);
          out.push(key(second === 'b' ? 'word-left' : 'word-right', seq, { meta: true }));
          continue;
        }

        // ESC + anything else — Alt+<char>.
        const seq = buf.slice(0, 2);
        buf = buf.slice(2);
        out.push(key('char', seq, { meta: true, text: seq[1] }));
        continue;
      }

      // ---- single bytes
      buf = buf.slice(1);

      if (c === '\r') {
        out.push(key('enter', c));
        continue;
      }
      if (c === '\n') {
        // In raw mode Enter arrives as CR; a bare LF is Ctrl+J, which is how
        // a terminal reports "insert a newline". Treating both as Enter is
        // what makes multi-line input impossible.
        out.push(key('char', c, { ctrl: true, text: 'j' }));
        continue;
      }
      if (c === '\t') {
        out.push(key('tab', c));
        continue;
      }
      if (c === DEL || c === '\b') {
        out.push(key('backspace', c));
        continue;
      }
      const code = c.charCodeAt(0);
      if (code < 0x20) {
        // Ctrl+letter. Ctrl+J (0x0a) is handled as Enter above; the editor
        // asks for the raw sequence when it wants a literal newline.
        out.push(key('char', c, { ctrl: true, text: String.fromCharCode(code + 96) }));
        continue;
      }

      // ---- printable text: take the whole run so an unbracketed paste is not
      // processed one keystroke at a time.
      let run = c;
      while (buf && buf.charCodeAt(0) >= 0x20 && buf[0] !== ESC && buf[0] !== DEL) {
        run += buf[0];
        buf = buf.slice(1);
      }
      out.push(key('char', run, { text: run }));
    }

    return out;
  };

  return {
    push(chunk: string): Key[] {
      buf += chunk;
      return drain();
    },
    flush(): Key[] {
      // Only a lone ESC is resolvable this way. A longer partial sequence is
      // genuinely incomplete and stays buffered.
      if (buf !== ESC) return [];
      buf = '';
      return [key('escape', ESC)];
    },
    pending(): boolean {
      return buf.length > 0 || pasting;
    },
    reset(): void {
      buf = '';
      pasting = false;
      pasteBuf = '';
    },
  };
}

/** Ctrl+<letter> helper for the key handlers. */
export function isCtrl(k: Key, letter: string): boolean {
  return k.ctrl && k.text === letter;
}
