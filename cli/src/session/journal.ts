/**
 * The run journal: what VinaX has already done, so it never does it twice and
 * can put it back.
 *
 * Two jobs that turn out to be the same job.
 *
 * IDEMPOTENCY. Tool calls mutate a real machine. If an SSE stream dies after
 * the client has executed `git_commit` but before the reply completes, the
 * naive recovery — retry the step — commits twice. So every executed call id
 * is recorded here, and a call whose id has already run returns its recorded
 * result instead of running again. Not a nicety: the difference between a
 * retry and a duplicate side effect.
 *
 * UNDO. Every VinaX edit is journalled with the file's exact content before
 * and after. `/undo` restores the previous content — but only after checking
 * that the file still holds what VinaX left there. If somebody edited it
 * since, restoring would silently destroy their work, so undo refuses and
 * says why. A global `git reset` would be the easy implementation and is
 * exactly the wrong one: it would also throw away everything the user did.
 */
import { contentHash } from '../utils/text.js';

export interface CallRecord {
  id: string;
  name: string;
  at: number;
  ok: boolean;
  /** The result content, replayed verbatim if the same id comes back. */
  content: string;
}

export interface EditRecord {
  /** Absolute path. */
  path: string;
  display: string;
  /** Null when the file did not exist before (an undo deletes it again). */
  before: string | null;
  /** Null when VinaX removed the file (an undo puts it back). */
  after: string | null;
  /** Hash of `after`, or null when the file was removed. */
  hashAfter: string | null;
  at: number;
  /** Edits made in one step share a group id and undo together. */
  group: string;
}

export type UndoResult =
  | { ok: true; restored: Array<{ display: string; action: 'restored' | 'removed' }> }
  | { ok: false; reason: string };

export class RunJournal {
  private readonly calls = new Map<string, CallRecord>();
  private readonly edits: EditRecord[] = [];

  /** True when this exact call id has already been executed this run. */
  seen(id: string): boolean {
    return this.calls.has(id);
  }

  recall(id: string): CallRecord | null {
    return this.calls.get(id) ?? null;
  }

  recordCall(rec: CallRecord): void {
    this.calls.set(rec.id, rec);
  }

  callCount(): number {
    return this.calls.size;
  }

  recordEdit(rec: EditRecord): void {
    this.edits.push(rec);
  }

  /** Files VinaX changed, in the order it first touched them. */
  changedFiles(): string[] {
    const out: string[] = [];
    for (const e of this.edits) if (!out.includes(e.display)) out.push(e.display);
    return out;
  }

  lastGroup(): string | null {
    return this.edits.length ? this.edits[this.edits.length - 1].group : null;
  }

  editsInGroup(group: string): EditRecord[] {
    return this.edits.filter((e) => e.group === group);
  }

  dropGroup(group: string): void {
    for (let i = this.edits.length - 1; i >= 0; i -= 1) {
      if (this.edits[i].group === group) this.edits.splice(i, 1);
    }
  }

  /**
   * Undo the most recent VinaX edit group.
   *
   * `readFile` and `writeFile` are injected so this stays pure logic and the
   * tests can drive it without a real filesystem.
   */
  async undoLast(io: {
    readFile: (path: string) => Promise<string | null>;
    writeFile: (path: string, content: string) => Promise<void>;
    removeFile: (path: string) => Promise<void>;
  }): Promise<UndoResult> {
    const group = this.lastGroup();
    if (!group) return { ok: false, reason: 'VinaX has not edited anything in this session.' };
    const edits = this.editsInGroup(group);

    // Verify EVERY file first: a half-applied undo is worse than none.
    for (const e of edits) {
      const current = await io.readFile(e.path);
      if (e.after === null) {
        // VinaX removed this file. Undo only if it is still gone — if
        // something recreated it, that content is not VinaX's to overwrite.
        if (current !== null) {
          return { ok: false, reason: `${e.display} exists again since VinaX removed it, so restoring the old copy would overwrite it.` };
        }
        continue;
      }
      if (current === null) {
        if (e.before === null) continue; // already gone; nothing to restore
        return { ok: false, reason: `${e.display} no longer exists, so its previous content cannot be safely restored.` };
      }
      if (contentHash(current) !== e.hashAfter) {
        return {
          ok: false,
          reason: `${e.display} has changed since VinaX edited it. Undoing now would discard that change, so VinaX has not touched it.`,
        };
      }
    }

    const restored: Array<{ display: string; action: 'restored' | 'removed' }> = [];
    for (const e of edits) {
      if (e.before === null) {
        await io.removeFile(e.path);
        restored.push({ display: e.display, action: 'removed' });
      } else {
        await io.writeFile(e.path, e.before);
        restored.push({ display: e.display, action: 'restored' });
      }
    }
    this.dropGroup(group);
    return { ok: true, restored };
  }
}
