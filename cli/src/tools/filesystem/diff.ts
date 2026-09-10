/**
 * A small unified-diff generator.
 *
 * The permission prompt has to show what an edit does before the user agrees
 * to it, and "trust me, it's a small change" is not a prompt. This is a plain
 * Myers-style LCS over lines — enough for the diffs a coding agent produces,
 * and no dependency.
 */

export interface DiffOptions {
  context?: number;
  maxLines?: number;
}

/** Longest common subsequence table walk, returning an edit script. */
function lcsOps(a: string[], b: string[]): Array<{ op: ' ' | '-' | '+'; line: string }> {
  const n = a.length;
  const m = b.length;
  // Trim the common prefix and suffix first: an edit to one line of a
  // 2,000-line file should not build a 4,000,000-cell table.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start += 1;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const ops: Array<{ op: ' ' | '-' | '+'; line: string }> = [];
  for (let i = 0; i < start; i += 1) ops.push({ op: ' ', line: a[i] });

  const rows = midA.length;
  const cols = midB.length;
  if (rows * cols > 4_000_000) {
    // Pathological input: fall back to a whole-block replacement rather than
    // spending a second and a gigabyte on a prettier diff.
    for (const l of midA) ops.push({ op: '-', line: l });
    for (const l of midB) ops.push({ op: '+', line: l });
  } else {
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (midA[i] === midB[j]) {
        ops.push({ op: ' ', line: midA[i] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        ops.push({ op: '-', line: midA[i] });
        i += 1;
      } else {
        ops.push({ op: '+', line: midB[j] });
        j += 1;
      }
    }
    while (i < rows) { ops.push({ op: '-', line: midA[i] }); i += 1; }
    while (j < cols) { ops.push({ op: '+', line: midB[j] }); j += 1; }
  }
  for (let i = endA; i < n; i += 1) ops.push({ op: ' ', line: a[i] });
  return ops;
}

/** Unified diff of two texts, with hunk headers. */
export function unifiedDiff(before: string, after: string, opts: DiffOptions = {}): string {
  const context = opts.context ?? 3;
  const maxLines = opts.maxLines ?? 400;
  const a = before.replace(/\r\n/g, '\n').split('\n');
  const b = after.replace(/\r\n/g, '\n').split('\n');
  const ops = lcsOps(a, b);

  // Keep only the changed regions plus their context.
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.op === ' ') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k += 1) keep[k] = true;
  });

  const out: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  let i = 0;
  let emitted = 0;
  while (i < ops.length) {
    if (!keep[i]) {
      if (ops[i].op !== '+') oldLine += 1;
      if (ops[i].op !== '-') newLine += 1;
      i += 1;
      continue;
    }
    const hunkStartOld = oldLine;
    const hunkStartNew = newLine;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    while (i < ops.length && keep[i]) {
      const o = ops[i];
      body.push(`${o.op}${o.line}`);
      if (o.op !== '+') { oldLine += 1; oldCount += 1; }
      if (o.op !== '-') { newLine += 1; newCount += 1; }
      i += 1;
    }
    out.push(`@@ -${hunkStartOld},${oldCount} +${hunkStartNew},${newCount} @@`);
    out.push(...body);
    emitted += body.length;
    if (emitted > maxLines) {
      out.push(`… diff truncated at ${maxLines} lines …`);
      break;
    }
  }
  return out.join('\n');
}

/** Counts for a one-line "+12 −3" summary. */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const ops = lcsOps(before.replace(/\r\n/g, '\n').split('\n'), after.replace(/\r\n/g, '\n').split('\n'));
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.op === '+') added += 1;
    else if (o.op === '-') removed += 1;
  }
  return { added, removed };
}
