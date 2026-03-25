import type { FieldSchema } from '../types.js';

function parseExample(example?: string): unknown {
  if (!example) {
    return undefined;
  }
  try {
    return JSON.parse(example);
  } catch {
    return example;
  }
}

function scalarValue(type: string, path: string, example?: string, format?: string, enumValues?: string[], nullable?: boolean): unknown {
  if (nullable && !example) {
    return null;
  }
  if (enumValues && enumValues.length > 0) {
    return enumValues[0];
  }
  const parsedExample = parseExample(example);
  if (parsedExample !== undefined && typeof parsedExample !== 'object') {
    return parsedExample;
  }
  if (format === 'date') {
    return '2026-03-25';
  }
  if (format === 'date-time') {
    return '2026-03-25T09:00:00Z';
  }
  if (format === 'uuid') {
    return '123e4567-e89b-12d3-a456-426614174000';
  }
  if (format === 'email') {
    return 'user@example.com';
  }
  switch (type) {
    case 'string':
      return path === '$' ? 'sample' : path.split('.').pop() || 'value';
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return 'sample';
  }
}

function buildValue(schema: FieldSchema | null): unknown {
  if (!schema) {
    return {};
  }

  const parsedExample = parseExample(schema.example);
  if (parsedExample !== undefined && (typeof parsedExample !== 'object' || parsedExample === null)) {
    return parsedExample;
  }

  if (schema.type === 'object') {
    const output: Record<string, unknown> = {};
    for (const child of schema.children) {
      output[child.name] = buildValue(child);
    }
    return output;
  }

  if (schema.type.startsWith('array<')) {
    if (Array.isArray(parsedExample) && parsedExample.length > 0) {
      return parsedExample;
    }
    const sampleItem = schema.children.length > 0
      ? Object.fromEntries(schema.children.map((child) => [child.name, buildValue(child)]))
      : scalarValue(schema.itemType || 'string', `${schema.path}[]`, undefined, schema.format, schema.enumValues, schema.nullable);
    return [sampleItem, sampleItem];
  }

  return scalarValue(schema.type, schema.path, schema.example, schema.format, schema.enumValues, schema.nullable);
}

export function renderMockJson(schema: FieldSchema | null): string {
  return JSON.stringify(buildValue(schema), null, 2);
}
