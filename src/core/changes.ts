import type { ChangeItem, ChangeReport, SchemaRow } from '../types.js';

function rowMap(rows: SchemaRow[]): Map<string, SchemaRow> {
  return new Map(rows.map((row) => [row.path, row]));
}

function compareScope(scope: 'request' | 'response', beforeRows: SchemaRow[], afterRows: SchemaRow[]): ChangeItem[] {
  const before = rowMap(beforeRows);
  const after = rowMap(afterRows);
  const items: ChangeItem[] = [];

  for (const [path, row] of before.entries()) {
    const next = after.get(path);
    if (!next) {
      items.push({ scope, path, type: 'removed', before: row.type, breaking: true });
      continue;
    }
    if (row.type !== next.type) {
      items.push({ scope, path, type: 'type-changed', before: row.type, after: next.type, breaking: true });
    }
    if (row.required !== next.required) {
      const breaking = scope === 'request' ? next.required : false;
      items.push({ scope, path, type: 'required-changed', before: String(row.required), after: String(next.required), breaking });
    }
    if (Boolean(row.nullable) !== Boolean(next.nullable)) {
      items.push({ scope, path, type: 'nullable-changed', before: String(row.nullable), after: String(next.nullable), breaking: false });
    }
    if ((row.format || '') !== (next.format || '')) {
      items.push({ scope, path, type: 'format-changed', before: row.format, after: next.format, breaking: false });
    }
  }

  for (const [path, row] of after.entries()) {
    if (!before.has(path)) {
      items.push({ scope, path, type: 'added', after: row.type, breaking: false });
    }
  }

  return items.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildChangeReport(
  snapshotName: string,
  createdAt: string,
  beforeRequestRows: SchemaRow[],
  beforeResponseRows: SchemaRow[],
  afterRequestRows: SchemaRow[],
  afterResponseRows: SchemaRow[],
): ChangeReport {
  const items = [
    ...compareScope('request', beforeRequestRows, afterRequestRows),
    ...compareScope('response', beforeResponseRows, afterResponseRows),
  ];
  return {
    snapshotName,
    createdAt,
    items,
    breakingCount: items.filter((item) => item.breaking).length,
  };
}
