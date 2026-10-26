/**
 * The Worker and supabase/schema.sql must agree. This walks every
 * `db.<method>(env, '<table>', …)` and `db.rpc(env, '<fn>', { args })` in the
 * Worker with the TypeScript compiler, pulls out the columns each query names
 * (eq / gte / in / select / order / or …), the keys of insert, upsert and
 * update payloads (literal keys, or the static type's properties) and the
 * argument names handed to a function, and checks each against the tables,
 * columns and functions declared in schema.sql.
 *
 * A column renamed on one side without the other fails here, before PostgREST
 * answers 400 PGRST204 in production.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../functions', import.meta.url));
const SCHEMA = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8');

// ----------------------------------------------------------- schema.sql

/** table → columns, from `create table if not exists t (…)`. */
function tablesOf(sql: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/create table if not exists (\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const cols = new Set<string>();
    for (const line of m[2].split('\n')) {
      const t = line.replace(/--.*$/, '').trim();
      const first = /^(\w+)\s+/.exec(t)?.[1];
      if (first && !['constraint', 'primary', 'unique', 'check', 'foreign'].includes(first)) cols.add(first);
    }
    out.set(m[1], cols);
  }
  // Columns added later by `alter table t add column if not exists c …`.
  for (const m of sql.matchAll(/alter table (\w+) add column if not exists (\w+)/g)) out.get(m[1])?.add(m[2]);
  // The one view: its output columns are the `as alias` names of its first
  // top-level select (indented two spaces; a `with` clause's selects are deeper).
  const view = /create or replace view (\w+) as[\s\S]*?\n {2}select([\s\S]*?)\n\s*from /.exec(sql);
  if (view) out.set(view[1], new Set([...view[2].matchAll(/as (\w+)/g)].map((x) => x[1]).concat(['listener_id'])));
  return out;
}

/** function → parameter names, from `create or replace function f(a type, b type)`. */
function functionsOf(sql: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/create or replace function (\w+)\(([^)]*)\)/g)) {
    out.set(m[1], new Set(m[2].split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)));
  }
  return out;
}

// ------------------------------------------------------------- the walk

const QUERY_COL = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike', 'is', 'not', 'in', 'order']);
const NOT_COLS = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'on_conflict']);

const str = (n: ts.Node | undefined): string | null => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
const addSelect = (cols: string, out: Set<string>) => {
  for (const c of cols.split(',')) {
    const y = c.trim();
    if (y && y !== '*' && !y.includes('(')) out.add(y.split(':').pop()!.split('::')[0]);
  }
};

function columnsOfQuery(node: ts.Node | undefined, out = new Set<string>()): Set<string> {
  if (!node) return out;
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const m = node.expression.name.text;
    const [a0] = node.arguments;
    if (QUERY_COL.has(m)) { const c = str(a0); if (c) out.add(c); }
    else if (m === 'select') { const c = str(a0); if (c) addSelect(c, out); }
    else if (m === 'or') for (const a of node.arguments) { const t = ts.isTemplateExpression(a) ? a.head.text : str(a); const col = t?.split('.')[0]; if (col) out.add(col); }
    else if (m === 'raw') { const t = str(a0) ?? (a0 && ts.isTemplateExpression(a0) ? a0.head.text : null); if (t) columnsOfString(t, out); }
    columnsOfQuery(node.expression.expression, out);
  }
  return out;
}

function columnsOfString(s: string, out = new Set<string>()): Set<string> {
  for (const part of s.split('&')) {
    const [k, v] = part.split('=');
    if (!k) continue;
    if (k === 'select') addSelect(v ?? '', out);
    else if (k === 'order') out.add((v ?? '').split('.')[0]);
    else if (!NOT_COLS.has(k)) out.add(k);
  }
  return out;
}

/** Keys an insert/upsert/update payload writes, or null when they cannot be known statically. */
function keysOfPayload(node: ts.Node | undefined, checker: ts.TypeChecker): Set<string> | null {
  if (!node) return null;
  if (ts.isParenthesizedExpression(node)) return keysOfPayload(node.expression, checker);
  if (ts.isArrayLiteralExpression(node)) {
    const s = new Set<string>();
    for (const e of node.elements) { const k = keysOfPayload(e, checker); if (!k) return null; k.forEach((x) => s.add(x)); }
    return s;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const s = new Set<string>();
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) { const n = p.name; if (ts.isIdentifier(n) || ts.isStringLiteral(n)) s.add(n.text); }
      else if (ts.isSpreadAssignment(p)) { const k = keysOfPayload(p.expression, checker); if (!k) return null; k.forEach((x) => s.add(x)); }
    }
    return s;
  }
  if (ts.isConditionalExpression(node)) {
    const a = keysOfPayload(node.whenTrue, checker), b = keysOfPayload(node.whenFalse, checker);
    return a && b ? new Set([...a, ...b]) : null;
  }
  // A variable or call: its static type's properties (a `Record<string, unknown>` has none → unknown).
  const t = checker.getTypeAtLocation(node);
  const props = (t.isUnion() ? t.types : [t]).flatMap((x) => x.getProperties());
  return props.length ? new Set(props.map((p) => p.name)) : null;
}

