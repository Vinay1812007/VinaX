/**
 * VinaX AI — a Markdown table as CSV (the "Copy as CSV" button over a
 * table in a reply). Works on the rendered tree (hast): rows of th / td
 * cells, their text joined; cells with a comma, a quote or a line break are
 * quoted the usual way.
 */
export interface TreeNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: TreeNode[];
}

const textOf = (n: TreeNode | undefined): string => (!n ? '' : n.type === 'text' ? n.value ?? '' : (n.children ?? []).map(textOf).join(''));

/** One CSV cell: quoted when it holds a comma, a quote or a line break. */
export function csvCell(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Every row of the table (header rows first), each cell's text. */
export function tableRows(table: TreeNode): string[][] {
  const rows: string[][] = [];
  const walk = (n: TreeNode): void => {
    if (n.tagName === 'tr') {
      rows.push((n.children ?? []).filter((c) => c.tagName === 'th' || c.tagName === 'td').map(textOf));
      return;
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(table);
  return rows;
}

export function tableToCsv(table: TreeNode): string {
  return tableRows(table).map((r) => r.map(csvCell).join(',')).join('\n');
}