/** A `Record<string, unknown>` built up with `row.col = …` assignments after `const row = { … }`. */
function assignedKeys(id: ts.Identifier, checker: ts.TypeChecker): Set<string> | null {
  const sym = checker.getSymbolAtLocation(id);
  const decl = sym?.valueDeclaration;
  if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return null;
  const keys = keysOfPayload(decl.initializer, checker) ?? new Set<string>();
  const scope = decl.getSourceFile();
  const name = id.text;
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left)
      && ts.isIdentifier(n.left.expression) && n.left.expression.text === name) keys.add(n.left.name.text);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression)
      && n.expression.expression.text === 'Object' && n.expression.name.text === 'assign' && n.arguments[0] && ts.isIdentifier(n.arguments[0])
      && n.arguments[0].text === name) { for (const a of n.arguments.slice(1)) keysOfPayload(a, checker)?.forEach((k) => keys.add(k)); }
    ts.forEachChild(n, visit);
  };
  visit(scope);
  return keys;
}

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) files.push(p);
    }
  };
  walk(ROOT);
  return files;
}

interface Finding { where: string; text: string }

function audit(): { calls: number; problems: Finding[]; unresolved: Finding[] } {
  const tables = tablesOf(SCHEMA);
  const functions = functionsOf(SCHEMA);
  const files = sourceFiles();
  const program = ts.createProgram(files, { noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const problems: Finding[] = [];
  const unresolved: Finding[] = [];
  let calls = 0;

  for (const sf of program.getSourceFiles()) {
    if (!files.includes(sf.fileName)) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'db') {
        const method = node.expression.name.text;
        const target = str(node.arguments[1]);
        const where = `${sf.fileName.replace(ROOT, 'functions')}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const note = (text: string) => problems.push({ where, text });
        if (['select', 'one', 'insert', 'upsert', 'update', 'remove', 'count'].includes(method)) {
          calls += 1;
          if (!target) { if (!sf.fileName.endsWith('_lib/db.ts')) unresolved.push({ where, text: `db.${method} with a non-literal table` }); return; }
          const cols = tables.get(target);
          if (!cols) { note(`table "${target}" is not declared in schema.sql`); return; }
          const used = new Set<string>();
          const isWrite = method === 'insert' || method === 'upsert';
          const qArg = isWrite ? undefined : node.arguments[2];
          if (qArg) {
            const s = str(qArg);
            if (s) columnsOfString(s, used);
            else if (ts.isTemplateExpression(qArg)) columnsOfString(qArg.head.text + qArg.templateSpans.map((x) => x.literal.text).join(''), used);
            else columnsOfQuery(qArg, used);
          }
          const payload = isWrite ? node.arguments[2] : method === 'update' ? node.arguments[3] : undefined;
          if (payload) {
            const k = keysOfPayload(payload, checker) ?? (ts.isIdentifier(payload) ? assignedKeys(payload, checker) : null);
            if (k) k.forEach((x) => used.add(x));
            else unresolved.push({ where, text: `db.${method}("${target}") payload keys could not be determined` });
          }
          if (method === 'upsert') str(node.arguments[3])?.split(',').forEach((c) => used.add(c.trim()));
          if (method === 'insert') {
            const o = node.arguments[3];
            if (o && ts.isObjectLiteralExpression(o)) for (const p of o.properties) if (ts.isPropertyAssignment(p) && p.name.getText() === 'onConflict') str(p.initializer)?.split(',').forEach((c) => used.add(c.trim()));
          }
          for (const c of used) if (!cols.has(c)) note(`db.${method}("${target}") names column "${c}", which schema.sql does not declare (has ${[...cols].join(', ')})`);
        } else if (method === 'rpc') {
          calls += 1;
          if (!target) { unresolved.push({ where, text: 'db.rpc with a non-literal function name' }); return; }
          const args = functions.get(target);
          if (!args) { note(`function "${target}" is not declared in schema.sql`); return; }
          const a = node.arguments[2];
          if (a && ts.isObjectLiteralExpression(a)) for (const p of a.properties) {
            const n = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) ? p.name.getText() : null;
            if (n && !args.has(n)) note(`rpc("${target}") passes "${n}" but the function takes (${[...args].join(', ')})`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { calls, problems, unresolved };
}

describe('Worker database usage matches schema.sql', () => {
  const result = audit();
  const fmt = (f: Finding[]) => f.map((p) => `${p.where}: ${p.text}`).join('\n');

  it('parses the schema', () => {
    const tables = tablesOf(SCHEMA);
    expect(tables.get('events')?.has('meta')).toBe(true);
    expect(tables.get('directory')?.has('account_id')).toBe(true);
    expect(functionsOf(SCHEMA).get('stats_music')?.has('p_limit')).toBe(true);
  });

  it('finds the calls', () => {
    expect(result.calls).toBeGreaterThan(80);
  });

  it('names only tables, columns and function arguments that exist', () => {
    expect(fmt(result.problems)).toBe('');
  });

  it('resolves the payload of every write (the dynamic ones are listed here by hand)', () => {
    // A table name chosen at runtime from a fixed map (admin analytics) is the
    // one accepted exception; every other call is checked above.
    expect(result.unresolved.filter((u) => !u.where.includes('admin/analytics.ts')).map((u) => `${u.where}: ${u.text}`)).toEqual([]);
  });
});
